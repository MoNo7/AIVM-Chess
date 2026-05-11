// --- Configuration ---
const OWNER_ADDRESS = "0x4D36B31d4BFB957A5D816B0f420a9e755EFc6a2c";
const CONTRACT_ADDRESS = "0xB56aB3b7975c1F544D69392603336FEb27b8A83a";
const CONTRACT_ABI = [
    "function protocolOwner() view returns (address)",
    "function lockedVaultFunds() view returns (uint256)",
    "function manualWithdraw(uint256 amount) external",
    "function activeGamesCount() view returns (uint8)",
    "function submitMove(string move) external", // Note: The user version is usually payable
    "function matches(address) view returns (uint256 wager, uint256 gasRemaining, string currentFEN, string currentPGN, uint256 moveCount, uint256 lastMoveTimestamp, bool isActive)",
    "function startMatch(string move) external payable"
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

async function connectWallet() {
    try {
        if (window.ethereum) {
            provider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await provider.send("eth_requestAccounts", []);
            userAddress = accounts[0];
            const signer = await provider.getSigner();
            
            contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            
            // Restore visibility
            const walletDisplay = document.getElementById('wallet-address');
            walletDisplay.innerText = `Connected: ${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;
            // Ensure these IDs match your HTML exactly
            document.getElementById('connect-btn').style.display = 'none';
            document.getElementById('game-controls').style.display = 'block';
            document.getElementById('board-container').style.display = 'block'; // Shows the board
            
            // Ensure the click opens the admin panel
            walletDisplay.onclick = () => {
                const panel = document.getElementById('admin-panel');
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                if (panel.style.display === 'block') updateVaultDisplay();
            };

            // Add the Admin Toggle
            const addrLabel = document.getElementById('wallet-address');
            addrLabel.innerText = `Connected: ${userAddress.slice(0,6)}...${userAddress.slice(-4)}`;
            addrLabel.onclick = () => {
                const panel = document.getElementById('admin-panel');
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            };
            
            document.getElementById('game-options').style.display = 'block';
            
            checkActiveGame(userAddress);
            checkOwnerStatus();
        }
    } catch (error) {
        console.error("Connection Failed:", error);
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
    try {
        const totalBalanceWei = await provider.getBalance(CONTRACT_ADDRESS);
        const lockedWei = await contract.lockedVaultFunds();
        
        // Use BigInt subtraction for Ethers v6
        const availableWei = totalBalanceWei - lockedWei;
        const availableLCAI = ethers.formatEther(availableWei);
        
        // FIX: Match the variable name and use parseFloat for a clean display
        document.getElementById('vault-available').innerText = parseFloat(availableLCAI).toFixed(2);
        
        console.log("Vault Refresh Success:", availableLCAI);
    } catch (e) {
        console.error("Vault Refresh Error:", e);
    }
}

async function updateVaultDisplay() {
    const balance = await provider.getBalance(CONTRACT_ADDRESS);
    document.getElementById('vault-balance').innerText = ethers.formatEther(balance);
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
        document.getElementById('game-title').innerText = "Game in Progress";

        const boardContainer = document.getElementById('board-container');
        boardContainer.style.display = 'block';
        
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

async function checkActiveGame(address) {
    if (!contract) return;

    try {
        // Fetch match data from Lightchain
        const gameData = await contract.matches(address);
        
        // In Solidity, your Match struct has 'isActive'
        if (gameData && gameData.isActive) {
            console.log("Active game found, resuming...");
            
            // 1. Hide the entry UI
            const setupArea = document.getElementById('setup-area');
            if (setupArea) setupArea.style.display = 'none';
            
            // 2. Show the Board Container
            const boardContainer = document.getElementById('board-container');
            boardContainer.style.display = 'block';

            // 3. Sync the JS game state with the Contract FEN
            game = new Chess(gameData.currentFEN);
            
            // 4. Initialize the visual board
            if (!board) {
                initBoard(); 
            }
            board.position(gameData.currentFEN);
            
            document.getElementById('game-status').innerText = "Game Resumed! Your Turn.";
        }
    } catch (e) {
        console.error("Error resuming game:", e);
    }
}

function resumeGame(fen) {
    // Show the board container
    document.getElementById('board-container').style.display = 'block';
    
    // Initialize or Update Board
    if (!board) {
        board = Chessboard('myBoard', {
            draggable: true,
            position: fen,
            onDrop: handleMove // Your existing move logic
        });
    } else {
        board.position(fen);
    }
    game.load(fen);
}


function initBoard() {
    const config = {
        draggable: true,
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png', 
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    board = Chessboard('myBoard', config);
}

async function onDrop(source, target) {
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';

    gameStatus.innerText = "Confirming move on Lightchain...";

    try {
        // 1. Submit to Blockchain FIRST
        //const tx = await contract.submitMove(move.from + move.to);
        //await tx.wait(); 

        gameStatus.innerText = "AIVM is thinking...";

        // 2. Call Relayer (Wrapped in a try/catch so it doesn't break the game)
        try {
            const response = await fetch('/api/relayer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    playerAddress: userAddress, 
                    move: { from: source, to: target } 
                })
            });
            
            // Check if response is actually JSON
        const data = await response.json(); // Read it EXACTLY once
    
        if (response.ok && data.success) {
            // AI moved successfully
            game.load(data.newFEN);
            board.position(data.newFEN);
            gameStatus.innerText = data.gameOver ? "Game Over!" : "AIVM Moved. Your Turn!";
        } else {
            throw new Error(data.error || "Relayer failed to process move");
        }
        } catch (relayerErr) {
            console.error("Relayer Error:", relayerErr);
            game.undo();
            board.position(game.fen());
            gameStatus.innerText = "Move failed: " + relayerErr.message;
        }

        // 3. Fallback to polling the contract for the AIVM move
        requestAIVMMove();

    } catch (error) {
        console.error("Move failed:", error);
        game.undo();
        board.position(game.fen());
        gameStatus.innerText = "Transaction failed. Check your LCAI balance.";
        return 'snapback';
    }
}

// Add this logic to your configuration
function onDragStart(source, piece, position, orientation) {
    // 1. Block moves if the game is over
    if (game.game_over()) return false;

    // 2. Block moves if it is not your turn (AIVM is 'b')
    if (game.turn() === 'b') {
        console.warn("Wait for AIVM to move...");
        return false;
    }

    // 3. Only allow picking up White pieces
    if (piece.search(/^b/) !== -1) return false;
}

// Ensure the board stays in sync after animations
function onSnapEnd() {
    board.position(game.fen());
}

async function requestAIVMMove() {
    try {
        // Poll the contract/AIVM for the new FEN
        // This ensures the board updates only when the AIVM has actually processed
        const matchData = await contract.matches(userAddress);
        
        if (matchData.currentFEN !== game.fen()) {
            game.load(matchData.currentFEN);
            board.position(game.fen());
            document.getElementById('game-status').innerText = "Your Turn!";
        } else {
            // Still thinking? Poll again in 3 seconds
            setTimeout(requestAIVMMove, 3000);
        }
    } catch (e) {
        console.error("AIVM Sync Error:", e);
    }
}

function resetGame() {
    if (confirm("Reset the local board? This won't cancel an on-chain match.")) {
        game = new Chess();
        if (board) board.start();
        document.getElementById('game-status').innerText = "Board Reset. Ready to Start.";
    }
}

// --- 5. Event Listeners ---
//connectBtn.addEventListener('click', connectWallet);
document.getElementById('adminWithdrawBtn').addEventListener('click', adminWithdraw);
//document.getElementById('startGameBtn').addEventListener('click', startMatch);
//document.addEventListener('DOMContentLoaded', () => {
// --- 3. Fix the Event Listeners at the bottom of app.js ---
window.onload = () => {
    const startBtn = document.getElementById('start-btn');
    const resetBtn = document.getElementById('reset-btn'); // New
    const connectBtn = document.getElementById('connect-btn');
    const withdrawBtn = document.getElementById('adminWithdrawBtn');

    if (startBtn) startBtn.addEventListener('click', startMatch);
    if (resetBtn) resetBtn.addEventListener('click', resetGame); // New
    if (connectBtn) connectBtn.addEventListener('click', connectWallet);
    if (withdrawBtn) withdrawBtn.addEventListener('click', adminWithdraw);
};
