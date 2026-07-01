import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    
    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // Define the interface specifically
        const iface = new ethers.Interface([
            "function requestAIMove(address player, string memory currentFEN) external returns (uint256)"
        ]);
        
        await contract.requestAIMove.staticCall(playerAddress, currentFEN, {
            gasLimit: 800000
        });
        
        // 2. If simulation passes, execute the real transaction
        const tx = await contract.requestAIMove(playerAddress, currentFEN, {
            gasLimit: 800000
        });
        const receipt = await tx.wait();
        return res.status(200).json({ success: true, txHash: receipt.hash });
            
    } catch (e) {
        // Log the full error to see if it's the 'onlyRelayer' modifier
        console.error("Relayer execution failed:", e);
        return res.status(400).json({ 
            success: false, 
            error: "Transaction reverted. Check if the Relayer Wallet is authorized in the contract." 
        });
    }
}
