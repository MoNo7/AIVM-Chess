import { ethers } from 'ethers';
import { Chess } from 'chess.js'; 

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    const { playerAddress, currentFEN, pgn, historyLength, playerWon, isDraw } = req.body;

    try {
        // 1. Cheat Protection: Recreate the game state locally to verify
        const validatorGame = new Chess();
        validatorGame.loadPgn(pgn);

        // Ensure the FEN matches what the user is claiming
        if (validatorGame.fen().split(' ')[0] !== currentFEN.split(' ')[0]) {
            return res.status(400).json({ success: false, error: "Game state mismatch." });
        }

        // Verify win/draw conditions on the server side
        const trueIsDraw = validatorGame.isDraw() || validatorGame.isStalemate() || validatorGame.isThreefoldRepetition();
        const truePlayerWon = validatorGame.isCheckmate() && validatorGame.turn() === 'b'; // White won if black is checkmated

        if (playerWon !== truePlayerWon || isDraw !== trueIsDraw) {
            return res.status(400).json({ success: false, error: "Invalid win/draw claim." });
        }

        // 2. Process on-chain
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL);
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        
        const abi = [
            "function completeMatch(address payable player, bool playerWon, bool isDraw, uint256 finalMoveCount, string memory finalPGN) external"
        ];
        const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, relayerWallet);

        // Execute the settlement through the relayer
        const tx = await contract.completeMatch(
            playerAddress,
            truePlayerWon,
            trueIsDraw,
            historyLength,
            pgn
        );
        
        const receipt = await tx.wait();
        return res.status(200).json({ success: true, txHash: receipt.hash });
            
    } catch (error) {
        console.error("Settlement failed:", error);
        return res.status(500).json({ 
            success: false, 
            error: error.message || "Failed to settle match on-chain." 
        });
    }
}
