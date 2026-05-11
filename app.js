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
let game = new Chess();
let board = null;

// --- Core Elements ---
const connectBtn = document.getElementById('connectWalletBtn');
const walletDisplay = document.getElementById('wallet-address');
const adminPanel = document.getElementById('admin-panel');
const gameControls = document.getElementById('game-controls');
const gameStatus = document.getElementById('game-status');

// --- 1. Wallet Connection (Fixes Coinbase/MetaMask Conflict) ---
async function connectWallet() {
    if (window.ethereum) {
        try {
            // FIX: Identify the correct provider without re-declaring 'provider'
            let selectedInjectedProvider = window.ethereum;
            if (window.ethereum.providers) {
                selectedInjectedProvider = window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum;
            }

            provider = new ethers.BrowserProvider(selectedInjectedProvider);
            await provider.send("eth_requestAccounts", []);
            signer = await provider.getSigner();
            userAddress = await signer.getAddress();
            
            // Initialize Contract
            contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

            // Update UI
            walletDisplay.innerText = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
            connectBtn.style.display = "none";
            gameControls.style.display = "block";

            checkOwnerStatus();
        } catch (error) {
            console.error("Connection Failed:", error);
            alert("Connection failed. Check MetaMask.");
        }
    } else {
        alert("Please install MetaMask!");
    }
}

// --- 2. Owner Detection ---
async function checkOwnerStatus() {
    try {
        const owner = await contract.protocolOwner();
        if (userAddress.toLowerCase() === owner.toLowerCase()) {
            walletDisplay.innerHTML += ` <br><button id="toggleAdminBtn" style="font-size: 0.8rem; margin-top:5px;">Open Owner Menu</button>`;
            document.getElementById('toggleAdminBtn').addEventListener('click', () => {
                const isHidden = adminPanel.style.display === "none";
                adminPanel.style.display = isHidden ? "block" : "none";
                if (isHidden) refreshVaultStats();
            });
        }
    } catch (e) { console.error("Error checking owner:", e); }
}

// --- 3. Vault & Revenue ---
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
        await tx.wait();
        alert("Success! Revenue moved to your wallet.");
        refreshVaultStats();
    } catch (error) { alert("Withdrawal failed."); }
}

// --- 4. Gameplay Logic ---
async function startMatch() {
    const betInput = document.getElementById('betAmount').value;
    if (!betInput || betInput <= 0) return alert("Enter a valid bet");
    try {
        const betWei = ethers.parseEther(betInput);
        const gasReserveWei = ethers.parseEther("50.5"); 
        const totalValue = betWei + gasReserveWei;
        gameStatus.innerText = "Confirming Transaction...";
        
        const tx = await contract.startMatch("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", { value: totalValue });
        await tx.wait();
        gameStatus.innerText = "Game Live! Your Move (White)";
        initBoard();
    } catch (error) { alert("Failed to start match."); }
}

function initBoard() {
    board = Chessboard('myBoard', { draggable: true, position: 'start', onDrop: onDrop });
}

async function onDrop(source, target) {
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    gameStatus.innerText = "AIVM is thinking...";
    try {
        const response = await fetch('/api/relayer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerAddress: userAddress, move: move.san })
        });
        const data = await response.json();
        if (data.success) {
            game.move(data.aiMove);
            board.position(game.fen());
            gameStatus.innerText = data.gameOver ? "Game Over!" : "Your Turn";
        }
    } catch (error) { alert("The AIVM encountered an error."); }
}

// --- 5. Event Listeners ---
connectBtn.addEventListener('click', connectWallet);
document.getElementById('adminWithdrawBtn').addEventListener('click', adminWithdraw);
document.getElementById('startGameBtn').addEventListener('click', startMatch);
