process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { ethers } from 'ethers';
import { Chess } from 'chess.js';

// Helper for retrying the RPC calls
const retry = async (fn, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, delay));
        }
    }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { playerAddress, move } = req.body;
    const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";

    try {
        const network = ethers.Network.from(8200);
        const fetchReq = new ethers.FetchRequest(process.env.LIGHTCHAIN_RPC_URL);
        fetchReq.timeout = 20000; // Increased to 20s for testnet stability

        const provider = new ethers.JsonRpcProvider(fetchReq, network, { staticNetwork: true });
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function submitMove(address player, string move) external",
            "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
        ], relayerWallet);

        // 1. Fetch Game State (with Retry)
        const gameData = await retry(() => contract.matches(playerAddress));
        
        if (!gameData || !gameData[6]) {
            return res.status(400).json({ success: false, error: "No active game found." });
        }

        const game = new Chess(gameData[2]);
        if (!game.move(move)) throw new Error("Invalid move: " + move);

        // 2. AIVM Inference
        const aiResponse = await retry(async () => {
            const res = await fetch(process.env.AIVM_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: `FEN: ${game.fen()}. Move:`, model: "chess-master-v1" })
            });
            if (!res.ok) throw new Error("AIVM Down");
            return res;
        });

        const rawAiData = await aiResponse.text();
        const aiMoveSAN = rawAiData.trim().replace(/['"]+/g, ''); 

        if (!game.move(aiMoveSAN)) throw new Error("AIVM illegal move: " + aiMoveSAN);

        // 3. Submit Transaction (with Retry)
        const tx = await retry(() => contract.submitMove(playerAddress, aiMoveSAN));
        const receipt = await tx.wait();

        res.status(200).json({ 
            success: true, 
            aiMove: aiMoveSAN, 
            newFEN: game.fen(),
            txHash: receipt.hash 
        });

    } catch (error) {
        console.error("Relayer Final Error:", error.message);
        // Custom message for the UI to show the RPC status
        const isRPCError = error.message.includes("JSON") || error.message.includes("network");
        res.status(isRPCError ? 502 : 500).json({ 
            success: false, 
            error: isRPCError ? "Lightchain RPC is overloaded. Retrying..." : error.message 
        });
    }
}
