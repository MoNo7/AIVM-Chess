import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // Pass the contract ABI containing your new function signature
        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS, 
            ["function requestAIMove(address coordinatorAddress, string memory currentFEN) external returns (bytes32)"], 
            relayerWallet
        );

        // Replace this address placeholder with the Coordinator address found in the Lightchain docs
        const COORDINATOR_ADDRESS = "0x0000000000000000000000000000000000000001"; // Update to match network system specs

        // Execute the native contract call
        const tx = await contract.requestAIMove(COORDINATOR_ADDRESS, currentFEN);
        const receipt = await tx.wait();

        // Parse logs or receipts to pull the native taskId out if needed
        return res.status(200).json({ success: true, txHash: tx.hash });

    } catch (error) {
        console.error("Relayer execution crashed:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
