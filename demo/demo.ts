/**
 * TradeGuard demo — backtest the Risk-Gated Regime Momentum strategy on a basket
 * of BSC majors (price series from Binance, free) and print the live signal.
 *
 *   npm run demo
 *
 * Set CMC_API_KEY to fold the live CoinMarketCap Fear & Greed signal into the
 * current decision (the backtest runs without any key).
 */
import { backtestSymbol, liveSignal, portfolioBacktest } from "../src/skill.js";
import { summarize } from "../src/backtest.js";

const BASKET = ["BNB", "CAKE", "ETH", "ADA", "LINK"];

async function main() {
  console.log("TradeGuard — Risk-Gated Trend-Following  (backtest: ~1000d daily, costs 25bps/leg)\n");

  console.log("Per-asset:");
  for (const sym of BASKET) {
    try {
      const r = await backtestSymbol(sym, 1000);
      console.log("  " + summarize(sym, r));
    } catch (e: any) {
      console.log(`  ${sym}: backtest failed — ${e?.message ?? e}`);
    }
  }

  try {
    const p = await portfolioBacktest(BASKET, 1000);
    console.log(`\nEqual-weight PORTFOLIO (${p.symbols.join("/")}):`);
    console.log(`  strat ${p.totalReturnPct.toFixed(1)}% vs equal-weight B&H ${p.buyHoldReturnPct.toFixed(1)}% | maxDD ${p.maxDrawdownPct.toFixed(1)}% | Sharpe ${p.sharpe.toFixed(2)} | avg exposure ${p.avgExposurePct.toFixed(0)}%`);
  } catch (e: any) {
    console.log(`  portfolio backtest failed — ${e?.message ?? e}`);
  }

  console.log("\nLive signal (current decision):");
  for (const sym of ["BNB", "CAKE"]) {
    try {
      const s = await liveSignal(sym);
      const fg = s.fearGreed ? ` | F&G ${s.fearGreed.value} (${s.fearGreed.classification})` : " | F&G n/a (set CMC_API_KEY)";
      console.log(`  ${s.symbol} @ ${s.asOf}: ${s.action.toUpperCase()} pos=${s.position}${fg}\n      ${s.reason}`);
    } catch (e: any) {
      console.log(`  ${sym}: live signal failed — ${e?.message ?? e}`);
    }
  }
  console.log("\nNote: heuristic strategy + backtest, not financial advice. The on-chain TradeGuard gate");
  console.log("(npm run demo:guard) is the universe filter that keeps trap tokens out before sizing.");
}

main().catch((e) => { console.error(e); process.exit(1); });
