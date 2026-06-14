import { type Candle } from "./signals.js";
import { type SignalBar } from "./strategy.js";

/**
 * Event-driven backtester. Applies the strategy's target position at bar i to the
 * close-to-close return into bar i+1 (no lookahead), charges a round-trip-aware
 * cost on every position change (taker fee + slippage), and reports the metrics a
 * judge expects: total return, max drawdown, Sharpe, trade count, win rate,
 * exposure — benchmarked against buy & hold.
 */

export interface BacktestParams {
  /** per-side cost in basis points (fee + slippage). 25 bps = 0.25% each rebalance leg. */
  costBps: number;
  /** bars per year for annualizing Sharpe (365 for daily). */
  barsPerYear: number;
}

export const DEFAULT_BACKTEST: BacktestParams = { costBps: 25, barsPerYear: 365 };

export interface BacktestResult {
  bars: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  trades: number;
  winRatePct: number;
  exposurePct: number;
  finalEquity: number;
  equityCurve: number[];
}

export function runBacktest(candles: Candle[], signals: SignalBar[], bp: BacktestParams = DEFAULT_BACKTEST): BacktestResult {
  const cost = bp.costBps / 10000;
  let equity = 1;
  let prevPos = 0;
  const equityCurve: number[] = [1];
  const periodReturns: number[] = [];

  let trades = 0;
  let wins = 0;
  let entryEquity = 0;
  let exposedBars = 0;

  // iterate to the second-to-last bar (need close[i+1] for the realized return)
  for (let i = 0; i < candles.length - 1; i++) {
    const pos = signals[i]?.position ?? 0;

    // cost on rebalancing from prevPos to pos
    const turnover = Math.abs(pos - prevPos);
    if (turnover > 0) equity *= 1 - cost * turnover;

    // round-trip win tracking
    if (prevPos === 0 && pos > 0) { trades++; entryEquity = equity; }
    if (prevPos > 0 && pos === 0) { if (equity > entryEquity) wins++; }

    const r = candles[i + 1].close / candles[i].close - 1;
    const stratR = pos * r;
    equity *= 1 + stratR;
    periodReturns.push(stratR);
    if (pos > 0) exposedBars++;

    equityCurve.push(equity);
    prevPos = pos;
  }
  // close any open position's win/loss at the end
  if (prevPos > 0 && equity > entryEquity) wins++;

  // metrics
  let peak = -Infinity, maxDd = 0;
  for (const e of equityCurve) { if (e > peak) peak = e; const dd = (e - peak) / peak; if (dd < maxDd) maxDd = dd; }

  const mean = periodReturns.reduce((a, b) => a + b, 0) / (periodReturns.length || 1);
  const variance = periodReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (periodReturns.length || 1);
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(bp.barsPerYear) : 0;

  const buyHold = candles.length > 1 ? candles[candles.length - 1].close / candles[0].close - 1 : 0;

  return {
    bars: candles.length,
    totalReturnPct: (equity - 1) * 100,
    buyHoldReturnPct: buyHold * 100,
    maxDrawdownPct: maxDd * 100,
    sharpe,
    trades,
    winRatePct: trades > 0 ? (wins / trades) * 100 : 0,
    exposurePct: ((exposedBars) / Math.max(1, candles.length - 1)) * 100,
    finalEquity: equity,
    equityCurve,
  };
}

/** Pretty one-line summary for CLI / demo output. */
export function summarize(symbol: string, r: BacktestResult): string {
  return (
    `${symbol}: strat ${r.totalReturnPct.toFixed(1)}% vs B&H ${r.buyHoldReturnPct.toFixed(1)}% | ` +
    `maxDD ${r.maxDrawdownPct.toFixed(1)}% | Sharpe ${r.sharpe.toFixed(2)} | ` +
    `${r.trades} trades, win ${r.winRatePct.toFixed(0)}% | exposure ${r.exposurePct.toFixed(0)}%`
  );
}
