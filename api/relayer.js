import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });
    
    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // Updated ABI to include 'payable' and the view functions for logging
        const abi = [
            {
              "inputs": [
                { "internalType": "address", "name": "player", "type": "address" },
                { "internalType": "string", "name": "fen", "type": "string" }
              ],
              "name": "requestAIMove",
              "outputs": [],
              "stateMutability": "payable", 
              "type": "function"
            },
            {
              "inputs": [],
              "name": "CHESS_AI_MODEL_DIGEST",
              "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
              "stateMutability": "view",
              "type": "function"
            },
            {
              "inputs": [],
              "name": "inferenceAnchor",
              "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
              "stateMutability": "view",
              "type": "function"
            }
        ];
        
        const contractAddress = process.env.CONTRACT_ADDRESS;
        const contract = new ethers.Contract(contractAddress, abi, relayerWallet);
        
        const GAS_PER_MOVE = ethers.parseEther("0.5");

        // --- Debug Logs ---
        console.log(`[Relayer] Initiating AI move for ${playerAddress}. FEN: ${currentFEN}`);
        console.log("DEBUG - Using Model Digest:", await contract.CHESS_AI_MODEL_DIGEST());
        console.log("DEBUG - Calling Contract:", contractAddress);
        
        const anchor = await contract.inferenceAnchor();
        console.log("DEBUG - Current Inference Anchor:", anchor);

        // 1. Simulate the transaction first using staticCall
        // If this fails, it will immediately throw to the catch block, saving you gas.
        console.log("[Relayer] Simulating transaction via staticCall...");
        await contract.requestAIMove.staticCall(playerAddress, currentFEN, { 
            value: GAS_PER_MOVE, 
            gasLimit: 3000000 
        });

        // 2. If staticCall succeeds, execute the actual transaction
        console.log("[Relayer] Simulation passed. Sending transaction...");
        const tx = await contract.requestAIMove(playerAddress, currentFEN, {
            value: GAS_PER_MOVE,
            gasLimit: 3000000
        });
        
        console.log(`[Relayer] TX sent: ${tx.hash}`);
        const receipt = await tx.wait();
        
        return res.status(200).json({ success: true, txHash: receipt.hash });
            
    } catch (error) {
        console.error("[Relayer] Execution Failed:", error);

        // Safely extract revert data
        const rawData = error.data || (error.info && error.info.error && error.info.error.data) || (error.receipt && error.receipt.data) || null;
        
        if (rawData) console.error("DEBUG - Raw Revert Data:", rawData);

        let userMessage = "An unknown error occurred during the AI request.";
        let errorCode = "UNKNOWN_ERROR";

        // Ethers v6 Error Decoding
        if (error.code === 'CALL_EXCEPTION') {
            errorCode = "CONTRACT_REVERT";
            userMessage = error.reason || error.shortMessage || "The smart contract reverted the transaction.";
        } else if (error.code === 'INSUFFICIENT_FUNDS') {
            errorCode = "GAS_FUNDS_LOW";
            userMessage = "The relayer wallet is out of gas funds.";
        }

        // Attempt to manually decode Solidity Error(string) if we have raw hex data but no parsed reason
        if (!error.reason && rawData && typeof rawData === 'string' && rawData.startsWith("0x08c379a0")) {
            try {
                const iface = new ethers.Interface(["function Error(string)"]);
                const decoded = iface.decodeFunctionData("Error", rawData);
                userMessage = decoded[0];
            } catch (err) {
                console.error("Failed to decode revert reason:", err);
            }
        }

        // Return a structured 500 response so the frontend can display it cleanly
        return res.status(500).json({ 
            success: false, 
            code: errorCode,
            message: userMessage,
            rawHex: rawData
        });
    }
}
