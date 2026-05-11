process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { ethers } from 'ethers';
import { Chess } from 'chess.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
    const { playerAddress, move } = req.body;
    const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";
    const ABI = [
        "function submitMove(address player, string move) external",
        "function matches(address) view returns (uint256, uint256, string, string, uint256, uint256, bool)"
    ];

    try {
        // Force static network to bypass the RPC handshake crash
        const network = ethers.Network.from(8200);
        const provider = new ethers.JsonRpcProvider(process.env.LIGHTCHAIN_RPC_URL, network, { 
            staticNetwork: network 
        });
        const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, relayerWallet);

        // Fetch game state
        const gameData = await contract.matches(playerAddress);
        
        // Validation: matches() returns a struct; isActive is index [6]
        if (!gameData || !gameData[6]) {
            return res.status(400).json({ success: false, error: "No active game found" });
        }

        const game = new Chess(gameData[2]); // currentFEN
        if (!game.move(move)) throw new Error("Invalid move");

        // ... Proceed with AIVM Inference and submitMove ...
        res.status(200).json({ success: true, newFEN: game.fen() });

    } catch (error) {
        console.error("Relayer Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
