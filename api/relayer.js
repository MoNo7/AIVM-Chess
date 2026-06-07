import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { playerAddress, currentFEN } = req.body;
    
    // 1. Submit to Lightchain AIVM via RPC
    const response = await fetch("https://rpc.testnet.lightchain.ai", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "lcai_submitInferenceTask",
            params: [{
                model: "chess-aivm", // Ensure this model name is correct
                input: currentFEN,
                maxGas: "0x7a120", // 500,000 gas
                callbackContract: process.env.CONTRACT_ADDRESS
            }],
            id: 1
        })
    });

    const data = await response.json();
    if (data.result && data.result.taskId) {
        // Task is submitted! The AIVM will now callback to your contract
        // You do not need to poll or sign another transaction here.
        return res.status(200).json({ success: true, taskId: data.result.taskId });
    } else {
        return res.status(500).json({ success: false, error: "AIVM submission failed" });
    }
}
