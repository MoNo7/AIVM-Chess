// --- Configuration ---
const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";
const CONTRACT_ABI = [
    "function protocolOwner() view returns (address)",
    "function lockedVaultFunds() view returns (uint256)",
    "function startMatch(string initialFEN) payable",
    "function manualWithdraw(uint256 amount) external",
    "function activeGamesCount() view returns (uint8)"
];

let provider, signer, contract;
let userAddress = "";

// --- Core Elements ---
const connectBtn = document.getElementById('connectWalletBtn');
const walletDisplay = document.getElementById('wallet-address');
const adminPanel = document.getElementById('admin-panel');
const gameControls = document.getElementById('game-controls');

// --- 1. Wallet Connection ---
async function connectWallet() {
    if (window.ethereum) {
        try {
            // Initialize Ethers v6
            provider = new ethers.BrowserProvider(window.ethereum);
            await provider.send("eth_requestAccounts", []);
            signer = await provider.getSigner();
            userAddress = await signer.getAddress();
            
            // Initialize Contract
            contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

            // Update UI
            walletDisplay.innerText = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
            connectBtn.style.display = "none";
            gameControls.style.display = "block";

            // Check if Owner
            checkOwnerStatus();
        } catch (error) {
            console.error("Connection Failed:", error);
            alert("Connection failed. Check MetaMask.");
        }
    } else {
        alert("Please install MetaMask!");
    }
}

// --- 2. Owner Detection & Menu Access ---
async function checkOwnerStatus() {
    try {
        const owner = await contract.protocolOwner();
        
        if (userAddress.toLowerCase() === owner.toLowerCase()) {
            // Make the wallet address clickable for the owner
            walletDisplay.innerHTML += ` <br><button id="toggleAdminBtn" style="font-size: 0.8rem; margin-top:5px;">Open Owner Menu</button>`;
            
            document.getElementById('toggleAdminBtn').addEventListener('click', () => {
                const isHidden = adminPanel.style.display === "none";
                adminPanel.style.display = isHidden ? "block" : "none";
                if (isHidden) refreshVaultStats();
            });
        }
    } catch (e) {
        console.error("Error checking owner:", e);
    }
}

// --- 3. Vault & Revenue Management ---
async function refreshVaultStats() {
    const balanceWei = await provider.getBalance(CONTRACT_ADDRESS);
    const lockedWei = await contract.lockedVaultFunds();
    
    const available = ethers.formatEther(balanceWei - lockedWei);
    
    document.getElementById('vault-available').innerText = available;
}

async function adminWithdraw() {
    const amountLCAI = document.getElementById('withdraw-amount').value;
    if (!amountLCAI) return alert("Enter an amount");

    try {
        const amountWei = ethers.parseEther(amountLCAI);
        const tx = await contract.manualWithdraw(amountWei);
        alert("Withdrawal initiated. Waiting for confirmation...");
        await tx.wait();
        alert("Success! Revenue moved to your wallet.");
        refreshVaultStats();
    } catch (error) {
        alert("Withdrawal failed. Ensure you aren't touching locked game funds.");
    }
}

// --- Event Listeners ---
connectBtn.addEventListener('click', connectWallet);
document.getElementById('adminWithdrawBtn').addEventListener('click', adminWithdraw);

let game = new Chess();
let board = null;

// --- 1. Start Match (On-Chain) ---
async function startMatch() {
    const betInput = document.getElementById('betAmount').value;
    if (!betInput || betInput <= 0) return alert("Enter a valid bet");

    try {
        const betWei = ethers.parseEther(betInput);
        const gasReserveWei = ethers.parseEther("50.5"); // 101 moves * 0.5 LCAI
        const totalValue = betWei + gasReserveWei;

        document.getElementById('game-status').innerText = "Confirming Transaction...";
        
        // Initial FEN is the starting position
        const tx = await contract.startMatch("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", {
            value: totalValue
        });

        await tx.wait();
        document.getElementById('game-status').innerText = "Game Live! Your Move (White)";
        initBoard();
    } catch (error) {
        console.error(error);
        alert("Failed to start match. Ensure you have enough LCAI for bet + gas.");
    }
}

// --- 2. Initialize Visual Board ---
function initBoard() {
    const config = {
        draggable: true,
        position: 'start',
        onDrop: onDrop
    };
    board = Chessboard('myBoard', config);
}

// --- 3. Handle Player Move ---
async function onDrop(source, target) {
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // Always promote to queen for simplicity
    });

    if (move === null) return 'snapback';

    document.getElementById('game-status').innerText = "AIVM is thinking...";

    // Call your Vercel Relayer API
    try {
        const response = await fetch('/api/relayer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerAddress: userAddress,
                move: move.san
            })
        });

        const data = await response.json();

        if (data.success) {
            // Apply AI Move to local board
            game.move(data.aiMove);
            board.position(game.fen());
            
            if (data.gameOver) {
                document.getElementById('game-status').innerText = "Game Over! Check Contract for Payout.";
            } else {
                document.getElementById('game-status').innerText = "Your Turn";
            }
        }
    } catch (error) {
        console.error("Relayer Error:", error);
        alert("The AIVM encountered an error. Check console.");
    }
}

document.getElementById('startGameBtn').addEventListener('click', startMatch);
