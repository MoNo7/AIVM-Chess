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
    
        // 2. SAFETY SHIELD
        if (!req.body || !req.body.playerAddress) {
            return res.status(400).json({ success: false, error: "Missing playerAddress" });
        }
    
        try {
            const { playerAddress } = req.body;
            
            // Configuration Setup
            const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
            const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
            const CONTRACT_ADDRESS = "0x542280fB7A2d1dBCcF995033809C778F67D9870D";
    
            if (!PRIVATE_KEY) throw new Error("Server Configuration Error: Missing Private Key");
    
            // 3. INITIALIZE ETHERS PROVIDERS
            const network = ethers.Network.from(8200);
            const provider = new ethers.JsonRpcProvider(RPC_URL, network, { staticNetwork: true });
            const relayerWallet = new ethers.Wallet(PRIVATE_KEY, provider);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                "function submitAIMove(address player, string newFEN, string newPGN) external",
                "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)",
                "function playerLastTaskId(address) view returns (bytes32)"
            ], relayerWallet);
            
            // 4. GRAB THE NATIVE TASK ID GENERATED ON-CHAIN
            const taskId = await contract.playerLastTaskId(playerAddress);
            console.log("Found Active On-Chain Task ID:", taskId);
            
            if (taskId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
                throw new Error("Task ID is blank. The player transaction did not register properly.");
            }

            // 5. POLL SYSTEM CONSOLE FOR INFERENCE STATE FINALIZATION
            let finalized = false;
            let resultMoveString = "";
            
            for (let i = 0; i < 20; i++) {
                // Call standard Lightchain custom RPC node method for task status tracking
                const taskStatus = await provider.send("lcai_getTaskStatus", [taskId]);
                
                if (taskStatus && taskStatus.status === "finalized") {
                    finalized = true;
                    // Grab the raw target move response generated natively inside the cluster execution trace
                    resultMoveString = taskStatus.result.output.trim().toLowerCase().replace(/[^a-h1-8q]/g, '');
                    break;
                }
                await new Promise(r => setTimeout(r, 4000)); // Sleep 4 seconds between checks
            }
            
            if (!finalized) throw new Error("Lightchain Core Engine timeout: Task failed to achieve validation.");
            console.log("Verified Native AIVM Move String:", resultMoveString);

            // 6. RESTORE CURRENT MATURED GAME FOR POSITION SYNC
            const gameData = await contract.matches(playerAddress);
            const game = new Chess(gameData[2]); // Load current position
            
            // Apply the certified AI countermove locally to match state records
            if (!game.move(resultMoveString, { sloppy: true })) {
                throw new Error(`AIVM engine returned illegal chess move syntax: ${resultMoveString}`);
            }
    
            // 7. COMMIT FINAL TURN BOUNDARIES BACK TO REFEREE CONTRACT
            const tx = await contract.submitAIMove(playerAddress, game.fen(), game.pgn());
            await tx.wait();
    
            return res.status(200).json({ 
                success: true, 
                newFEN: game.fen(), 
                gameOver: game.game_over(),
                txHash: tx.hash
            });
    
        } catch (err) {
            console.error("CRASH REPORT:", err);
            return res.status(500).json({ success: false, crashReport: err.message });
        }
    } catch (err) {
        console.error("RELAYER_CRASH:", err);
        return res.status(500).json({ success: false, crashReport: err.message });
    }
}
