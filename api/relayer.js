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
        const rawData = e.data || (e.info && e.info.error && e.info.error.data);
        console.error("DEBUG - Full Revert Data:", rawData); // Look at this in Vercel logs!
        // Log the full error to Vercel console so you can see it in the dashboard
        console.error("Relayer execution failed:", e);

        let errorMessage = e.reason || e.shortMessage || e.message;

        // Ethers v6 often hides the revert data in the 'data' property
        // or inside 'e.info.error.data' for some providers
        const revertData = e.data || (e.info && e.info.error && e.info.error.data);

        if (revertData && revertData.startsWith("0x08c379a0")) {
            try {
                const iface = new ethers.Interface(["function Error(string)"]);
                const decoded = iface.decodeFunctionData("Error", revertData);
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
