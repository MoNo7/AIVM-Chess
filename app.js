// --- Configuration ---
const OWNER_ADDRESS = "0x4D36B31d4BFB957A5D816B0f420a9e755EFc6a2c";
//let CONTRACT_ADDRESS = "";
const CONTRACT_ADDRESS = "0xA2314A7c7B969155A8070060DBc195CAD448b886";
const CONTRACT_ABI = [
    "function protocolOwner() view returns (address)",
    "function startMatch(string initialFEN) external payable",
    "function playPlayerMove(string fen, string pgn, bytes32 taskId) external",
    "function submitAIMove(address player, string newFEN, string newPGN) external",
    "function matches(address) view returns (uint256 wager, uint256 gasRemaining, string currentFEN, string pgn, uint256 moveCount, uint256 startTime, uint256 lastMoveTime, bool active, bool isPlayerTurn, uint256 finalMoveCount, string finalPGN)",
    "function lockedVaultFunds() view returns (uint256)",
    "function manualWithdraw(uint256 amount) external",
    "function completeMatch(address payable player, bool playerWon, bool isDraw, uint256 finalMoveCount, string finalPGN) external",
    "event MatchStarted(address indexed player, uint256 wager)",
    "event MoveValidated(bytes32 indexed taskId, string move)"
];

let provider, signer, contract;
let userAddress = "";
let game = new Chess();
let board = null;

const boardConfig = {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://raw.githubusercontent.com/oakmac/chessboardjs/master/website/img/chesspieces/wikipedia/{piece}.png',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
};

// --- Core Elements ---
const connectBtn = document.getElementById('connect-btn');
const walletDisplay = document.getElementById('wallet-address');
const adminPanel = document.getElementById('admin-panel');
const gameControls = document.getElementById('game-controls');
const gameStatus = document.getElementById('game-status');

