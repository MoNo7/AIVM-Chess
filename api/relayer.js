//process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
    // 🟢 UPDATE 1: Accept the split payload (moveObj and moveString) from app.js
    const { playerAddress, moveObj, moveString } = req.body;
    const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
    const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";

    try {
        // 1. RPC SANITY CHECK
        const healthCheck = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
        });

        if (!healthCheck.ok) {
            const errorBody = await healthCheck.text();
            console.error("RPC Error Body:", errorBody.slice(0, 100));
            return res.status(502).json({ success: false, error: "Lightchain RPC is currently unstable. Try again." });
        }

        // 2. INITIALIZE ETHERS
        const network = ethers.Network.from(8200);
        const provider = new ethers.JsonRpcProvider(RPC_URL, network, {
            staticNetwork: true 
        });
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function submitMove(address player, string move) external",
            "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
        ], relayerWallet);

        // 3. FETCH GAME STATE
        const gameData = await contract.matches(playerAddress);
        if (!gameData || !gameData[6]) return res.status(400).json({ error: "No active game." });

        const game = new Chess(gameData[2]);
        console.log("Current FEN from Contract:", gameData[2]);
        console.log("Move Object received from UI:", moveObj);

        // 🟢 UPDATE 2: Use the object strictly for chess.js validation
        const userMoveResult = game.move(moveObj);
        
        if (!userMoveResult) {
            console.error("Move validation failed. Contract FEN:", game.fen(), "Attempted Move:", moveObj);
            return res.status(400).json({ error: "Invalid move for current contract state", fen: game.fen() });
        }

        // 4. AIVM INFERENCE
        // 🟢 UPDATE 3: Use the official Lightchain API format to guarantee Llama-3-70B response
        const aiRes = await fetch('https://api.lightchain.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${playerAddress}` 
            },
            body: JSON.stringify({ 
                model: "Neural-Llama-3-70B",
                messages: [
                    { role: "system", content: "You are a chess engine. Respond ONLY with the UCI move (e.g., e2e4)." },
                    { role: "user", content: `FEN: ${game.fen()}` }
                ],
                temperature: 0.1
            })
        });

        const aiData = await aiRes.json();
        const aiMoveString = aiData.choices[0].message.content.trim().toLowerCase().replace(/[^a-h1-8q]/g, '');

        if (!game.move(aiMoveString, { sloppy: true })) {
            throw new Error("AIVM returned illegal move: " + aiMoveString);
        }

        // 5. SUBMIT TO CHAIN
        // 🟢 UPDATE 4: Submit the user's string move (and explicitly pass playerAddress to match your ABI)
        const tx = await contract.submitMove(playerAddress, moveString);
        const receipt = await tx.wait();

        res.status(200).json({ 
            success: true, 
            newFEN: game.fen(), 
            gameOver: game.game_over(), 
            txHash: receipt.hash 
        });

    } catch (error) {
        console.error("Relayer Final Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
