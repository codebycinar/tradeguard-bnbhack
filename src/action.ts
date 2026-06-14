import { z } from "zod";
import { liveSignal, backtestSymbol } from "./skill.js";

/**
 * TradeGuard exposed as a generic Skill/Action object (framework-agnostic shape
 * compatible with the CoinMarketCap Skills library / BNB AI Agent SDK action
 * registries). The primary capability is the strategy decision; backtest is
 * offered as a second action so an agent can justify the strategy.
 */

export const strategySignalAction = {
  name: "TRADEGUARD_STRATEGY_SIGNAL",
  similes: [
    "should I be long this token now",
    "what does the momentum strategy say about CAKE",
    "give me an entry/exit signal using fear and greed",
    "is the regime risk-on for BNB",
  ],
  description:
    "Risk-Gated Regime Momentum strategy: returns the current long/flat decision and position size for a symbol, blending CoinMarketCap Fear & Greed with trend regime + RSI + MACD. Read-only.",
  schema: z.object({ symbol: z.string().describe("Base symbol, e.g. BNB, CAKE, ETH.") }),
  handler: async (_agent: unknown, input: Record<string, any>) => {
    try {
      return { status: "success", ...(await liveSignal(input.symbol)) };
    } catch (e: any) {
      return { status: "error", message: e?.message ?? String(e) };
    }
  },
};

export const strategyBacktestAction = {
  name: "TRADEGUARD_STRATEGY_BACKTEST",
  similes: ["backtest this strategy", "how did this strategy perform historically", "show me the equity curve metrics"],
  description: "Backtest the Risk-Gated Regime Momentum strategy on a symbol. Returns total return vs buy & hold, max drawdown, Sharpe, trades, win rate.",
  schema: z.object({ symbol: z.string(), lookbackDays: z.number().optional() }),
  handler: async (_agent: unknown, input: Record<string, any>) => {
    try {
      const { equityCurve, ...metrics } = await backtestSymbol(input.symbol, input.lookbackDays ?? 365);
      return { status: "success", ...metrics };
    } catch (e: any) {
      return { status: "error", message: e?.message ?? String(e) };
    }
  },
};

export default strategySignalAction;
