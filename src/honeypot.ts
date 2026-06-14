import { type PublicClient, type Address, getAddress, formatEther } from "viem";
import { WBNB, PANCAKE_V2_FACTORY } from "./chain.js";

// Quote / stable assets that ARE the unit of liquidity — screening them for a
// token/WBNB pair is meaningless (they're inherently the base, deeply liquid).
const QUOTE_ASSETS = new Set(
  [
    WBNB,
    "0x55d398326f99059fF775485246999027B3197955", // USDT
    "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
    "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
  ].map((a) => a.toLowerCase()),
);

/**
 * BSC trading-risk checks — the signals an autonomous trading agent needs *before*
 * it buys a token, beyond generic contract safety: tradeable liquidity, buy/sell
 * tax, and transfer limits (the classic honeypot / rug toolkit on BSC).
 *
 * Everything here is READ-ONLY (view calls + a best-effort eth_call buy simulation).
 */

export interface TradingRisk {
  hasLiquidity: boolean;
  /** WBNB-side liquidity of the token/WBNB PancakeSwap V2 pair, in BNB (approx). */
  liquidityBnb?: number;
  pair?: string;
  buyTaxBps?: number; // basis points, if a getter exposed it
  sellTaxBps?: number;
  maxTxBps?: number; // max tx as bps of supply, if exposed
  maxWalletBps?: number;
  tradingEnabled?: boolean; // false => agent could buy and be unable to sell until owner enables
  buySimReverts?: boolean; // best-effort: a simulated buy reverts
  notes: string[];
}

const factoryAbi = [
  { type: "function", name: "getPair", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "address" }] },
] as const;

const pairAbi = [
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// Common getter signatures used by BSC fee/limit tokens. Read-only, best-effort.
const probeAbi = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "buyTax", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sellTax", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "_buyTax", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "_sellTax", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "_taxFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxTransactionAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxTxAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "_maxTxAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxWallet", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "_maxWalletSize", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tradingOpen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "tradingActive", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "tradingEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

async function read<T>(client: PublicClient, address: Address, functionName: string): Promise<T | undefined> {
  try {
    return (await client.readContract({ address, abi: probeAbi, functionName: functionName as any })) as T;
  } catch {
    return undefined;
  }
}

function bpsFromMaybePercent(v: bigint): number {
  // Heuristic: many tokens store tax as a small integer percent (e.g. 5 = 5%).
  // Treat values <= 100 as percent; larger raw values are left as-is (already bps-like).
  const n = Number(v);
  return n <= 100 ? n * 100 : n;
}

export async function assessTrading(client: PublicClient, rawToken: string): Promise<TradingRisk> {
  const token = getAddress(rawToken) as Address;
  const notes: string[] = [];
  const r: TradingRisk = { hasLiquidity: false, notes };

  // ---- quote/stable assets are inherently liquid; skip the pair check ----
  if (QUOTE_ASSETS.has(token.toLowerCase())) {
    r.hasLiquidity = true;
    notes.push("Quote/stable asset (WBNB/USDT/BUSD/USDC) — inherently liquid; not a tradeable-risk target.");
    return r;
  }

  // ---- liquidity (token / WBNB PancakeSwap V2 pair) ----
  try {
    const pair = (await client.readContract({
      address: PANCAKE_V2_FACTORY,
      abi: factoryAbi,
      functionName: "getPair",
      args: [token, WBNB],
    })) as Address;
    if (pair && /[1-9a-f]/i.test(pair.slice(2))) {
      r.pair = getAddress(pair);
      const [reserves, token0] = await Promise.all([
        client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }) as Promise<readonly [bigint, bigint, number]>,
        client.readContract({ address: pair, abi: pairAbi, functionName: "token0" }) as Promise<Address>,
      ]);
      const wbnbReserve = getAddress(token0) === getAddress(WBNB) ? reserves[0] : reserves[1];
      r.liquidityBnb = Number(formatEther(wbnbReserve));
      r.hasLiquidity = r.liquidityBnb > 0;
      if (r.liquidityBnb < 1) notes.push(`Very thin liquidity (~${r.liquidityBnb.toFixed(3)} BNB) — a single sell or an LP pull can collapse price (rug-prone).`);
      else notes.push(`PancakeSwap V2 liquidity ~${r.liquidityBnb.toFixed(2)} BNB.`);
    } else {
      notes.push("No PancakeSwap V2 token/WBNB pair — not tradeable on the canonical BSC DEX (or routed elsewhere).");
    }
  } catch {
    notes.push("Could not read liquidity (factory/pair call failed).");
  }

  // ---- tax getters ----
  const supply = await read<bigint>(client, token, "totalSupply");
  const buyT = (await read<bigint>(client, token, "buyTax")) ?? (await read<bigint>(client, token, "_buyTax"));
  const sellT = (await read<bigint>(client, token, "sellTax")) ?? (await read<bigint>(client, token, "_sellTax"));
  if (buyT !== undefined) r.buyTaxBps = bpsFromMaybePercent(buyT);
  if (sellT !== undefined) r.sellTaxBps = bpsFromMaybePercent(sellT);
  if (r.buyTaxBps === undefined && r.sellTaxBps === undefined) {
    const totalFee = (await read<bigint>(client, token, "totalFees")) ?? (await read<bigint>(client, token, "_taxFee"));
    if (totalFee !== undefined) { r.sellTaxBps = bpsFromMaybePercent(totalFee); notes.push("Token exposes an adjustable fee — sells may be taxed."); }
  }
  if ((r.sellTaxBps ?? 0) >= 1500 || (r.buyTaxBps ?? 0) >= 1500) notes.push(`High tax detected (buy ${(r.buyTaxBps ?? 0) / 100}% / sell ${(r.sellTaxBps ?? 0) / 100}%) — round-trips bleed value; >50% sell tax is effectively a honeypot.`);

  // ---- transfer limits ----
  const maxTx = (await read<bigint>(client, token, "maxTransactionAmount")) ?? (await read<bigint>(client, token, "maxTxAmount")) ?? (await read<bigint>(client, token, "_maxTxAmount"));
  const maxWallet = (await read<bigint>(client, token, "maxWallet")) ?? (await read<bigint>(client, token, "_maxWalletSize"));
  if (supply && supply > 0n) {
    if (maxTx !== undefined && maxTx > 0n) { r.maxTxBps = Number((maxTx * 10000n) / supply); if (r.maxTxBps < 50) notes.push(`Tiny max-tx (~${(r.maxTxBps / 100).toFixed(2)}% of supply) — can trap size and block exits.`); }
    if (maxWallet !== undefined && maxWallet > 0n) { r.maxWalletBps = Number((maxWallet * 10000n) / supply); }
  }

  // ---- trading-enabled flag ----
  const te = (await read<boolean>(client, token, "tradingOpen")) ?? (await read<boolean>(client, token, "tradingActive")) ?? (await read<boolean>(client, token, "tradingEnabled"));
  if (te !== undefined) {
    r.tradingEnabled = te;
    if (te === false) notes.push("Trading is gated by an owner flag (tradingEnabled=false) — an agent could buy via a privileged path and then be unable to sell until the owner allows it.");
  }

  return r;
}
