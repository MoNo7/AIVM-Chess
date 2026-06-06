// --- Configuration ---
const OWNER_ADDRESS = "0x4D36B31d4BFB957A5D816B0f420a9e755EFc6a2c";
const CONTRACT_ADDRESS = "0x8F5Fc15d742691A924D8326b08FB28f3dE646509";
const CONTRACT_ABI = [
    "function protocolOwner() view returns (address)",
    "function startMatch(string initialFEN) external payable",
    "function requestMove(string fen, string move) external",
    "function playPlayerMove(string fen, string pgn) external",
    "function submitAIMove(string newFEN, string move) external",
    "function verifyAndExecuteMove(bytes32 taskId, string newFEN) external",
    "function playerLastTaskId(address) view returns (bytes32)",
    "function matches(address) view returns (uint256 wager, string currentFEN, uint256 startTime, bool active)",
    "function completeMatch(address payable player, bool playerWon) external",
    "event MoveValidated(bytes32 indexed taskId, string move)"
];

const INFERENCE_ABI = [
    "function getTaskStatus(bytes32 taskId) external view returns (bytes32 resultHash, bool finalized)"
];
const INFERENCE_ADDRESS = "0x1856AEf777F9859F71D7Be24d9F7831bf42ec708";

async function pollForFinalizedMove(playerAddr) {
    gameStatus.innerText = "Getting AI response... (1/2)";
    
    // 1. Fetch the exact FEN from the AI using the legacy API path
    const aiRes = await fetch('https://api.testnet.lightchain.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "Neural-Llama-3-70B",
            messages: [
                { role: "system", content: "You are a chess referee. Only output the valid next FEN string." },
                { role: "user", content: `Current FEN: ${game.fen()}` }
            ],
            temperature: 0.1
        })
    });
    
    if (!aiRes.ok) throw new Error("Failed to get response from AIVM API");
    const aiData = await aiRes.json();
    const newFEN = aiData.choices[0].message.content.trim();

    // 2. Poll the PoI network until the validators sign off
    gameStatus.innerText = "Waiting for Validators to confirm... (2/2)";
    const taskId = await contract.playerLastTaskId(playerAddr);
    const inferenceContract = new ethers.Contract(INFERENCE_ADDRESS, INFERENCE_ABI, provider);

    let finalized = false;
    for (let i = 0; i < 30; i++) { // Poll for up to 2 minutes
        try {
            const status = await inferenceContract.getTaskStatus(taskId);
            if (status.finalized) {
                finalized = true;
                break;
            }
        } catch (e) { 
            console.warn("Polling for status..."); 
        }
        await new Promise(r => setTimeout(r, 4000)); // Wait 4 seconds between checks
    }

    if (!finalized) throw new Error("PoI Network timeout. Move not finalized.");

    // 3. Prompt user to finalize the move on-chain
    gameStatus.innerText = "Move Validated! Please confirm Finalization in wallet.";
    
    // This requires a second MetaMask signature to update the contract state
    const tx = await contract.verifyAndExecuteMove(taskId, newFEN);
    await tx.wait();

    return newFEN;
}

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

// --- 3. Vault & Revenue ---
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

// --- 4. Gameplay Logic ---
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
        
        if (gameData && gameData.Active) {
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
            
            if (!board) {
                initBoard(); 
            }

            board.position(contractFEN);
            game.load(contractFEN);
            
            document.getElementById('game-status').innerText = "Game Resumed! Your Turn.";
        }
    } catch (e) {
        console.error("Error resuming game:", e);
    }
}

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

    // Save local state
    if (typeof saveGameState === 'function') {
        saveGameState();
    } else {
        localStorage.setItem('lcai_chess_pgn', game.pgn());
    }

    try {
        // 1. Update UI for the wallet prompt
        gameStatus.innerText = "Anchoring move... Please confirm in your wallet.";
        const moveString = move.from + move.to; // e.g., "e2e4"
        // Inside your move handling/onDrop function
        const currentFEN = game.fen();
        const currentPGN = game.pgn();

        // 2. Call the smart contract directly
        // Note: 'contract' must be initialized with a Web3Provider (MetaMask) signer
       //const tx = await contract.requestMove(game.fen(), moveString);
        const tx = await contract.playPlayerMove(currentFEN, currentPGN, {
            gasLimit: 300000 // Ensure enough gas is provided for the state update
        });
        
        gameStatus.innerText = "Transaction pending... waiting for block inclusion.";
        
        // 3. Wait for the transaction to be mined
        await tx.wait(); 

        // 4. Wait for the AIVM to process the PoI
        gameStatus.innerText = "AIVM Validators Verifying Move... Please wait.";

        // --- NEW REQUIRED LOGIC: POLLING FOR FINALIZATION ---
        // Because the AIVM takes time, we have to poll the contract 
        // to see if the move was validated and the new FEN is ready.
        
        const newFEN = await pollForFinalizedMove(userAddress); 
        
        // 5. Update the board with the AIVM's response
        game.load(newFEN);
        board.position(newFEN);
        localStorage.setItem('lcai_chess_pgn', game.pgn());
        gameStatus.innerText = game.game_over() ? "Game Over!" : "AIVM Moved. Your Turn!";

    } catch (error) {
        console.error("Blockchain Error:", error);
        game.undo();
        board.position(game.fen());
        
        // Handle user rejection in MetaMask gracefully
        if (error.code === 'ACTION_REJECTED') {
            gameStatus.innerText = "Move cancelled in wallet.";
        } else {
            gameStatus.innerText = "Move failed: " + (error.reason || error.message);
        }
        return 'snapback';
    }
}

function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    if (game.turn() === 'b') {
        console.warn("Wait for AIVM to move...");
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
