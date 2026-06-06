import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    // 1. ADD CORS HEADERS
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
        
        // Ensure environment variables are loaded
        const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
        const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
        const CONTRACT_ADDRESS = "0x8F5Fc15d742691A924D8326b08FB28f3dE646509";

        if (!PRIVATE_KEY) throw new Error("Server Configuration Error: Missing Private Key");

        // 3. RPC HEALTH CHECK
        const healthCheck = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
        });

        if (!healthCheck.ok) throw new Error(`Lightchain RPC unreachable at ${RPC_URL}`);

        // 4. INITIALIZE ETHERS
        const network = ethers.Network.from(8200);
        const provider = new ethers.JsonRpcProvider(RPC_URL, network, { staticNetwork: true });
        const relayerWallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function submitAIMove(address player, string newFEN, string newPGN) external",
            "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
        ], relayerWallet);

        const tx = await contract.submitAIMove(playerAddress, game.fen(), game.pgn());

        // 5. RESTORE STATE FROM ON-CHAIN
        const gameData = await contract.matches(playerAddress);
        if (!gameData || !gameData[6]) throw new Error("No active game found for this address on-chain.");

        const game = new Chess(gameData[2]); // gameData[2] is currentFEN
        
        // Validate local move against on-chain FEN
        if (!game.move(moveObj)) {
            throw new Error(`Invalid move: ${moveString} is not allowed from current FEN: ${gameData[2]}`);
        }

        // 6. AIVM INFERENCE (Anchored Logic)
        // Note: Ensure AIVM_ENDPOINT is defined in Vercel env if api.lightchain.ai fails
        const AIVM_API = process.env.AIVM_ENDPOINT || 'https://api.testnet.lightchain.ai/';
        
        const aiRes = await fetch(AIVM_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${playerAddress}` },
            body: JSON.stringify({ 
                model: "Neural-Llama-3-70B",
                messages: [{ role: "user", content: `FEN: ${game.fen()}` }],
                temperature: 0.1
            })
        });

        if (!aiRes.ok) throw new Error(`AIVM Inference Failed: ${aiRes.statusText}`);

        const aiData = await aiRes.json();
        const aiMoveString = aiData.choices[0].message.content.trim().toLowerCase().replace(/[^a-h1-8q]/g, '');

        if (!game.move(aiMoveString, { sloppy: true })) {
            throw new Error(`AIVM returned illegal move: ${aiMoveString}`);
        }

        // 7. COMMIT TO CHAIN
        const tx = await contract.submitMove(playerAddress, moveString);
        await tx.wait();

        return res.status(200).json({ 
            success: true, 
            newFEN: game.fen(), 
            gameOver: game.game_over(),
            txHash: tx.hash
        });

    } catch (err) {
        console.error("CRASH REPORT:", err);
        return res.status(500).json({ 
            success: false, 
            crashReport: err.message, 
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined 
        });
    }
}
