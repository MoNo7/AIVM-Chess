import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    
    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // Use the specific ABI for the function you are calling
        const abi = [
            "function requestAIMove(address player, string memory currentFEN) external returns (uint256)"
        ];
        
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, relayerWallet);
        console.log("Functions in ABI:", contract.interface.fragments.map(f => f.name));
        
        console.log("Attempting requestAIMove on:", process.env.CONTRACT_ADDRESS);

        // Perform the transaction
        const tx = await contract.requestAIMove(playerAddress, currentFEN, {
            gasLimit: 800000
        });
        
        const receipt = await tx.wait();

        return res.status(200).json({ 
            success: true, 
            txHash: receipt.hash 
        });
            
    } catch (e) {
        console.error("Relayer execution failed:", e);
        return res.status(400).json({ 
            success: false, 
            error: e.reason || "Transaction failed. Please ensure contract is deployed and address is correct." 
        });
    }
}
