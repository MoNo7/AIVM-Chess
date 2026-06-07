import { ethers } from 'ethers';

export default async function handler(req, res) {
    const { playerAddress, currentFEN } = req.body;
    
    // Connect to your contract
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ["function requestAIMove(string memory currentFEN) external"], relayerWallet);

    // Trigger the contract's native request function
    const tx = await contract.requestAIMove(currentFEN);
    await tx.wait();

    return res.status(200).json({ success: true, txHash: tx.hash });
}
