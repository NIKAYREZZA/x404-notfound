# x404-notfound (Vercel-ready)

This repo contains a safe, ready-to-deploy Vercel serverless project that:
- Creates invoices quoting the required USDC amount (using Uniswap QuoterV2) to buy X404 tokens on Base Mainnet.
- Verifies USDC transfers to the receiver wallet.
- Optionally delivers X404 tokens by sending them from the server wallet (requires PRIVATE_KEY set as env var in Vercel).

## Important safety notes
- **Never** commit PRIVATE_KEY to Git. Set it only in Vercel Environment Variables.
- Treat any private key previously shared in chat as compromised. Rotate keys immediately.
- For production use, replace the ephemeral file store with Redis/Upstash.

## Files
- `api/index.js` - Vercel serverless handler
- `package.json`
- `.env.example`
- `README.md`

## How to deploy
1. Create a GitHub repo (e.g. `x404-notfound`) and push this project's files.
2. On Vercel, import the repo.
3. Add the Environment Variables in Vercel (Project Settings -> Environment Variables):
   - RPC_URL (e.g. https://mainnet.base.org)
   - RECEIVER_ADDRESS (your wallet address)
   - USDC_ADDRESS (default: 0x8335...2913)
   - X404_ADDRESS (0x9c6f0533f0367d73b925cf0117e1fade87905923)
   - PRIVATE_KEY (set your new key here; do NOT paste in code)
   - QUOTER_V2 (default provided)
4. Deploy.

## Basic endpoints
- `POST /api/create-invoice` body: `{ "qty": 10, "buyer": "0xBuyerAddress" }`
- `POST /api/verify-payment` body: `{ "txHash": "0x...", "invoiceId": "..." }`
- `GET /api/invoice?id=<invoiceId>`

## Next steps (recommended)
- Use Upstash Redis instead of `/tmp` for persistent storage on Vercel.
- Implement rate limiting and abuse protection.
- Add monitoring and allow configurable slippage.
- Test thoroughly on Base Sepolia before mainnet.

## Disclaimer
Use at your own risk. This code is a starting point and not a complete production-grade payment/delivery system.
