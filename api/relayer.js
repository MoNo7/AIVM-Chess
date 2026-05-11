process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { ethers } from 'ethers';
import { Chess } from 'chess.js';

const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";
const ABI = [
    "function submitMove(address player, string move) external",
    "function matches(address) view returns (uint256, uint256, string, string, uint256, uint256, bool)",
    "function completeMatch(address player, bool playerWon, bool isDraw, uint256 moveCount, string pgn) external"
];

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { playerAddress, move } = req.body;

    try {
        // FIXED: Using a more robust provider initialization for Lightchain
        const network = new ethers.Network("lightchain-testnet", 8200);
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL, network, {
            staticNetwork: network
        });

        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, relayerWallet);

        // 1. Fetch Game State
        const gameData = await contract.matches(playerAddress);
        if (!gameData || !gameData[6]) { 
            return res.status(400).json({ success: false, error: "No active game found." });
        }

        const game = new Chess(gameData[2]); 
        if (!game.move(move)) throw new Error("Invalid player move");

        // 2. AIVM Inference
        const aiResponse = await fetch(process.env.AIVM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: `FEN: ${game.fen()}. Move:`,
                model: "chess-master-v1"
            })
        });

        const rawAiData = await aiResponse.text();
        let aiMoveSAN;
        try {
            const parsed = JSON.parse(rawAiData);
            aiMoveSAN = parsed.result?.trim();
        } catch (e) {
            aiMoveSAN = rawAiData.trim();
        }

        if (!game.move(aiMoveSAN)) throw new Error("AIVM returned illegal move: " + aiMoveSAN);

        // 3. Submit to Chain
        const tx = await contract.submitMove(playerAddress, aiMoveSAN);
        await tx.wait();

        res.status(200).json({ success: true, aiMove: aiMoveSAN, newFEN: game.fen() });

    } catch (error) {
        console.error("Relayer Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
