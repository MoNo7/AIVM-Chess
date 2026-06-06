import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { playerAddress } = req.body;
    const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";

    try {
        // 1. Fetch the Task ID currently registered on-chain for the player
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        
        // 2. Poll the status using the supported custom method
        // Note: You need to get the taskId from your contract first
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ["function playerLastTaskId(address) view returns (bytes32)"], provider);
        const taskId = await contract.playerLastTaskId(playerAddress);

        // 3. Use the system method: lcai_getInferenceStatus
        const status = await provider.send("lcai_getInferenceStatus", [taskId]);
        
        if (status.status === "finalized") {
            // 4. Retrieve the actual result
            const result = await provider.send("lcai_getInferenceResult", [taskId]);
            
            // Proceed to submit to contract as before...
            return res.status(200).json({ success: true, move: result.output });
        }
        
        return res.status(202).json({ success: false, message: "Still processing" });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
