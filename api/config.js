export default function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
    
    // Natively hand over the live Vercel environment variable to the frontend securely
    return res.status(200).json({
        contractAddress: process.env.CONTRACT_ADDRESS
    });
}
