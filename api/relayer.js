import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // Fully defined string ABI signature matching your deployed code
        const fullAbi = [
            "function requestAIMove(address coordinatorAddress, address player, string currentFEN) external returns (bytes32)"
        ];

        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS, 
            fullAbi, 
            relayerWallet
        );

        // Official pre-deployed testnet coordinator address
        const COORDINATOR_ADDRESS = "0x0000000000000000000000000000000000000001"; 

        console.log(`Relayer executing on-chain request for player: ${playerAddress}`);

        // Explicitly pass arguments to prevent any internal data formatting errors
        const tx = await contract.requestAIMove(COORDINATOR_ADDRESS, playerAddress, currentFEN);
        await tx.wait(); 

        return res.status(200).json({ success: true, txHash: tx.hash });

    } catch (error) {
        console.error("Relayer execution crashed:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
