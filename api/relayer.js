import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { playerAddress } = req.body;
    const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
    const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
    const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const relayerWallet = new ethers.Wallet(PRIVATE_KEY, provider);
        
        // 1. Setup contract instance with full write capabilities
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function submitAIMove(address player, string newFEN, string newPGN) external",
            "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)",
            "function playerLastTaskId(address) view returns (bytes32)"
        ], relayerWallet);

        // 2. Get TaskID
        const taskId = await contract.playerLastTaskId(playerAddress);
        
        // 3. Check status
        const status = await provider.send("lcai_getInferenceStatus", [taskId]);
        
        if (status.status !== "finalized") {
            return res.status(202).json({ success: false, message: "Still processing" });
        }

        // 4. Get the AI Move
        const result = await provider.send("lcai_getInferenceResult", [taskId]);
        const aiMove = result.output.trim();

        // 5. Update local state to get new FEN
        const gameData = await contract.matches(playerAddress);
        const game = new Chess(gameData[2]); 
        game.move(aiMove, { sloppy: true });

        // 6. SUBMIT TO CHAIN
        console.log("Submitting AI move to chain:", aiMove);
        const tx = await contract.submitAIMove(playerAddress, game.fen(), game.pgn());
        await tx.wait();
        
        return res.status(200).json({ 
            success: true, 
            newFEN: game.fen(),
            txHash: tx.hash 
        });

    } catch (err) {
        console.error("Relayer Error:", err);
        return res.status(500).json({ success: false, crashReport: err.message });
    }
}
