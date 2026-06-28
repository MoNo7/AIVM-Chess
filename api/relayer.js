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
       // const aiResponse = await fetch("https://api.lightchain-protocol.com/inference", {
       //     method: "POST",
       //     headers: { "Content-Type": "application/json" },
        //    body: JSON.stringify({ position: currentFEN })
       // });
        const aiResponse = await fetch("https://testnet.lightchain.ai/your-inference-endpoint", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.LIGHTCHAIN_API_KEY}` // <-- Add whatever auth the new testnet requires
            },
            body: JSON.stringify({ fen: currentFen })
        });
        
        const aiData = await aiResponse.json();
        
        // 2. NEW: Strict Validation (Fail fast before hitting the contract)
        if (!aiResponse.ok || !aiData.fen) {
            console.error("AIVM Inference Error:", aiData);
            // Return early so we don't attempt a broken on-chain transaction
            return res.status(502).json({ error: "AIVM inference failed. Move aborted." });
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
}
