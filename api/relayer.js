import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // 1. Initialize the contract instance HERE
        const abi = [
            "function requestAIMove(address player, string memory currentFEN) external returns (uint256)"
        ];
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, relayerWallet);

        // 2. Now you can use contract.requestAIMove
        // Use staticCall to catch the revert reason string
        const revertReason = await contract.requestAIMove.staticCall(playerAddress, currentFEN);
        
        // 3. If it passes, send the real transaction
        const tx = await contract.requestAIMove(playerAddress, currentFEN);
        const receipt = await tx.wait();
        
        return res.status(200).json({ success: true, txHash: receipt.hash });
            
    } catch (e) {
        console.error("Relayer execution failed:", e);
        // Add logic to check if it's an Out of Gas error or a Revert
        const errorDetails = e.data || e.reason || e.message;
        return res.status(400).json({ 
            success: false, 
            error: `Relayer Error: ${errorDetails}` 
        });
    }
}
