// api/index.js
// Vercel serverless handler (safe version).
// IMPORTANT: Do NOT put PRIVATE_KEY in this file. Set PRIVATE_KEY, RPC_URL, RECEIVER_ADDRESS, USDC_ADDRESS, X404_ADDRESS, QUOTER_V2 in Vercel Environment Variables.
import { ethers } from "ethers";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const INV_STORE_PATH = "/tmp/invoices.json"; // ephemeral on Vercel. Use Redis/Upstash for production.

function loadInvoices() {
  try {
    if (!fs.existsSync(INV_STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(INV_STORE_PATH));
  } catch (e) {
    return {};
  }
}
function saveInvoices(data) {
  fs.writeFileSync(INV_STORE_PATH, JSON.stringify(data, null, 2));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

export default async function handler(req, res) {
  try {
    const url = req.url;
    const method = req.method;
    const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
    const RECEIVER = (process.env.RECEIVER_ADDRESS || "").toLowerCase();
    const USDC = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase();
    const X404 = (process.env.X404_ADDRESS || "").toLowerCase();
    const PRIVATE_KEY = process.env.PRIVATE_KEY; // MUST be set in Vercel env; DO NOT commit
    const QUOTER_V2 = process.env.QUOTER_V2 || "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

    if (!RECEIVER || !X404) {
      return res.status(500).json({ error: "Missing configuration: set RECEIVER_ADDRESS and X404_ADDRESS in env." });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = PRIVATE_KEY ? new ethers.Wallet(PRIVATE_KEY, provider) : null;

    // Minimal ABIs
    const QUOTER_ABI = [
      "function quoteExactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
    ];
    const ERC20_ABI = [
      "function decimals() view returns (uint8)",
      "function transfer(address to, uint256 amount) returns (bool)",
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ];

    const x404Contract = signer ? new ethers.Contract(X404, ERC20_ABI, signer) : null;
    const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);

    const invoices = loadInvoices();

    // Create invoice: compute USDC required for exact X404 qty using Uniswap QuoterV2
    if (url.startsWith("/api/create-invoice") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const qty = body.qty;
      const buyer = (body.buyer || "").toLowerCase();
      const fee = body.fee ?? 3000;

      if (!qty || !buyer) return res.status(400).json({ error: "missing qty or buyer" });

      const x404Decimals = await (new ethers.Contract(X404, ERC20_ABI, provider)).decimals();
      const amountOut = ethers.parseUnits(String(qty), x404Decimals);

      const params = {
        tokenIn: USDC,
        tokenOut: X404,
        fee: fee,
        amountOut: amountOut,
        sqrtPriceLimitX96: 0
      };

      const quoteResult = await quoter.quoteExactOutputSingle(params);
      const amountIn = quoteResult[0];

      const id = uuidv4();
      const invoice = {
        id,
        buyer,
        qty: qty.toString(),
        amountOut: amountOut.toString(),
        requiredUSDC: amountIn.toString(),
        tokenIn: USDC,
        tokenOut: X404,
        fee,
        receiver: RECEIVER,
        createdAt: Date.now(),
        paid: false
      };
      invoices[id] = invoice;
      saveInvoices(invoices);

      return res.status(200).json({
        invoice,
        payInstructions: {
          receiver: RECEIVER,
          token: USDC,
          amountRequiredHuman: String(ethers.formatUnits(amountIn, 6)),
          note: "Send USDC (on Base) to receiver then call /api/verify-payment"
        }
      });
    }

    // Verify payment & deliver tokens
    if (url.startsWith("/api/verify-payment") && method === "POST") {
      if (!PRIVATE_KEY) return res.status(500).json({ error: "Server not configured to send tokens. Set PRIVATE_KEY in env to enable delivery." });

      const body = JSON.parse(await readBody(req));
      const { txHash, invoiceId } = body;
      if (!txHash || !invoiceId) return res.status(400).json({ error: "missing txHash or invoiceId" });

      const invoice = invoices[invoiceId];
      if (!invoice) return res.status(404).json({ error: "invoice not found" });

      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return res.status(400).json({ error: "tx not found yet" });

      const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
      let found = false;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
        try {
          const parsed = iface.parseLog(log);
          const to = parsed.args[1].toLowerCase();
          const value = parsed.args[2];
          if (to === RECEIVER.toLowerCase() && value >= BigInt(invoice.requiredUSDC)) {
            found = true;
            break;
          }
        } catch (e) {}
      }
      if (!found) return res.status(400).json({ error: "payment-not-verified" });

      invoice.paid = true;
      invoice.paidTx = txHash;
      invoice.paidAt = Date.now();
      saveInvoices(invoices);

      const amountToSend = BigInt(invoice.amountOut);
      const tx = await x404Contract.transfer(invoice.buyer, amountToSend);
      const txReceipt = await tx.wait(1);

      return res.status(200).json({
        success: true,
        deliveredTx: txReceipt.transactionHash,
        invoice
      });
    }

    // Debug: fetch invoice
    if (url.startsWith("/api/invoice") && method === "GET") {
      const { searchParams } = new URL(req.url, "http://dummy");
      const id = searchParams.get("id");
      const inv = invoices[id];
      if (!inv) return res.status(404).json({ error: "not found" });
      return res.status(200).json(inv);
    }

    return res.status(404).json({ error: "not found" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal", message: String(err?.message || err) });
  }
}
