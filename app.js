// --- Configuration ---
const OWNER_ADDRESS = "0x4D36B31d4BFB957A5D816B0f420a9e755EFc6a2c";
const CONTRACT_ADDRESS = "0x542280fB7A2d1dBCcF995033809C778F67D9870D";
const CONTRACT_ABI = [
    "function protocolOwner() view returns (address)",
    "function startMatch(string initialFEN) external payable",
    "function requestMove(string fen, string move) external",
    "function playPlayerMove(string fen, string pgn) external",
    "function submitAIMove(address player, string newFEN, string newPGN) external",
    "function matches(address) view returns (uint256 wager, uint256 gasRemaining, string currentFEN, string pgn, uint256 moveCount, uint256 startTime, bool active, bool isPlayerTurn)",
    "function lockedVaultFunds() view returns (uint256)",
    "function manualWithdraw(uint256 amount) external",
    "event MatchStarted(address indexed player, uint256 wager)",
    "function completeMatch(address payable player, bool playerWon, bool isDraw, uint256 finalMoveCount, string finalPGN) external",
    "event MoveValidated(bytes32 indexed taskId, string move)"
];

let provider, signer, contract;
let userAddress = "";
let game = new Chess();
let board = null;

const boardConfig = {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
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
        if (window.ethereum) {
            provider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await provider.send("eth_requestAccounts", []);
            userAddress = accounts[0];
            signer = await provider.getSigner();
            contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

            const walletDisplay = document.getElementById('wallet-address');
            const connectBtn = document.getElementById('connect-btn');
            const boardContainer = document.getElementById('board-container');
            const gameControls = document.getElementById('game-controls');
            
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

            if (!board) {
                board = Chessboard('myBoard', boardConfig);
            } else {
                board.resize();
            }

            checkActiveGame(userAddress);
            refreshVaultStats(); 
        }
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
        boardElement.style.width = '90vw'; 
        boardElement.style.maxWidth = '800px'; 
        
        initBoard();
        setTimeout(() => {
            board.resize();
        }, 100);
    } catch (error) { alert("Failed to start match."); }
}

async function checkActiveGame(address) {
    if (!contract) return;
    try {
        const gameData = await contract.matches(address);
        if (gameData && gameData.active) {
            console.log("Active game found, resuming...");
            const setupArea = document.getElementById('setup-area');
            if (setupArea) setupArea.style.display = 'none';
            const boardContainer = document.getElementById('board-container');
            boardContainer.style.display = 'block';
            if (board) {
                board.resize(); 
            }
            const contractFEN = gameData.currentFEN;
            game = new Chess(contractFEN);
            if (!board) initBoard();
            game.load(gameData.currentFEN); 
            board.position(gameData.currentFEN);
            if (gameData.isPlayerTurn) {
                document.getElementById('game-status').innerText = "Game Resumed! Your Turn.";
            } else {
                document.getElementById('game-status').innerText = "Game Resumed! Awaiting AI...";
            }
        }
    } catch (e) {
        console.error("Error resuming game:", e);
    }
}

async function refreshGameState() {
    if (!userAddress || !contract) return;
    try {
        const gameData = await contract.matches(userAddress);
        if (!gameData.active) {
            clearInterval(refreshInterval);
            gameStatus.innerText = "Game ended or no active match.";
            return;
        }
        if (gameData.currentFEN !== game.fen()) {
            game.load(gameData.currentFEN);
            board.position(gameData.currentFEN);
            gameStatus.innerText = gameData.isPlayerTurn ? "Your Turn!" : "Awaiting AI...";
        }
    } catch (e) {
        console.error("Refresh loop stopped:", e);
        clearInterval(refreshInterval);
    }
}

let refreshInterval = setInterval(refreshGameState, 5000);

function initBoard() {
    board = Chessboard('myBoard', boardConfig);
}

async function onDrop(source, target) {
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';

    localStorage.setItem('lcai_chess_pgn', game.pgn());

    try {
        gameStatus.innerText = "Processing automated AIVM opponent move via Lightchain RPC...";
        
        // Post directly to your relayer to calculate the AI move and settle state simultaneously
        const response = await fetch('/api/relayer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerAddress: userAddress,
                moveObj: move, 
                moveString: move.from + move.to
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Relayer execution error:", errorText);
            throw new Error("Server error: " + errorText);
        }
        
        const data = await response.json();
        if (!data.success) throw new Error(data.crashReport);
        
        // Sync local board position with data returned from the relayer orchestration
        game.load(data.newFEN);
        board.position(data.newFEN);
        
        localStorage.setItem('lcai_chess_pgn', game.pgn());
        gameStatus.innerText = game.game_over() ? "Game Over!" : "AIVM Processing Complete. Your Turn!";

    } catch (error) {
        console.error("Core Error:", error);
        game.undo();
        board.position(game.fen());
        gameStatus.innerText = "Move failed: " + (error.reason || error.message);
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
        game = new Chess();
        if (board) board.start();
        document.getElementById('game-status').innerText = "Board Reset. Ready to Start.";
    }
}

window.onload = () => {
    const startBtn = document.getElementById('start-btn');
    const resetBtn = document.getElementById('reset-btn'); 
    const connectBtn = document.getElementById('connect-btn');
    const withdrawBtn = document.getElementById('adminWithdrawBtn');

    if (startBtn) startBtn.addEventListener('click', startMatch);
    if (resetBtn) resetBtn.addEventListener('click', resetGame); 
    if (connectBtn) connectBtn.addEventListener('click', connectWallet);
    if (withdrawBtn) withdrawBtn.addEventListener('click', adminWithdraw);
};
