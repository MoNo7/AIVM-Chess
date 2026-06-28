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
          const aiResponse = await fetch("https://testnet.lightchain.ai/your-inference-endpoint", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.LIGHTCHAIN_API_KEY}` 
            },
            body: JSON.stringify({ fen: currentFEN }) 
        });
        
        // Capture raw response text first
        const responseText = await aiResponse.text();
        
        // Check if it's actually valid JSON before trying to parse it
        if (!aiResponse.ok) {
            console.error("AIVM Inference API Error:", aiResponse.status, responseText);
            return res.status(502).json({ error: "AI Inference API returned an error.", details: responseText });
        }
        
        let aiData;
        try {
            aiData = JSON.parse(responseText);
        } catch (e) {
            console.error("Failed to parse JSON from AI API. Raw response:", responseText);
            return res.status(502).json({ error: "Received invalid JSON from AI API." });
        }
        
        // 3. Safe to submit to contract
        try {
            const tx = await contract.submitAIMove(playerAddress, aiData.fen, aiData.pgn);
            await tx.wait();
            return res.status(200).json({ success: true, fen: aiData.fen });
        } catch (txError) {
            console.error("Contract TX Failed:", txError);
            return res.status(500).json({ error: "Smart contract execution failed." });
        }

    // FIX 2: Added the missing catch block to close out the top-level 'try' statement
    } catch (error) {
        console.error("Relayer Fatal Error:", error);
        return res.status(500).json({ error: "Internal relayer initialization or fatal execution error." });
    }
}
