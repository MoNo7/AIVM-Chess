import { ethers } from 'ethers';

export default async function handler(req, res) {
    const { playerAddress } = req.body;
    const RPC_URL = process.env.LIGHTCHAIN_RPC_URL;
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    try {
        // 1. Get the taskId from your contract
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, [
            "function playerLastTaskId(address) view returns (bytes32)"
        ], provider);
        
        const taskId = await contract.playerLastTaskId(playerAddress);

        // 2. Use the NATIVE method to check inference status
        // This replaces your 'fetch' to the chat API
        const status = await provider.send("lcai_getInferenceStatus", [taskId]);
        
        if (status.status === "finalized") {
            const result = await provider.send("lcai_getInferenceResult", [taskId]);
            return res.status(200).json({ success: true, aiMove: result.output });
        }
        
        return res.status(202).json({ success: false, message: "Processing..." });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