async function connectWallet() {
    try {
        if (!window.ethereum) {
            alert("Please install MetaMask to play!");
            return;
        }

        // 1. Safely fetch the contract address (Self-contained scope)
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const data = await response.json();
                if (data.contractAddress) {
                    CONTRACT_ADDRESS = data.contractAddress;
                    console.log("Dynamically loaded contract:", CONTRACT_ADDRESS);
                }
            }
        } catch (fetchError) {
            console.warn("Dynamic load failed. Using fallback address:", CONTRACT_ADDRESS);
        }

        // 2. Final security check before starting ethers
        if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS === "") {
            console.error("No contract address available.");
            alert("Critical Error: Contract address is missing!");
            return;
        }

        // 3. Initialize Ethers.js
        provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        userAddress = accounts[0];
        signer = await provider.getSigner();
        
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        
        // 4. Update UI Elements
        const walletDisplay = document.getElementById('wallet-address');
        const connectBtn = document.getElementById('connect-btn');
        const boardContainer = document.getElementById('board-container');
        const gameControls = document.getElementById('game-controls');
        const setupArea = document.getElementById('setup-area');
        
        if (walletDisplay) {
            walletDisplay.innerText = `Connected: ${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;
            walletDisplay.onclick = () => {
                const panel = document.getElementById('admin-panel');
                if (panel) {
                    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                    if (panel.style.display === 'block') refreshVaultStats();
                }
            };
        }
        
        if (connectBtn) connectBtn.style.display = 'none';
        if (boardContainer) boardContainer.style.display = 'block';
        if (gameControls) gameControls.style.display = 'block';
        if (setupArea) setupArea.style.display = 'block';
        
        if (board && typeof board.resize === 'function') {
            board.resize();
        }
        
        // 5. Verify states
        checkActiveGame(userAddress);
        refreshVaultStats();
        
    } catch (error) {
        console.error("Connection Failed:", error);
    }
}

async function checkOwnerStatus() {
    try {
        const owner = await contract.protocolOwner();
        if (userAddress.toLowerCase() === owner.toLowerCase()) {
            walletDisplay.classList.add('owner-wallet');
            walletDisplay.title = "Click to toggle Admin Panel";
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

// --- Vault & Revenue ---
async function refreshVaultStats() {
    try {
        const totalBalanceWei = await provider.getBalance(CONTRACT_ADDRESS);
        const lockedWei = await contract.lockedVaultFunds();
        const availableWei = BigInt(totalBalanceWei) - BigInt(lockedWei);
        const availableLCAI = ethers.formatEther(availableWei);
        const display = document.getElementById('vault-available');
        if (display) {
            display.innerText = parseFloat(availableLCAI).toFixed(2);
        }
    } catch (err) {
        console.error("Vault Refresh Failed:", err);
    }
}

async function updateVaultDisplay() {
    const balance = await provider.getBalance(CONTRACT_ADDRESS);
    document.getElementById('vault-balance').innerText = ethers.formatEther(balance);
}

async function checkVaultLiquidity(userBet) {
    const vaultBalance = await provider.getBalance(CONTRACT_ADDRESS);
    const vaultLCAI = parseFloat(ethers.formatEther(vaultBalance));
    const requiredAmount = parseFloat(userBet) + 50.5;
    const warningElement = document.getElementById('bet-warning');
    if (requiredAmount > vaultLCAI) {
        warningElement.innerText = `⚠️ Bet too large. Max allowed: ${(vaultLCAI - 50.5).toFixed(2)} LCAI`;
        document.getElementById('start-btn').disabled = true;
    } else {
        warningElement.innerText = "";
        document.getElementById('start-btn').disabled = false;
    }
}

function toggleAdminMenu() {
    if (userAddress.toLowerCase() === OWNER_ADDRESS.toLowerCase()) {
        const adminMenu = document.getElementById('admin-menu');
        adminMenu.style.display = (adminMenu.style.display === 'none') ? 'block' : 'none';
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

// --- Gameplay Logic ---
async function startMatch() {
    const betInput = document.getElementById('betAmount').value || "0";
    if (game.fen() !== "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" && !game.game_over()) {
        if (!confirm("You have an active game. Starting a new one will overwrite it. Proceed?")) return;
    }
    if (betInput < 0) return alert("Bet cannot be negative.");
    try {
        const betWei = ethers.parseEther(betInput);
        const gasReserveWei = ethers.parseEther("50.5"); 
        const totalValue = betWei + gasReserveWei;
        gameStatus.innerText = "Estimating gas...";
        gameStatus.innerText = "Confirming Transaction...";
        const tx = await contract.startMatch("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", { 
            value: totalValue,
            gasLimit: 800000, 
            maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"), 
            maxFeePerGas: ethers.parseUnits("2", "gwei")
        });
        await tx.wait();
        gameStatus.innerText = "Game Live! Your Move (White)";

        document.getElementById('setup-area').style.display = 'none';
        document.getElementById('game-title').innerText = "Game in Progress";

        const boardContainer = document.getElementById('board-container');
        boardContainer.style.display = 'block';
        
        const boardElement = document.getElementById('myBoard');

        game.reset();
        
        boardElement.style.width = '90vw'; 
        boardElement.style.maxWidth = '800px'; 
        
        initBoard();
        setTimeout(() => {
            board.resize();
        }, 100);
    } catch (error) { alert("Failed to start match."); }
}
let isSyncing = false;

async function checkActiveGame(address) {
    if (!contract || isSyncing) return;
    //isSyncing = true;
    
    try {
        const gameData = await contract.matches(address);
        const setupArea = document.getElementById('setup-area');
        const boardContainer = document.getElementById('board-container');
        const gameControls = document.getElementById('game-controls');
        const gameStatus = document.getElementById('game-status');
        
       // STRICTOR CHECK: explicitly check for true
        if (gameData && gameData.active === true) { 
            console.log("Active game found, resuming...");

            // IF THE FEN IS EMPTY, IT'S A STUCK/INVALID GAME -> FORCE CLEAR IT VISUALLY
            if (!gameData.currentFEN || gameData.currentFEN === "" || gameData.currentFEN === "0x") {
                console.log("Ghost match detected (empty FEN). Forcing setup layout.");
                if (setupArea) setupArea.style.display = 'block';
                if (boardContainer) boardContainer.style.display = 'none';
                if (gameControls) gameControls.style.display = 'none';
                return; 
            }
            if (setupArea) setupArea.style.display = 'none';
            if (boardContainer) boardContainer.style.display = 'block';
            if (gameControls) gameControls.style.display = 'block';
            
            if (!board) { initBoard(); }
            
            game.load(gameData.currentFEN);
            board.position(gameData.currentFEN);
            
            if (gameStatus) {
                gameStatus.innerText = gameData.isPlayerTurn ? "Game Resumed! Your Turn." : "Game Resumed! Awaiting AI...";
            }
        } else {
            // This will now reliably fire when active is false
            console.log("No active game. Clearing layout.");
            if (setupArea) setupArea.style.display = 'block';
            if (boardContainer) boardContainer.style.display = 'none'; 
            if (gameControls) gameControls.style.display = 'none';
            if (gameStatus) gameStatus.innerText = "Ready to start a new match.";
            
            // Wipe the visual board instance out of memory entirely
            if (board) {
                board.destroy();
                board = null;
            }
        }
    } catch (e) {
        console.error("Error checking game state:", e);
    } finally {
        isSyncing = false;
    }
}

async function refreshGameState() {
    if (!userAddress || !contract) return;
    try {
        const gameData = await contract.matches(userAddress);
        if (!gameData.active) {
            gameStatus.innerText = "Game ended or no active match.";
            return;
        }
        
        // Force sync if FEN strings differ
        if (gameData.currentFEN !== game.fen()) {
            console.log("Syncing board to contract state:", gameData.currentFEN);
            game.load(gameData.currentFEN);
            board.position(gameData.currentFEN, false); // 'false' prevents animation glitches
            const gameStatus = document.getElementById('game-status');
            if (gameStatus) {
                gameStatus.innerText = gameData.isPlayerTurn ? "Your Turn!" : "Awaiting AI...";
            }
            
            // 4. FIX: Re-lock or unlock piece dragging depending on whose turn it is
            boardConfig.draggable = gameData.isPlayerTurn;
        }
    } catch (e) {
        console.error("Refresh loop error:", e);
    }
}

let refreshInterval = setInterval(refreshGameState, 5000);

function initBoard() {
    if (board !== null) {
        board.destroy();
        board = null;
    }
    // 2. Initialize fresh
    board = Chessboard('myBoard', boardConfig);
}

async function onDrop(source, target) {
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';
    
    localStorage.setItem('lcai_chess_pgn', game.pgn());
    
    try {
        gameStatus.innerText = "AIVM is thinking... (Gasless Mode)";
        boardConfig.draggable = false; // Lock the board so they can't move twice
        
        // Ping the Relayer. We don't need a blockchain transaction from the user here!
        const response = await fetch('/api/relayer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerAddress: userAddress,
                currentFEN: game.fen()
            })
        });

        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.error || "Backend failed to process turn.");
        }

        console.log("AIVM Task Submitted! Task ID:", data.taskId);
        gameStatus.innerText = "AIVM evaluating move... waiting for on-chain sync.";

        // 2. The backend has already saved it to the blockchain! Just update the UI.
        game.load(data.newFEN);
        board.position(data.newFEN);
        localStorage.setItem('lcai_chess_pgn', game.pgn());
        
        gameStatus.innerText = game.game_over() ? "Game Over!" : "AIVM Moved. Your Turn!";
        
    } catch (error) {
        console.error("Processing Error:", error);
        
        // Safety rollback if the backend crashes
        game.undo();
        board.position(game.fen());
        gameStatus.innerText = "Connection error. Move rolled back.";
        return 'snapback';
    }
}

function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    if (game.turn() === 'b') {
        console.warn("Wait for AIVM execution loop to finalize...");
        return false;
    }
    if (piece.search(/^b/) !== -1) return false;
}

function onSnapEnd() {
    board.position(game.fen());
}

function resetGame() {
    if (confirm("Reset the local board? This won't cancel an on-chain match.")) {
        // 1. Reset the logic engine
        game = new Chess(); 
        
        // 2. Clear the UI
        document.getElementById('board-container').style.display = 'none';
        document.getElementById('setup-area').style.display = 'block';
        document.getElementById('game-status').innerText = "Board Reset. Ready to Start.";
        
        // 3. Clear local storage so it doesn't try to resume
        localStorage.removeItem('lcai_chess_pgn');
        
        // 4. Force a fresh board instance if it exists
        if (board) {
            board.clear();
        }
    }
}

window.onload = async () => {
    // Fetch contract address safely
    try {
        const configResponse = await fetch('/api/config');
        if (configResponse.ok) {
            const configData = await configResponse.json();
            if (configData.contractAddress) {
                CONTRACT_ADDRESS = configData.contractAddress;
                console.log("Dynamically loaded contract from Vercel:", CONTRACT_ADDRESS);
            }
        }
    } catch (e) {
        console.warn("Dynamic load failed. Using fallback address:", CONTRACT_ADDRESS);
    }

    const startBtn = document.getElementById('start-btn');
    const resetBtn = document.getElementById('reset-btn');
    const connectBtn = document.getElementById('connect-btn');
    const withdrawBtn = document.getElementById('adminWithdrawBtn');
    
    if (startBtn) startBtn.addEventListener('click', startMatch);
    if (resetBtn) resetBtn.addEventListener('click', resetGame);
    if (connectBtn) connectBtn.addEventListener('click', connectWallet);
    if (withdrawBtn) withdrawBtn.addEventListener('click', adminWithdraw);
    
    document.getElementById('board-container').style.display = 'none';
};
