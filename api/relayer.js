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

        // 2. Fetch AI Inference via JSON-RPC
        const rpcPayload = {
            jsonrpc: "2.0",
            method: "lcai_submitInferenceTask",
            params: [{
                model: "lightchain-base-v1",
                input: currentFEN,
                maxGas: "0x7a120",
                callbackContract: process.env.CONTRACT_ADDRESS
            }],
            id: 1
        };

        const aiResponse = await fetch("https://rpc.testnet.lightchain.ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rpcPayload)
        });

        const aiData = await aiResponse.json();

        // 2b. Strict Validation
        if (!aiResponse.ok || aiData.error || !aiData.result) {
            console.error("AIVM Inference RPC Error:", aiData.error || aiResponse.statusText);
            return res.status(502).json({ error: "AI Inference RPC returned an error." });
        }

        // 3. Task initiated, proceed with contract submission (or handle async callback flow)
        try {
            // Note: If the contract requires the result immediately, ensure 
            // your callback logic is properly handling the async task ID.
            return res.status(200).json({ 
                success: true, 
                taskId: aiData.result.taskId,
                message: "Inference task submitted successfully." 
            });
        } catch (txError) {
            console.error("Contract TX Failed:", txError);
            return res.status(500).json({ error: "Smart contract execution failed." });
        }

    } catch (error) {
        console.error("Relayer Fatal Error:", error);
        return res.status(500).json({ error: "Internal relayer initialization or fatal execution error." });
    }
}
