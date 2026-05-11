// --- Configuration ---
const CONTRACT_ADDRESS = "0xD4c213Fe046fe72Aa456b18B7b4b39A630fE7B17";
const CONTRACT_ABI = [
    "function protocolOwner() view returns (address)",
    "function lockedVaultFunds() view returns (uint256)",
    "function startMatch(string initialFEN) payable",
    "function manualWithdraw(uint256 amount) external",
    "function activeGamesCount() view returns (uint8)",
    "function matches(address player) view returns (uint256 startTime, address playerAddr, string currentFEN, string pgn, uint256 betAmount, bool isActive)"
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

            const gameData = await contract.matches(userAddress);
            const startTime = Number(gameData[0]); // The timestamp of the match
            
            if (startTime > 0) {
                console.log("Active game found. Resuming...");
                const currentFEN = gameData[2]; // Struct index 2 is currentFEN
                
                // Update local engine
                game = new Chess(currentFEN);
                
                // Update UI
                gameStatus.innerText = "Resumed active game. Your move.";
                initBoard();
                board.position(currentFEN);
            }

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

async function checkOwnerStatus() {
    try {
        const owner = await contract.protocolOwner();
        
        if (userAddress.toLowerCase() === owner.toLowerCase()) {
            // Make the wallet text act as the secret toggle button
            walletDisplay.classList.add('owner-wallet');
            walletDisplay.title = "Click to toggle Admin Panel";
            
            // Toggle logic on the wallet text itself
            walletDisplay.addEventListener('click', () => {
                const isHidden = adminPanel.style.display === "none";
                adminPanel.style.display = isHidden ? "block" : "none";
                if (isHidden) refreshVaultStats();
            });
        }
    } catch (e) {
        console.error("Error checking owner:", e);
    }
}

// --- 3. Vault & Revenue ---
async function refreshVaultStats() {
    const balanceWei = await provider.getBalance(CONTRACT_ADDRESS);
    const lockedWei = await contract.lockedVaultFunds();
    const available = ethers.formatEther(balanceWei - lockedWei);
    document.getElementById('vault-available').innerText = available;
}

async function checkVaultLiquidity(userBet) {
    // 1. Get the current contract balance
    const vaultBalance = await provider.getBalance(CONTRACT_ADDRESS);
    const vaultLCAI = parseFloat(ethers.formatEther(vaultBalance));
    
    // 2. Calculate the required payout (Bet + Gas Reserve)
    const requiredAmount = parseFloat(userBet) + 55.0;

    const warningElement = document.getElementById('bet-warning');
    
    if (requiredAmount > vaultLCAI) {
        warningElement.innerText = `⚠️ Bet too large. Max allowed: ${(vaultLCAI - 55).toFixed(2)} LCAI`;
        document.getElementById('start-btn').disabled = true;
    } else {
        warningElement.innerText = "";
        document.getElementById('start-btn').disabled = false;
    }
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
    const betInput = document.getElementById('betAmount').value || "0";
    
    if (game.fen() !== "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" && !game.game_over()) {
        if (!confirm("You have an active game. Starting a new one will overwrite it. Proceed?")) return;
    }
    

    if (betInput < 0) return alert("Bet cannot be negative.");
    try {
        const betWei = ethers.parseEther(betInput);
        const gasReserveWei = ethers.parseEther("55.0"); 
        const totalValue = betWei + gasReserveWei;
        gameStatus.innerText = "Estimating gas...";
        console.log("Sending Total:", ethers.formatEther(totalValue), "LCAI");
        gameStatus.innerText = "Confirming Transaction...";
        
        // Execute
        const tx = await contract.startMatch("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", { 
            value: totalValue,
            gasLimit: 800000, // Sufficient for the match start
            // This ensures the network fee doesn't eat your whole remaining 1.0 LCAI
            maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"), 
            maxFeePerGas: ethers.parseUnits("2", "gwei")
        });
        await tx.wait();
        gameStatus.innerText = "Game Live! Your Move (White)";

        // Hide the setup area
        document.getElementById('setup-area').style.display = 'none';
        
        // Expand the board container
        const boardElement = document.getElementById('myBoard');
        boardElement.style.width = '90vw'; // 90% of viewport width
        boardElement.style.maxWidth = '800px'; // Limit maximum size

        
        initBoard();
        setTimeout(() => {
        board.resize();
        }, 100);
    } catch (error) { alert("Failed to start match."); }
}

function initBoard() {
    const config = {
        draggable: true,
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        onDrop: onDrop
    };
    board = Chessboard('myBoard', config);
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
