import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    try {
        console.log("Relayer triggered"); 
    
        // 1. CORS HEADERS
        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
        res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, Date, X-Api-Version, Authorization');
    
        if (req.method === 'OPTIONS') return res.status(200).end();
        if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
        if (!req.body || !req.body.playerAddress) {
            return res.status(400).json({ success: false, error: "Missing playerAddress" });
        }
    
        try {
            const { playerAddress } = req.body;
            
            const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
            const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
            const CONTRACT_ADDRESS = "0x9A6569ABE75356Ef79aC722EEc10655EDa5b9ccb";
    
            if (!PRIVATE_KEY) throw new Error("Server Configuration Error: Missing Private Key");
    
            // 2. INITIALIZE ETHERS NATIVE PROVIDER
            const network = ethers.Network.from(8200);
            const provider = new ethers.JsonRpcProvider(RPC_URL, network, { staticNetwork: true });
            const relayerWallet = new ethers.Wallet(PRIVATE_KEY, provider);
            
            const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                "function submitAIMove(address player, string newFEN, string newPGN) external",
                "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)",
                "function playerLastTaskId(address) view returns (bytes32)"
            ], relayerWallet);
            
            // 3. RETRIEVE THE NATIVE ON-CHAIN TASK ID
            const taskId = await contract.playerLastTaskId(playerAddress);
            console.log("Active On-Chain Task ID Found:", taskId);
            
            if (taskId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
                throw new Error("Task ID is zero. The player transaction did not issue an engine request.");
            }

            // 4. POLL LIGHTCHAIN NATIVE INFERENCE ENGINE STATUS
            let finalized = false;
            let resultMoveString = "";
            
            for (let i = 0; i < 30; i++) {
                // Querying task state via native custom RPC method
                const taskStatus = await provider.send("lcai_getTaskStatus", [taskId]);
                
                if (taskStatus && taskStatus.status === "finalized") {
                    finalized = true;
                    // Extract the raw move coordinate text output computed inside the AIVM execution trace
                    resultMoveString = taskStatus.result.output.trim().toLowerCase().replace(/[^a-h1-8q]/g, '');
                    break;
                }
                await new Promise(r => setTimeout(r, 4000)); // Poll every 4 seconds
            }
            
            if (!finalized) throw new Error("PoI Native Engine timeout: Task failed validation parameters.");
            console.log("Verified Native AIVM Move String:", resultMoveString);

            // 5. RESYNC POSITION STATE
            const gameData = await contract.matches(playerAddress);
            const game = new Chess(gameData[2]); // Load contract current FEN
            
            // Apply verified move coordinate safely onto local tracker parameters
            if (!game.move(resultMoveString, { sloppy: true })) {
                throw new Error(`AIVM returned an illegal chess move tracking variation: ${resultMoveString}`);
            }
    
            // 6. SUBMIT AI COUNTERMOVE STATE TO SMART CONTRACT REFEREE
            const tx = await contract.submitAIMove(playerAddress, game.fen(), game.pgn());
            await tx.wait();
    
            return res.status(200).json({ 
                success: true, 
                newFEN: game.fen(), 
                gameOver: game.game_over(),
                txHash: tx.hash
            });
    
        } catch (err) {
            console.error("INTERNAL EXECUTOR CRASH:", err);
            return res.status(500).json({ success: false, crashReport: err.message });
        }
    } catch (err) {
        console.error("RELAYER_CRASH:", err);
        return res.status(500).json({ success: false, crashReport: err.message });
    }
}
