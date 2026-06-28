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
        
        // 1. Sync Player Move
        try {
            const txSync = await contract.requestAIMove(playerAddress, currentFEN);
            await txSync.wait();
        } catch (e) {
            console.warn("Sync warning:", e.message);
        }

        // 2. Fetch AI Inference (REST API Approach)
        const aiResponse = await fetch(`${process.env.AI_PROVIDER_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.LIGHTCHAIN_API_KEY}`
            },
            body: JSON.stringify({
                model: process.env.MODEL_NAME,
                messages: [{ role: "user", content: `Return only the new FEN for the next move based on this board: ${currentFEN}` }]
            })
        });
        
        const aiData = await aiResponse.json();
        
        if (!aiResponse.ok || !aiData.choices?.[0]?.message?.content) {
            console.error("Inference Error:", aiData);
            return res.status(502).json({ error: "AI Inference failed." });
        }
        
        const aiMoveFEN = aiData.choices[0].message.content.trim();

        // 3. Submit to Contract
        // Ensure you have the PGN logic ready; here we pass an empty string if not generated
        const tx = await contract.submitAIMove(playerAddress, aiMoveFEN, "");
        await tx.wait();
        
        return res.status(200).json({ success: true, fen: aiMoveFEN });

    } catch (error) {
        console.error("Relayer Fatal Error:", error);
        return res.status(500).json({ error: "Execution failed." });
    }
}
