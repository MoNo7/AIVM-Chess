process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
    const { playerAddress, move } = req.body;
    const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";

    try {
        // --- HARDENED PROVIDER ---
        const network = ethers.Network.from(8200); 
        const fetchReq = new ethers.FetchRequest(process.env.LIGHTCHAIN_RPC_URL);
        fetchReq.timeout = 15000; // Give the testnet more time to respond

        const provider = new ethers.JsonRpcProvider(fetchReq, network, {
            staticNetwork: true 
        });

        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function submitMove(address player, string move) external",
            "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
        ], relayerWallet);

        // 1. Fetch Game State
        let gameData;
        try {
            gameData = await contract.matches(playerAddress);
        } catch (rpcErr) {
            console.error("RPC Error:", rpcErr.message);
            return res.status(502).json({ success: false, error: "Lightchain RPC is overloaded. Try again in 10 seconds." });
        }

        if (!gameData || !gameData[6]) { // isActive index 6
            return res.status(400).json({ success: false, error: "No active game found" });
        }

        const game = new Chess(gameData[2]); // FEN index 2
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
        const aiMoveSAN = rawAiData.trim().replace(/['"]+/g, ''); 

        if (!game.move(aiMoveSAN)) throw new Error("AIVM illegal move: " + aiMoveSAN);

        // 3. Submit to Lightchain
        const tx = await contract.submitMove(playerAddress, aiMoveSAN);
        await tx.wait();

        res.status(200).json({ success: true, aiMove: aiMoveSAN, newFEN: game.fen() });

    } catch (error) {
        console.error("Relayer Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
