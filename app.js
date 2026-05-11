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
