import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
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
        
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, relayerWallet);
        
        const GAS_PER_MOVE = ethers.parseEther("0.5");

        // Debug Logs
        console.log("DEBUG - Using Model Digest:", await contract.CHESS_AI_MODEL_DIGEST());
        console.log("DEBUG - Calling Contract:", process.env.CONTRACT_ADDRESS);
        
        const anchor = await contract.inferenceAnchor();
        console.log("DEBUG - Current Inference Anchor:", anchor);

        const unsignedTx = await contract.requestAIMove.populateTransaction(playerAddress, currentFEN, { value: ethers.parseEther("0.5"), gasLimit: 3000000 });

        try {
            await contract.requestAIMove.staticCall(playerAddress, currentFEN, { value: GAS_PER_MOVE, gasLimit: 3000000 })
        } catch (staticError) {
            console.error("STATIC CALL FAILED - REVERT REASON:", staticError.reason || staticError.info?.error?.message);
            // You can also inspect staticError.data here if it exists
            console.error("STATIC CALL FAILED!");
            // This logs the full error object so we can see if it has 'data'
            console.error("Full staticError object:", staticError); 
            
            // Specifically log the hex data if it exists
            if (staticError.data) {
                console.log("Raw Revert Hex Data:", staticError.data);
            }
        }

        const wallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const signer = wallet.connect(provider); // Make sure this is defined in your scope

        const tx = await signer.sendTransaction({
            to: process.env.CONTRACT_ADDRESS,
            data: unsignedTx.data, // THIS IS LIKELY WHAT IS MISSING
            value: ethers.parseEther("0.5") 
        });
        
        //const tx = await contract.requestAIMove(playerAddress, currentFEN, {
        //    value: GAS_PER_MOVE,
        //    gasLimit: 3000000
        //});
        
        const receipt = await tx.wait();
        return res.status(200).json({ success: true, txHash: receipt.hash });
            
    } catch (e) {
        console.error("Relayer execution failed:", e);

        // Safely extract revert data using the catch variable 'e'
        const rawData = e.data || (e.info && e.info.error && e.info.error.data) || (e.receipt && e.receipt.data);
        console.error("DEBUG - Full Revert Data:", rawData);

        // Use 'e' consistently instead of 'error'
        if (rawData) {
            console.log("Raw Revert Data detected:", rawData);
        } else if (e.receipt && e.receipt.revertReason) {
            console.log("Revert Reason:", e.receipt.revertReason);
        } else {
            console.log("Full error object captured:", e);
        }

        let errorMessage = e.reason || e.shortMessage || e.message || "Unknown Error";

        // Attempt to decode Solidity Error(string)
        if (rawData && typeof rawData === 'string' && rawData.startsWith("0x08c379a0")) {
            try {
                const iface = new ethers.Interface(["function Error(string)"]);
                const decoded = iface.decodeFunctionData("Error", rawData);
                errorMessage = decoded[0];
            } catch (err) {
                console.error("Failed to decode revert reason:", err);
            }
        }

        return res.status(400).json({ 
            success: false, 
            error: errorMessage 
        });
    }
}
