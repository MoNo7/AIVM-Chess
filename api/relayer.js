import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    
    const { playerAddress, currentFEN } = req.body;

    try {
        // 1. Setup Provider & Wallet
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // 2. Define Full ABI
        const fullAbi = [
            "function requestAIMove(address player, string memory currentFEN) external returns (uint256)",
            "function submitAIMove(address player, string newFEN, string newPGN) external"
        ];
        
        // 3. Initialize Contract
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, fullAbi, relayerWallet);
        
        console.log("Triggering on-chain request for:", playerAddress);

        // 4. Execute Transaction
        const tx = await contract.requestAIMove(playerAddress, currentFEN, {
            gasLimit: 800000 
        });
        
        console.log("Transaction sent. Hash:", tx.hash);
        const receipt = await tx.wait();

        return res.status(200).json({ 
            success: true, 
            txHash: receipt.hash 
        });
            
    } catch (e) {
        console.error("Relayer execution failed:", e.message);
        
        return res.status(400).json({ 
            success: false, 
            error: e.reason || "Transaction reverted. Check contract state (active match/auth)." 
        });
    }
}
