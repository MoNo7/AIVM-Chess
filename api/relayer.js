import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { playerAddress, currentFEN } = req.body;

    try {
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        // ADDED: Include getInferenceAnchor in the ABI so the call succeeds
        const fullAbi = [
            "function requestInferenceV2(string model, bytes32 promptHash, bytes32 promptId, bytes32 modelDigest, bytes32 detConfigHash) external payable returns (uint256 requestId, bytes32 taskId)",
            "function getInferenceAnchor() external view returns (address)"
        ];

        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, fullAbi, relayerWallet);

        // Define your hashes (Ensure these match your logic)
        const promptHash = ethers.keccak256(ethers.toUtf8Bytes(currentFEN));
        const promptId = ethers.keccak256(ethers.toUtf8Bytes(playerAddress + Date.now().toString()));
        const modelDigest = "0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428848"; // From your contract
        const detConfigHash = ethers.keccak256(ethers.toUtf8Bytes("chess-default-config"));

        console.log(`Relayer executing on-chain request for player: ${playerAddress}`);

        // SINGLE, CORRECTED CALL
        const tx = await contract.requestInferenceV2(
            "chess-model-name", 
            promptHash, 
            promptId, 
            modelDigest, 
            detConfigHash
        );
        
        await tx.wait(); 
        return res.status(200).json({ success: true, txHash: tx.hash });

    } catch (error) {
        console.error("Relayer execution crashed:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
