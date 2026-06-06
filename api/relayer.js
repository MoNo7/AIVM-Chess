import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
   try {
        console.log("Relayer triggered"); 
    
        // 1. ADD CORS HEADERS
        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
        res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, Date, X-Api-Version, Authorization');
    
        if (req.method === 'OPTIONS') return res.status(200).end();
        if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
        // 2. SAFETY SHIELD
        if (!req.body || !req.body.moveObj) {
            return res.status(400).json({ success: false, error: "Missing moveObj" });
        }
    
        try {
            const { playerAddress, moveObj, moveString } = req.body;
            
            // Ensure environment variables are loaded
            const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
            const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
            const CONTRACT_ADDRESS = "0x542280fB7A2d1dBCcF995033809C778F67D9870D";
    
            if (!PRIVATE_KEY) throw new Error("Server Configuration Error: Missing Private Key");
    
            // 3. RPC HEALTH CHECK
            const healthCheck = await fetch(RPC_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
            });
    
            if (!healthCheck.ok) throw new Error(`Lightchain RPC unreachable at ${RPC_URL}`);
    
            // 4. INITIALIZE ETHERS
            const network = ethers.Network.from(8200);
            const provider = new ethers.JsonRpcProvider(RPC_URL, network, { staticNetwork: true });
            const relayerWallet = new ethers.Wallet(PRIVATE_KEY, provider);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                "function submitAIMove(address player, string newFEN, string newPGN) external",
                "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
            ], relayerWallet);
    
           // const tx = await contract.submitAIMove(playerAddress, game.fen(), game.pgn());
            
            // 5. RESTORE STATE FROM ON-CHAIN
            const gameData = await contract.matches(playerAddress);
            if (!gameData || !gameData[6]) throw new Error("No active game found.");
    
            const game = new Chess(gameData[2]); // gameData[2] is currentFEN
            
            // Validate local move against on-chain FEN
            if (!game.move(moveObj)) {
                throw new Error(`Invalid move: ${moveString}`);
            }

           
          const taskId = await contract.playerLastTaskId(playerAddress);
      
         // 4. WATCHER: Poll the Inference Engine (PoI)
         const inferenceEngine = new ethers.Contract(INFERENCE_ADDRESS, [
             "function getTaskStatus(bytes32 taskId) external view returns (bytes32 resultHash, bool finalized)"
         ], relayerWallet);
         
         let finalized = false;
         for (let i = 0; i < 20; i++) {
             const status = await inferenceEngine.getTaskStatus(taskId);
             if (status.finalized) {
                 finalized = true;
                 break;
             }
             await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds
         }
         
         if (!finalized) throw new Error("PoI Timeout: Inference not finalized");
         
         // 5. COMMIT TO CHAIN: Submit the AI's move using the finalized task
         // Ensure this matches your contract's submitAIMove signature
         const tx = await contract.submitAIMove(playerAddress, game.fen(), game.pgn());
         await tx.wait();
         
         return res.status(200).json({ success: true, txHash: tx.hash });
    
        } catch (err) {
            console.error("CRASH REPORT:", err);
            return res.status(500).json({ 
                success: false, 
                crashReport: err.message, 
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined 
            });
        }
    } catch (err) {
        console.error("RELAYER_CRASH:", err); // This is the key to seeing the error
        return res.status(500).json({ success: false, crashReport: err.message });
    }
}
