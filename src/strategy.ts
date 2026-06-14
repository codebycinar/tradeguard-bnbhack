import { type Candle, sma, rsi, macd } from "./signals.js";

/**
 * Strategy: **Risk-Gated Regime Momentum** (the backtestable strategy spec).
 *
 * A long/flat crypto strategy that blends a trend regime filter, MACD + RSI
 * momentum, and a Fear & Greed sentiment overlay into entry/exit/size rules —
 * the Quantopian-style spec Track 2 asks for, authored as a deterministic Skill.
 *
 * Rules (no lookahead — every decision at bar i uses only data up to bar i, and
 * the resulting position is held into bar i+1):
 *   REGIME   long-only; new entries require close > SMA(trend) (uptrend).
 *   ENTRY    flat -> long when MACD histogram turns positive AND RSI > rsiEntry, in regime.
 *   EXIT     long -> flat when MACD histogram turns negative OR RSI < rsiExit OR
 *            close < SMA(trend) (regime flip) OR drawdown-from-entry <= -stopPct.
 *   SIZE     base 1.0, scaled by the Fear & Greed overlay (if a series is supplied):
 *            extreme greed (>= greedCap) -> 0.5 (overheated, trim);
 *            extreme fear  (<= fearFloor) in regime -> 1.0 (contrarian full size);
 *            otherwise 1.0.
 *
 * The on-chain TradeGuard gate (src/tradeguard.ts) is the universe filter for live
 * deployment: a token whose verdict is "skip" never enters the tradeable set.
 */

export interface StrategyParams {
  smaTrend: number;
  rsiPeriod: number;
  rsiEntry: number;
  rsiExit: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  stopPct: number; // e.g. 0.12 = exit if -12% from entry
  greedCap: number; // F&G >= this -> trim size
  fearFloor: number; // F&G <= this -> contrarian full size
}

export const DEFAULT_PARAMS: StrategyParams = {
  smaTrend: 50, // regime SMA; price above = uptrend (be long), below = risk-off (be flat)
  rsiPeriod: 14,
  rsiEntry: 50, // momentum confirmation for entry
  rsiExit: 45, // (unused by the trend/trailing exit; kept for compatibility/tuning)
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  stopPct: 0.22, // TRAILING stop: exit if price falls 22% from its peak since entry
  greedCap: 80, // F&G >= this -> trim size (overheated)
  fearFloor: 20, // F&G <= this in regime -> full size (contrarian)
};

export interface SignalBar {
  index: number;
  position: number; // target weight 0..1 held into the NEXT bar
  action: "enter" | "hold" | "exit" | "flat";
  reason: string;
}

export function generateSignals(candles: Candle[], params: StrategyParams = DEFAULT_PARAMS, fearGreed?: (number | undefined)[]): SignalBar[] {
  const close = candles.map((c) => c.close);
  const trend = sma(close, params.smaTrend);
  const r = rsi(close, params.rsiPeriod);
  const m = macd(close, params.macdFast, params.macdSlow, params.macdSignal);

  const bars: SignalBar[] = [];
  let inPos = false;
  let peak = 0; // highest close since entry, for the trailing stop

  for (let i = 0; i < candles.length; i++) {
    const px = close[i];
    const inRegime = trend[i] !== undefined && px > (trend[i] as number);
    const histNow = m.hist[i];
    const rsiNow = r[i];

    let action: SignalBar["action"] = inPos ? "hold" : "flat";
    let reason = inPos ? "holding (trend intact)" : "flat (risk-off / below trend)";

    if (!inPos) {
      // TREND-FOLLOWING entry: in an uptrend regime (close > SMA) with momentum
      // confirmation (RSI above threshold OR MACD histogram positive). Enter and
      // ride the trend — high participation in bull markets.
      const momentum = (rsiNow !== undefined && rsiNow > params.rsiEntry) || (histNow !== undefined && histNow > 0);
      if (inRegime && momentum) {
        inPos = true;
        peak = px;
        action = "enter";
        reason = `enter: close>SMA${params.smaTrend} (uptrend) + momentum (RSI ${rsiNow?.toFixed(0) ?? "?"})`;
      }
    } else {
      if (px > peak) peak = px;
      const trailHit = peak > 0 && (px - peak) / peak <= -params.stopPct;
      const regimeExit = trend[i] !== undefined && px < (trend[i] as number);
      if (regimeExit || trailHit) {
        inPos = false;
        action = "exit";
        reason = regimeExit ? `exit: close<SMA${params.smaTrend} (trend broke)` : `exit: trailing stop ${(params.stopPct * 100).toFixed(0)}% from peak`;
      }
    }

    // size overlay (Fear & Greed)
    let size = inPos ? 1 : 0;
    const fg = fearGreed?.[i];
    if (inPos && fg !== undefined) {
      if (fg >= params.greedCap) { size = 0.5; reason += ` | F&G ${fg} extreme-greed -> trim 0.5`; }
      else if (fg <= params.fearFloor && inRegime) { size = 1; reason += ` | F&G ${fg} fear -> full`; }
    }

    bars.push({ index: i, position: size, action, reason });
  }
  return bars;
}
