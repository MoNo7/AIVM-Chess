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
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL, null, {
            staticNetwork: new ethers.Network("lightchain-testnet", 8200)
        });
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, relayerWallet);

        // --- MOVE THIS LOGIC INSIDE THE HANDLER ---
        const gameData = await contract.matches(playerAddress);
        
        // gameData[6] corresponds to 'isActive' in your struct
        if (!gameData || !gameData[6]) { 
            return res.status(400).json({ success: false, error: "No active game found." });
        }
        // ------------------------------------------

        const game = new Chess(gameData[2]); // currentFEN
        if (!game.move(move)) throw new Error("Invalid player move");

        // ... rest of your AIVM and transaction logic ...
        const aiResponse = await fetch(process.env.AIVM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: `FEN: ${game.fen()}. Move:`,
                model: "chess-master-v1"
            })
        });

        const rawAiData = await aiResponse.text();
        let aiMoveSAN = rawAiData.trim(); // Simplified for now
        
        game.move(aiMoveSAN);

        let tx = await contract.submitMove(playerAddress, aiMoveSAN);
        await tx.wait();

        res.status(200).json({ success: true, aiMove: aiMoveSAN, newFEN: game.fen() });

    } catch (error) {
        console.error("Relayer Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
