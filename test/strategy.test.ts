/**
 * Network-free tests for the strategy Skill: indicators, signal generation, and
 * the backtester on synthetic price series. Run: tsx test/strategy.test.ts
 */
import { sma, rsi, macd, type Candle } from "../src/signals.js";
import { generateSignals, DEFAULT_PARAMS } from "../src/strategy.js";
import { runBacktest } from "../src/backtest.js";

let passed = 0;
function ok(cond: boolean, name: string) {
  if (!cond) { console.error(`  FAIL ${name}`); process.exitCode = 1; }
  else { console.log(`  ok  ${name}`); passed++; }
}

function candles(prices: number[]): Candle[] {
  return prices.map((p, i) => ({ openTime: i * 86400000, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 1000 }));
}

// ---- indicators (monotonic series for clean bounds checks) ----
const up = Array.from({ length: 260 }, (_, i) => 100 + i); // monotonic uptrend
const down = Array.from({ length: 260 }, (_, i) => 360 - i); // monotonic downtrend

// realistic wavy series for strategy/backtest (a momentum strategy needs swings)
const wavyUp = Array.from({ length: 320 }, (_, i) => 100 + i * 0.6 + 9 * Math.sin(i / 6));
const wavyDown = Array.from({ length: 320 }, (_, i) => 400 - i * 0.6 + 9 * Math.sin(i / 6));

const rs = rsi(up, 14);
ok(rs.every((v) => v === undefined || (v >= 0 && v <= 100)), "RSI stays within 0..100");
ok(rs[rs.length - 1]! > 70, "RSI high on a steady uptrend");
ok(rsi(down, 14)[259]! < 30, "RSI low on a steady downtrend");

const s = sma([1, 2, 3, 4, 5], 3);
ok(s[0] === undefined && s[1] === undefined, "SMA undefined before the window fills");
ok(s[2] === 2 && s[4] === 4, "SMA computes the rolling mean");

const mk = macd(up, 12, 26, 9);
ok(mk.hist[259] !== undefined, "MACD histogram defined late in the series");

// ---- strategy ----
const upBars = generateSignals(candles(wavyUp), DEFAULT_PARAMS);
ok(upBars.some((b) => b.action === "enter"), "strategy ENTERS during an uptrend");
ok(upBars.some((b) => b.position > 0), "strategy takes long exposure during an uptrend");

const downBars = generateSignals(candles(wavyDown), DEFAULT_PARAMS);
ok(downBars.every((b) => b.position === 0), "strategy stays FLAT through a downtrend (capital preserved)");

// ---- backtest ----
const upRes = runBacktest(candles(wavyUp), upBars);
ok(upRes.equityCurve.length === wavyUp.length, "equity curve has one point per bar");
ok(Number.isFinite(upRes.sharpe) && Number.isFinite(upRes.maxDrawdownPct), "backtest metrics are finite");
ok(upRes.maxDrawdownPct <= 0, "max drawdown is non-positive");
ok(upRes.totalReturnPct > 0, "strategy is profitable on a noisy uptrend");

const downRes = runBacktest(candles(wavyDown), downBars);
ok(downRes.totalReturnPct === 0 && downRes.buyHoldReturnPct < 0, "strategy preserves capital vs a losing buy & hold");

console.log(`\n${passed} checks passed.`);
