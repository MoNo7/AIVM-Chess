import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        const fullAbi = [
           // "function requestAIMove(address player, string currentFEN) external returns (uint256)",
            "function requestAIMove(address player, string memory currentFEN) external returns (uint256)",
            "function submitAIMove(address player, string newFEN, string newPGN) external"
        ];
        //const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, fullAbi, relayerWallet);
                
        // 1. Sync Player Move
        try {
            const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, fullAbi, relayerWallet);
            const txSync = await contract.requestAIMove(playerAddress, currentFEN, {
                gasLimit: 500000 
            });
            
            //const txSync = await contract.requestAIMove(playerAddress, currentFEN);
            //await txSync.wait();
            const receipt = await txSync.wait();

            // 4. Return a successful 200 response to the frontend
            return res.status(200).json({ 
                success: true, 
                txHash: receipt.hash 
            });
            
        } catch (e) {
            console.warn("Sync warning:", e.message);
            console.error("Relayer execution failed:", e );

            return res.status(400).json({ 
                success: false, 
                error: "AI Inference failed to trigger on-chain. Please verify match state." 
            });
        }

        // 2. Fetch AI Inference (REST API Approach)
        console.log("Sending to relayer:", { playerAddress, currentFEN });
        const aiResponse = await fetch(`${process.env.LIGHTCHAIN_RPC_URL}/chat/completions`, {
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
        
      const responseText = await aiResponse.text();
        
        if (!aiResponse.ok) {
            console.error("Inference Error Response:", responseText);
            return res.status(502).json({ error: "AI Inference failed.", details: responseText });
        }
        
        const aiData = JSON.parse(responseText);
        const aiMoveFEN = aiData.choices?.[0]?.message?.content?.trim();

        if (!aiMoveFEN) {
            return res.status(502).json({ error: "AI returned invalid response format." });
        }

        // 4. Submit to Contract
        const tx = await contract.submitAIMove(playerAddress, aiMoveFEN, "");
        await tx.wait();
        
        return res.status(200).json({ success: true, fen: aiMoveFEN });

    } catch (error) {
        console.error("Relayer Fatal Error:", error);
        return res.status(500).json({ error: "Internal server error during relayer execution." });
    }
}
