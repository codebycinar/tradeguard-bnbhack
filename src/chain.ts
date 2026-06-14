import { createPublicClient, http, type Chain, type PublicClient } from "viem";

/**
 * BNB Smart Chain config. Defaults to BSC mainnet (chainId 56). Override with
 * BSC_RPC_URL / BSC_CHAIN_ID to point at a private RPC or BSC testnet (97).
 *
 * TradeGuard is READ-ONLY by design: it never needs a private key. Everything it
 * does is eth_call / eth_getCode / eth_getStorageAt — safe to run from any agent.
 */
export const bscChain: Chain = {
  id: Number(process.env.BSC_CHAIN_ID ?? 56),
  name: process.env.BSC_NETWORK_NAME ?? "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.BSC_RPC_URL ?? "https://bsc-dataseed.bnbchain.org"] },
    public: { http: [process.env.BSC_RPC_URL ?? "https://bsc-dataseed.bnbchain.org"] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: process.env.BSC_EXPLORER ?? "https://bscscan.com" },
  },
};

/** A ready-to-use read-only viem client for the configured BSC network. */
export function makeBscClient(): PublicClient {
  return createPublicClient({ chain: bscChain, transport: http() }) as PublicClient;
}

// ---------------------------------------------------------------------------
// Well-known BSC addresses used by the trading-risk checks.
// ---------------------------------------------------------------------------

/** Wrapped BNB. */
export const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as const;
/** BUSD (legacy) and USDT — common quote tokens for liquidity lookups. */
export const USDT = "0x55d398326f99059fF775485246999027B3197955" as const;
/** PancakeSwap V2 factory + router (the canonical BSC DEX). */
export const PANCAKE_V2_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73" as const;
export const PANCAKE_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as const;
