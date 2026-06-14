import { z } from "zod";
import { type PublicClient, getAddress } from "viem";
import { analyzeContract, type RiskReport } from "./analyze.js";
import { assessTrading, type TradingRisk } from "./honeypot.js";
import { marketContext, type MarketContext } from "./cmc.js";

/**
 * TradeGuard — a pre-trade risk gate Strategy Skill for autonomous BSC trading agents.
 *
 * Before an agent buys a token, it calls `assessTrade(token)` and gets a single
 * decision — TRADE / REDUCE / SKIP — plus a position-size hint and the reasons.
 * It fuses three independent layers, all READ-ONLY (no key, no transaction):
 *   1. Contract safety   (bytecode: upgradeable proxy, owner-mint, selfdestruct, ...)
 *   2. Trading risk      (liquidity depth, buy/sell tax, transfer limits, trading flag)
 *   3. Market context    (CoinMarketCap: listed? age? market cap? 24h volume?)
 *
 * It is the defensive risk-management strategy every trading agent needs: most
 * strategies look for alpha; TradeGuard stops the agent buying a trap.
 */

export const TradeGuardInputSchema = z.object({
  token: z.string().describe("The BSC token contract address the trading agent is about to BUY."),
});
export type TradeGuardInput = z.infer<typeof TradeGuardInputSchema>;

export const TradeVerdictSchema = z.object({
  token: z.string(),
  chainId: z.number(),
  verdict: z.enum(["trade", "reduce", "skip"]),
  riskScore: z.number().describe("0-100, higher = riskier"),
  maxAllocationPct: z.number().describe("Hint: max % of the agent's budget to allocate to this token (0 = skip)."),
  reasons: z.array(z.string()),
  summary: z.string(),
  security: z.any(),
  trading: z.any(),
  market: z.any(),
});
export type TradeVerdict = z.infer<typeof TradeVerdictSchema>;

export async function assessTrade(client: PublicClient, rawToken: string): Promise<TradeVerdict> {
  const token = getAddress(rawToken);
  const chainId = client.chain?.id ?? Number(process.env.BSC_CHAIN_ID ?? 56);

  const [security, trading, market]: [RiskReport, TradingRisk, MarketContext] = await Promise.all([
    analyzeContract(client, token),
    assessTrading(client, token),
    marketContext(token),
  ]);

  const reasons: string[] = [];
  let score = 0;
  let hardSkip = false;

  // ---- layer 1: contract safety ----
  // Owner/mint/upgradeable powers raise risk (size-down) but do NOT hard-skip a
  // liquid, listed token — many legitimate majors (e.g. CAKE) are mintable. Only a
  // genuinely un-recoverable trait (selfdestruct) hard-skips at this layer.
  score += security.score * 0.5; // contributes up to 50
  const hasSelfdestruct = security.flags.some((f) => f.id === "opcode:selfdestruct");
  if (hasSelfdestruct) {
    hardSkip = true;
    reasons.push("Contract can SELFDESTRUCT — positions/approvals can be stranded.");
  } else if (security.level === "block") {
    const highs = security.flags.filter((f) => f.severity === "high").map((f) => f.title);
    reasons.push(`Elevated contract powers (${highs.join(", ") || security.summary}) — size down.`);
  } else if (security.level === "caution") {
    reasons.push(`Some contract powers present (${security.flags.length} flag(s)).`);
  }

  // ---- layer 2: trading risk ----
  if (security.token?.isERC20 === false) reasons.push("Target is not a standard ERC20 — unusual for a tradeable token.");
  if (!trading.hasLiquidity) {
    hardSkip = true;
    reasons.push("No tradeable PancakeSwap liquidity — cannot exit a position.");
  } else if (trading.liquidityBnb !== undefined && trading.liquidityBnb < 1) {
    score += 30;
    reasons.push(`Thin liquidity (~${trading.liquidityBnb.toFixed(3)} BNB) — exit slippage / rug risk.`);
  } else if (trading.liquidityBnb !== undefined && trading.liquidityBnb < 10) {
    score += 12;
    reasons.push(`Shallow liquidity (~${trading.liquidityBnb.toFixed(1)} BNB).`);
  }
  if (trading.tradingEnabled === false) {
    hardSkip = true;
    reasons.push("Trading is owner-gated (tradingEnabled=false) — buy-now / can't-sell honeypot shape.");
  }
  const sellTax = trading.sellTaxBps ?? 0;
  if (sellTax >= 5000) { hardSkip = true; reasons.push(`Sell tax ${(sellTax / 100).toFixed(0)}% — effectively a honeypot.`); }
  else if (sellTax >= 1500) { score += 25; reasons.push(`High sell tax ${(sellTax / 100).toFixed(0)}%.`); }
  else if (sellTax >= 500) { score += 10; reasons.push(`Sell tax ${(sellTax / 100).toFixed(0)}%.`); }
  if ((trading.maxTxBps ?? 10000) < 25) { score += 12; reasons.push(`Tiny max-tx (~${((trading.maxTxBps ?? 0) / 100).toFixed(2)}% of supply).`); }

  // ---- layer 3: market context ----
  if (market.available) {
    if (market.listed === false) { score += 18; reasons.push("Not listed on CoinMarketCap (unverified / very-early)."); }
    if ((market.ageDays ?? 999) <= 7) { score += 14; reasons.push(`Listed only ${market.ageDays} day(s) ago (fresh launch).`); }
    if ((market.marketCapUsd ?? Infinity) < 250_000) { score += 12; reasons.push("Micro-cap on CMC."); }
    if ((market.volume24hUsd ?? Infinity) < 10_000) { score += 8; reasons.push("Very low 24h volume on CMC."); }
    // an established, listed, deep-cap token earns risk back — owner/mint on a
    // top token is normal, not a trap signal.
    if (market.listed && (market.marketCapUsd ?? 0) > 5_000_000) { score = Math.max(0, score - 25); reasons.push("Established CMC-listed token (>$5M cap) — base risk reduced."); }
  }

  score = Math.min(100, Math.round(score));

  // ---- verdict + size hint ----
  let verdict: TradeVerdict["verdict"];
  let maxAllocationPct: number;
  if (hardSkip || score >= 60) { verdict = "skip"; maxAllocationPct = 0; }
  else if (score >= 30) { verdict = "reduce"; maxAllocationPct = 3; }
  else { verdict = "trade"; maxAllocationPct = score >= 15 ? 10 : 25; }

  const sym = security.token?.symbol ?? market.symbol ?? "token";
  const summary =
    verdict === "skip"
      ? `SKIP ${sym}: ${reasons[0] ?? "risk too high"} (risk ${score}/100).`
      : verdict === "reduce"
        ? `REDUCE ${sym}: tradeable but elevated risk — cap allocation ~${maxAllocationPct}% (risk ${score}/100).`
        : `TRADE ${sym}: no blocking risks found — cap allocation ~${maxAllocationPct}% (risk ${score}/100). Heuristic gate, not a guarantee.`;

  return { token, chainId, verdict, riskScore: score, maxAllocationPct, reasons, summary, security, trading, market };
}
