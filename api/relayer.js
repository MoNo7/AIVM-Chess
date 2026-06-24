import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        const fullAbi = [
            "function requestAIMove(address player, string currentFEN) external returns (uint256)",
            "function submitAIMove(address player, string newFEN, string newPGN) external"
        ];
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, fullAbi, relayerWallet);
        
        // 1. Sync Player Move First
        try {
            const txSync = await contract.requestAIMove(playerAddress, currentFEN);
            await txSync.wait();
        } catch (e) {
            console.warn("Sync warning (possible race):", e.message);
        }

        // 2. Fetch AI Inference
        const aiResponse = await fetch("https://api.lightchain-protocol.com/inference", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ position: currentFEN })
        });

        const data = await aiResponse.json();
        const aiMove = data.move;

        // 3. Apply and Submit AI Move
        const game = new Chess(currentFEN);
        game.move(aiMove);
        
        const txSubmit = await contract.submitAIMove(playerAddress, game.fen(), game.pgn());
        await txSubmit.wait();

        return res.status(200).json({ success: true, newFEN: game.fen() });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
