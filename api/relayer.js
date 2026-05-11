//process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
    const { playerAddress, move } = req.body;
    const RPC_URL = process.env.LIGHTCHAIN_RPC_URL || "https://rpc.testnet.lightchain.ai";
    const CONTRACT_ADDRESS = "0xB56aB3b7975c1F544D69392603336FEb27b8A83a";

    try {
        // 1. RPC SANITY CHECK: Catch the 502/HTML error before Ethers crashes
        const healthCheck = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
        });

        if (!healthCheck.ok) {
            const errorBody = await healthCheck.text();
            console.error("RPC Error Body:", errorBody.slice(0, 100)); // Log first 100 chars
            return res.status(502).json({ success: false, error: "Lightchain RPC is currently unstable. Try again." });
        }

        // 2. INITIALIZE ETHERS
        // Inside your handler in relayer.js
        const network = ethers.Network.from(8200);
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL, network, {
            staticNetwork: true // This stops the provider from "sniffing" the network and crashing
        });
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
            "function submitMove(address player, string move) external",
            "function matches(address player) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
        ], relayerWallet);

        // 3. FETCH GAME STATE
        const gameData = await contract.matches(playerAddress);
        if (!gameData || !gameData[6]) return res.status(400).json({ error: "No active game." });

        //const game = new Chess(gameData[2]);
        const game = new Chess(gameData[2]);
        console.log("Current FEN from Contract:", gameData[2]);
        console.log("Move received from UI:", move);


        // Clean up the move input
        let finalizedMove;
        if (typeof move === 'string' && move.length === 4) {
            finalizedMove = {
                from: move.substring(0, 2).toLowerCase(),
                to: move.substring(2, 4).toLowerCase(),
                promotion: 'q'
            };
        } else if (typeof move === 'object') {
            finalizedMove = {
                from: (move.from || move.source).toLowerCase(),
                to: (move.to || move.target).toLowerCase(),
                promotion: 'q'
            };
        } else {
            finalizedMove = move;
        }

        
        
        const moveResult = game.move({
            from: move.from.toLowerCase(), 
            to: move.to.toLowerCase(), 
            promotion: 'q' 
        });

        if (!moveResult) {
            console.error("Validation Failed. FEN:", gameData[2], "Move Attempted:", moveResult);
            throw new Error(`Invalid move: ${JSON.stringify(moveResult)}`);
        }
        
        const moveSAN = moveResult.san;

        // 4. AIVM INFERENCE
        const aiRes = await fetch(process.env.AIVM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: `FEN: ${game.fen()}. Move:`, model: "chess-master-v1" })
        });
        const aiMove = (await aiRes.text()).trim().replace(/['"]+/g, '');

        if (!game.move(aiMove)) throw new Error("AIVM returned illegal move: " + aiMove);

        // 5. SUBMIT TO CHAIN
        const tx = await contract.submitMove(playerAddress, aiMove);
        const receipt = await tx.wait();

        res.status(200).json({ success: true, aiMove, newFEN: game.fen(), txHash: receipt.hash });

    } catch (error) {
        console.error("Relayer Final Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
