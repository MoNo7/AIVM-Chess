import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    // FIX 3: Receive the currentFEN from the frontend
    const { playerAddress, currentFEN } = req.body;
    
    const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
    const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
    const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const relayerWallet = new ethers.Wallet(PRIVATE_KEY, provider);
        
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function playerLastTaskId(address) view returns (bytes32)",
            "function submitAIMove(address player, string newFEN, string newPGN) external"
        ], relayerWallet);

        // INSTEAD OF LOOKING UP A BLANK TASK ID:
        // You must POST to the Lightchain REST API to *start* a new chess engine inference using currentFEN
        const startTaskResponse = await fetch(`https://api.testnet.lightchain.ai/api/v1/inference/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: currentFEN, model: "chess-aivm" })
        });
        const taskData = await startTaskResponse.json();
        const taskId = taskData.taskId;

        if (!taskId || taskId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
            return res.status(400).json({ success: false, message: "No active task found" });
        }

        // NOW you can poll the status...
        const statusResponse = await fetch(`https://api.testnet.lightchain.ai/api/v1/inference/status/${taskId}`);
        const statusData = await statusResponse.json();

        if (statusData.status !== "finalized") {
            return res.status(202).json({ success: false, message: "AIVM Processing..." });
        }

        // 3. Get the result
        const resultResponse = await fetch(`https://api.testnet.lightchain.ai/api/v1/inference/result/${taskId}`);
        const resultData = await resultResponse.json();

        // 4. Submit move to chain
        // Note: resultData.output is expected to be your new FEN/PGN string
        const tx = await contract.submitAIMove(playerAddress, resultData.output, "AI Move");
        await tx.wait();

        return res.status(200).json({ success: true, newFEN: resultData.output });

    } catch (err) {
        console.error("Relayer Error:", err);
        return res.status(500).json({ success: false, crashReport: err.message });
    }
}
