import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { playerAddress } = req.body;
    const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        
        // 1. Get the match data and the latest TaskID from the contract
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, [
            "function matches(address) view returns (uint256, uint256, string, string, uint256, uint256, bool, bool)",
            "function playerLastTaskId(address) view returns (bytes32)"
        ], provider);
        
        const taskId = await contract.playerLastTaskId(playerAddress);

        // 2. Poll the native AIVM status using the supported method
        const status = await provider.send("lcai_getInferenceStatus", [taskId]);
        
        if (status.status !== "finalized") {
            return res.status(202).json({ success: false, message: "AIVM Processing..." });
        }

        // 3. Retrieve the verified output
        const result = await provider.send("lcai_getInferenceResult", [taskId]);
        
        // 4. Return the result to your app.js so it can complete the state transition
        return res.status(200).json({ success: true, aiMove: result.output });

    } catch (err) {
        console.error("Relayer error:", err);
        return res.status(500).json({ success: false, crashReport: err.message });
    }
}
