import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { playerAddress, currentFEN } = req.body;

    try {
        // Vercel check: Ensure the contract address isn't missing!
        const contractAddress = process.env.CONTRACT_ADDRESS;
        if (!contractAddress) {
            throw new Error("CONTRACT_ADDRESS is missing in Vercel Environment Variables");
        }

        console.log(`Submitting task for FEN: ${currentFEN}`);

        // 1. Submit to Lightchain AIVM via RPC
        const response = await fetch("https://rpc.testnet.lightchain.ai", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "lcai_submitInferenceTask",
                params: [{
                    model: "chess-aivm", 
                    input: currentFEN,
                    maxGas: "0x7a120", // 500,000 gas
                    callbackContract: contractAddress
                }],
                id: 1
            })
        });

        const data = await response.json();
        
        // 2. Did Lightchain reject it? Catch the specific RPC error!
        if (data.error) {
            console.error("Lightchain RPC Error:", data.error);
            return res.status(500).json({ 
                success: false, 
                error: "Lightchain RPC Error: " + (data.error.message || JSON.stringify(data.error)) 
            });
        }

        // 3. Success! Return the Task ID
        if (data.result && data.result.taskId) {
            return res.status(200).json({ success: true, taskId: data.result.taskId });
        } else {
            return res.status(500).json({ success: false, error: "No taskId returned by AIVM", details: data });
        }

    } catch (error) {
        console.error("Relayer execution crashed:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
