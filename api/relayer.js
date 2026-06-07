import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // 1. Update your contract function signature ABI array element
        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS, 
            ["function requestAIMove(address coordinatorAddress, address player, string memory currentFEN) external returns (bytes32)"], 
            relayerWallet
        );

        const COORDINATOR_ADDRESS = "0x0000000000000000000000000000000000000001"; 

        // 2. Pass playerAddress as the middle argument
        const tx = await contract.requestAIMove(COORDINATOR_ADDRESS, playerAddress, currentFEN);
        await tx.wait();

        // 4. Return the transaction hash back to your frontend app.js
        return res.status(200).json({ success: true, txHash: tx.hash });

    } catch (error) {
        console.error("Relayer execution crashed:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
