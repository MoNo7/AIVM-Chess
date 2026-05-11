process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { ethers } from 'ethers';
import { Chess } from 'chess.js';

// --- Contract Configuration ---
// Verified from your Lightchain IDE deployment
const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";
const ABI = [
    "function previousAILossPGNs(uint256) view returns (string)",
    "function submitMove(address player, string move) external",
    "function matches(address) view returns (uint256, uint256, string, string, uint256, uint256, bool)",
    "function completeMatch(address player, bool playerWon, bool isDraw, uint256 moveCount, string pgn) external"
];

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { playerAddress, move } = req.body;

    try {
        // 1. Setup Provider & Signer
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, relayerWallet);

        // 2. Fetch Game State from Lightchain
        const gameData = await contract.matches(playerAddress);
        const currentFEN = gameData[2]; 
        
        // 3. Initialize Chess Engine
        const game = new Chess(currentFEN);
        
        // Apply player move locally
        const playerMove = game.move(move);
        if (!playerMove) throw new Error("Invalid move by player");

        // 4. Call Lightchain AIVM Inference
        const aiResponse = await fetch('https://testnet-rpc.lightchain.ai/v1/inference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: `You are a Chess Grandmaster playing Black. Current Board (FEN): ${game.fen()}. Provide only the SAN move (e.g., e5, Nf3).`,
                model: "chess-master-v1"
            })
        });

        const aiData = await aiResponse.json();
        const aiMoveSAN = aiData.result?.trim(); // Clean up whitespace

        if (!aiMoveSAN) {
            throw new Error("AIVM failed to return a move");
        }

        // Apply AI's move locally to check for game over
        const moveCheck = game.move(aiMoveSAN);
        if (!moveCheck) {
            throw new Error(`AIVM returned an illegal move: ${aiMoveSAN}`);
        }

        // 5. On-Chain Settlement or Move Update
        let tx;
        if (game.game_over()) {
            const playerWon = game.in_checkmate() && game.turn() === 'b';
            const isDraw = game.in_draw();
            
            tx = await contract.completeMatch(
                playerAddress, 
                playerWon, 
                isDraw, 
                game.history().length, 
                game.pgn()
            );
        } else {
            // Record the AI move on-chain via the relayer
            tx = await contract.submitMove(playerAddress, aiMoveSAN);
        }

        await tx.wait();

        res.status(200).json({ 
            success: true, 
            aiMove: aiMoveSAN, 
            newFEN: game.fen(),
            gameOver: game.game_over() 
        });

    } catch (error) {
        console.error("Relayer Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
