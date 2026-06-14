/**
 * TradeGuard on-chain risk-gate demo (BSC). Screens a few tokens and prints the
 * verdict (trade / reduce / skip) + position-size hint — the universe filter that
 * runs before the strategy sizes into anything.
 *
 *   npm run demo:guard
 *
 * Uses a public BSC RPC by default (override with BSC_RPC_URL). Set CMC_API_KEY
 * to add the market-context layer (listing / market cap / age).
 */
import { makeBscClient } from "../src/chain.js";
import { assessTrade } from "../src/tradeguard.js";

// CAKE (PancakeSwap) — a legit major; WBNB — blue-chip; plus any address passed on argv.
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

async function main() {
  const client = makeBscClient();
  const targets = process.argv.slice(2);
  const list = targets.length ? targets : [CAKE, WBNB];

  console.log("TradeGuard — on-chain pre-trade risk gate (BSC, read-only)\n");
  for (const t of list) {
    try {
      const v = await assessTrade(client, t);
      console.log(`  ${t}`);
      console.log(`    -> ${v.verdict.toUpperCase()}  risk ${v.riskScore}/100  maxAlloc ${v.maxAllocationPct}%`);
      console.log(`    ${v.summary}`);
      if (v.reasons.length) console.log(`    reasons: ${v.reasons.slice(0, 4).join(" | ")}`);
      console.log();
    } catch (e: any) {
      console.log(`  ${t}: failed — ${e?.message ?? e}\n`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
