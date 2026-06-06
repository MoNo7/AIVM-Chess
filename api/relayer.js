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
        if (!req.body || !req.body.moveObj) {
            return res.status(400).json({ success: false, error: "Missing moveObj" });
        }
    
        try {
            const { playerAddress, moveObj, moveString } = req.body;
            
            // Configuration Setup
            const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
            const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
            const CONTRACT_ADDRESS = "0x542280fB7A2d1dBCcF995033809C778F67D9870D";
            
            // Verified target completion route on the chat2 cluster infrastructure
            const API_ENDPOINT = "https://chat2.lightchain.ai/v1/chat/completions";
    
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
            
            // 5. RESTORE STATE FROM ON-CHAIN
            const gameData = await contract.matches(playerAddress);
            if (!gameData || !gameData[6]) throw new Error("No active game found.");
    
            const game = new Chess(gameData[2]); // Current contract FEN string state
            
            // Apply human player's move locally first
            if (!game.move(moveObj)) {
                throw new Error(`Invalid player move sequence: ${moveString}`);
            }

            // 6. LIGHTCHAIN AIVM AI INFERENCE
            console.log("Requesting native cluster inference for position:", game.fen());
            
            const aiRes = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${playerAddress}`
                },
                body: JSON.stringify({
                    model: "Neural-Llama-3-70B",
                    messages: [
                        { role: "system", content: "You are a grandmaster chess engine playing as black. Output ONLY the best next valid square move coordinate string in clean UCI notation (e.g. e7e5, g8f6) with no commentary." },
                        { role: "user", content: `Current chess board FEN position context: ${game.fen()}` }
                    ],
                    temperature: 0.1
                })
            });

            if (!aiRes.ok) {
                const errContext = await aiRes.text();
                throw new Error(`Lightchain AIVM Inference Engine clusters rejected request: ${errContext}`);
            }
    
            const aiData = await aiRes.json();
            if (!aiData.choices || aiData.choices.length === 0) {
                throw new Error("Invalid response structure returned by Lightchain AI Cluster endpoint.");
            }

            const rawAiContent = aiData.choices[0].message.content;
            const aiMoveString = rawAiContent.trim().toLowerCase().replace(/[^a-h1-8q]/g, '');
            console.log("Native AIVM responded with move:", aiMoveString);
    
            // Apply AI move locally to sync final state parameters before broadcasting
            if (!game.move(aiMoveString, { sloppy: true })) {
                throw new Error(`AIVM returned illegal move string expression: ${aiMoveString}`);
            }
    
            // 7. BROADCAST FINAL SYNC STATE UPDATE TO REFEREE
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
            return res.status(500).json({ 
                success: false, 
                crashReport: err.message 
            });
        }
    } catch (err) {
        console.error("RELAYER_CRASH:", err);
        return res.status(500).json({ success: false, crashReport: err.message });
    }
}
