import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    // 1. ADD CORS HEADERS (Fixes "fetch failed" / CORS blocks)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    // 2. SAFETY SHIELD
    if (!req.body || !req.body.moveObj) {
        return res.status(400).json({ success: false, error: "Missing moveObj" });
    }

    try {
        const { playerAddress, moveObj, moveString } = req.body;
        const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
        const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";

        // 3. RPC HEALTH CHECK
        const healthCheck = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
        });

        if (!healthCheck.ok) throw new Error("Lightchain RPC unreachable (502/503)");

        // 4. INITIALIZE ETHERS
        const network = ethers.Network.from(8200);
        const provider = new ethers.JsonRpcProvider(RPC_URL, network, { staticNetwork: true });
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function submitMove(address player, string move) external",
            "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
        ], relayerWallet);

        // 5. RESTORE STATE
        const gameData = await contract.matches(playerAddress);
        if (!gameData || !gameData[6]) throw new Error("No active game on-chain.");

        const game = new Chess(gameData[2]);
        if (!game.move(moveObj)) throw new Error("Invalid move for current state.");

        // 6. AIVM INFERENCE
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

        if (!game.move(aiMoveString, { sloppy: true })) throw new Error("AIVM illegal move");

        // 7. SUBMIT
        const tx = await contract.submitMove(playerAddress, moveString);
        await tx.wait();

        return res.status(200).json({ success: true, newFEN: game.fen(), gameOver: game.game_over() });

    } catch (err) {
        console.error("CRASH REPORT:", err);
        return res.status(500).json({ success: false, crashReport: err.message });
    }
}
