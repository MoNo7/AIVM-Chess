import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // Added 'payable' to the ABI so it accepts value
        const abi = [
            "function requestAIMove(address player, string memory currentFEN) external payable returns (uint256)"
        ];
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, relayerWallet);

        const revertReason = await contract.requestAIMove.staticCall(playerAddress, currentFEN);
        
        const GAS_PER_MOVE = ethers.parseEther("0.5");

        const tx = await contract.requestAIMove(playerAddress, currentFEN, {
            value: GAS_PER_MOVE 
        });
        const receipt = await tx.wait();
        return res.status(200).json({ success: true, txHash: receipt.hash });
            
    } catch (e) {
        const rawData = e.data || (e.info && e.info.error && e.info.error.data);
        console.error("DEBUG - Full Revert Data:", rawData); 
        console.error("Relayer execution failed:", e);

        let errorMessage = e.reason || e.shortMessage || e.message || "Unknown Error";

        const revertData = e.data || (e.info && e.info.error && e.info.error.data);

        if (revertData && typeof revertData === 'string' && revertData.startsWith("0x08c379a0")) {
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
