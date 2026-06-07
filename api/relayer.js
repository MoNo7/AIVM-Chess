import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // Use the exact signature from your AIVMChessReferee contract
        const fullAbi = [
            "function requestAIMove(address player, string currentFEN) external returns (uint256)"
        ];

        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS, 
            fullAbi, 
            relayerWallet
        );

        console.log(`Relayer executing on-chain request for player: ${playerAddress}`);

        // Call the referee contract, which will handle hashing and passing to the Coordinator
        const tx = await contract.requestAIMove(playerAddress, currentFEN);
        
        await tx.wait(); 
        return res.status(200).json({ success: true, txHash: tx.hash });

    } catch (error) {
        console.error("Relayer execution crashed:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
