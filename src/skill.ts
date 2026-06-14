import { getKlines, getFearGreed, getQuote, type Candle } from "./signals.js";
import { generateSignals, DEFAULT_PARAMS, type StrategyParams, type SignalBar } from "./strategy.js";
import { runBacktest, DEFAULT_BACKTEST, type BacktestResult } from "./backtest.js";

/**
 * The Strategy Skill, composed: turns CoinMarketCap + price data into a trading
 * decision (live) and proves it (backtest). This is the LLM-callable surface an
 * agent uses — "should I be long SYMBOL right now, and what does this strategy
 * look like historically?"
 */

/** Map a CMC/base symbol to its Binance USDT spot pair for the price series. */
export function toBinancePair(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith("USDT")) return s;
  if (s === "BNB") return "BNBUSDT";
  return `${s}USDT`;
}

export interface LiveSignal {
  symbol: string;
  asOf: string;
  action: SignalBar["action"];
  position: number;
  reason: string;
  fearGreed?: { value: number; classification: string };
  price?: number;
  pct24h?: number;
}

/**
 * Live strategy decision for `symbol`: pulls recent daily candles (Binance, free)
 * + Fear & Greed and the latest quote (CoinMarketCap, if CMC_API_KEY set), then
 * returns the strategy's current action/position with its reasoning.
 */
export async function liveSignal(symbol: string, params: StrategyParams = DEFAULT_PARAMS): Promise<LiveSignal> {
  const pair = toBinancePair(symbol);
  const [candles, fg, quote] = await Promise.all([
    getKlines(pair, "1d", 260),
    getFearGreed().catch(() => undefined),
    getQuote(symbol.toUpperCase().replace("USDT", "")).catch(() => undefined),
  ]);
  // single current F&G applied to the latest bar only
  const fgSeries = candles.map((_, i) => (i === candles.length - 1 && fg ? fg.value : undefined));
  const bars = generateSignals(candles, params, fgSeries);
  const last = bars[bars.length - 1];
  return {
    symbol: symbol.toUpperCase(),
    asOf: new Date(candles[candles.length - 1].openTime).toISOString().slice(0, 10),
    action: last.action,
    position: last.position,
    reason: last.reason,
    fearGreed: fg,
    price: quote?.price,
    pct24h: quote?.pct24h,
  };
}

export interface BacktestRun extends BacktestResult {
  symbol: string;
  params: StrategyParams;
}

/** Backtest the strategy on `symbol` over `lookbackDays` daily candles. */
export async function backtestSymbol(symbol: string, lookbackDays = 365, params: StrategyParams = DEFAULT_PARAMS): Promise<BacktestRun> {
  const pair = toBinancePair(symbol);
  const candles: Candle[] = await getKlines(pair, "1d", Math.min(1000, lookbackDays + 5));
  const signals = generateSignals(candles, params);
  const result = runBacktest(candles, signals, DEFAULT_BACKTEST);
  return { symbol: symbol.toUpperCase(), params, ...result };
}

export interface PortfolioResult {
  symbols: string[];
  bars: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  avgExposurePct: number;
}

/**
 * Equal-weight PORTFOLIO backtest — the honest way to judge a trend follower.
 * Each symbol gets 1/N of capital and follows its own long/flat signal; when a
 * sleeve is flat it sits in cash. The big trend winners pay for the choppy
 * losers (positive skew). Benchmarked against an equal-weight buy & hold.
 */
export async function portfolioBacktest(symbols: string[], lookbackDays = 1000, params: StrategyParams = DEFAULT_PARAMS): Promise<PortfolioResult> {
  const series = await Promise.all(
    symbols.map(async (s) => {
      const candles = await getKlines(toBinancePair(s), "1d", Math.min(1000, lookbackDays + 5));
      return { candles, signals: generateSignals(candles, params) };
    }),
  );
  const N = series.length;
  const len = Math.min(...series.map((s) => s.candles.length));
  const cost = DEFAULT_BACKTEST.costBps / 10000;

  let equity = 1, bh = 1;
  const eqCurve: number[] = [1];
  const rets: number[] = [];
  const prevPos = new Array(N).fill(0);
  let exposedSum = 0;

  // align from the end (same end date), iterate the last `len` bars
  const off = series.map((s) => s.candles.length - len);
  for (let k = 0; k < len - 1; k++) {
    let pRet = 0, bhRet = 0, exposed = 0;
    for (let a = 0; a < N; a++) {
      const c = series[a].candles, sig = series[a].signals, o = off[a];
      const pos = sig[o + k]?.position ?? 0;
      const turn = Math.abs(pos - prevPos[a]);
      const r = c[o + k + 1].close / c[o + k].close - 1;
      pRet += (pos * r - cost * turn) / N;
      bhRet += r / N;
      if (pos > 0) exposed++;
      prevPos[a] = pos;
    }
    equity *= 1 + pRet; bh *= 1 + bhRet;
    rets.push(pRet); eqCurve.push(equity); exposedSum += exposed / N;
  }

  let peak = -Infinity, maxDd = 0;
  for (const e of eqCurve) { if (e > peak) peak = e; const dd = (e - peak) / peak; if (dd < maxDd) maxDd = dd; }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(DEFAULT_BACKTEST.barsPerYear) : 0;

  return {
    symbols: symbols.map((s) => s.toUpperCase()),
    bars: len,
    totalReturnPct: (equity - 1) * 100,
    buyHoldReturnPct: (bh - 1) * 100,
    maxDrawdownPct: maxDd * 100,
    sharpe,
    avgExposurePct: (exposedSum / Math.max(1, len - 1)) * 100,
  };
}
