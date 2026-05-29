import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    // Safety Shield: Check if body exists
    if (!req.body || !req.body.moveObj) {
        return res.status(400).json({ success: false, error: "Missing moveObj in request body" });
    }

    try {
        const { playerAddress, moveObj, moveString } = req.body;
    const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
    const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";

// 1. HARDENED RPC HANDSHAKE
        const healthCheck = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
        });

        if (!healthCheck.ok) {
            return res.status(502).json({ success: false, error: "Lightchain RPC unreachable." });
        }

        // 2. INITIALIZE ETHERS WITH STATIC NETWORK
        const network = ethers.Network.from(8200);
        const provider = new ethers.JsonRpcProvider(RPC_URL, network, { staticNetwork: true });
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function submitMove(address player, string move) external",
            "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
        ], relayerWallet);

        // 3. RESTORE STATE FROM CHAIN
        const gameData = await contract.matches(playerAddress);
        if (!gameData || !gameData[6]) return res.status(400).json({ error: "No active game on-chain." });

        const game = new Chess(gameData[2]); // gameData[2] is currentFEN

        // 4. VALIDATE & PROCESS MOVE
        const userMoveResult = game.move(moveObj);
        if (!userMoveResult) return res.status(400).json({ error: "Invalid move." });

        // 5. AIVM INFERENCE
        const aiRes = await fetch('https://api.lightchain.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${playerAddress}` },
            body: JSON.stringify({ 
                model: "Neural-Llama-3-70B",
                messages: [{ role: "user", content: `FEN: ${game.fen()}` }],
                temperature: 0.1
            })
        });

        const aiData = await aiRes.json();
        const aiMoveString = aiData.choices[0].message.content.trim().toLowerCase().replace(/[^a-h1-8q]/g, '');

        if (!game.move(aiMoveString, { sloppy: true })) throw new Error("AIVM returned illegal move");

        // 6. COMMIT TO CHAIN
        const tx = await contract.submitMove(playerAddress, moveString);
        await tx.wait();

        res.status(200).json({ success: true, newFEN: game.fen(), gameOver: game.game_over() });

    } catch (err) {
        // This will now capture the EXACT crash reason and send it to your browser
        return res.status(500).json({ success: false, crashReport: err.message, stack: err.stack });
    }
}
