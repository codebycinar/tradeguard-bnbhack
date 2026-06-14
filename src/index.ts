/**
 * TradeGuard — a risk-gated, backtestable BSC trading-strategy Skill.
 *
 * Built for BNB Hack: AI Trading Agent Edition (Track 2 — Strategy Skills,
 * powered by CoinMarketCap). It turns market data into a trading strategy:
 *   - SIGNAL  CMC Fear & Greed + price momentum (RSI/MACD) + trend regime -> action/size
 *   - BACKTEST event-driven, with costs -> total return, max drawdown, Sharpe, win rate
 *   - RISK GATE  on-chain TradeGuard (read-only) keeps trap tokens out of the universe
 *
 * Consume it three ways:
 *   - LangChain / LangGraph: createStrategyTools()  (and TradeGuardTool)
 *   - Model Context Protocol: run src/mcp.ts (strategy_signal / strategy_backtest / assess_trade)
 *   - Direct: liveSignal(symbol) / backtestSymbol(symbol) / assessTrade(client, token)
 */

// strategy skill
export { liveSignal, backtestSymbol, toBinancePair } from "./skill.js";
export type { LiveSignal, BacktestRun } from "./skill.js";
export { generateSignals, DEFAULT_PARAMS } from "./strategy.js";
export type { StrategyParams, SignalBar } from "./strategy.js";
export { runBacktest, summarize, DEFAULT_BACKTEST } from "./backtest.js";
export type { BacktestResult } from "./backtest.js";
export { getKlines, getFearGreed, getQuote, sma, ema, rsi, macd } from "./signals.js";
export type { Candle } from "./signals.js";

// on-chain risk gate (TradeGuard)
export { assessTrade, TradeGuardInputSchema, TradeVerdictSchema } from "./tradeguard.js";
export type { TradeVerdict, TradeGuardInput } from "./tradeguard.js";
export { assessTrading } from "./honeypot.js";
export type { TradingRisk } from "./honeypot.js";
export { marketContext } from "./cmc.js";
export type { MarketContext } from "./cmc.js";
export { analyzeContract, scanBytecode } from "./analyze.js";
export type { RiskReport, Flag } from "./analyze.js";

// chain + skill surfaces
export { bscChain, makeBscClient, WBNB, PANCAKE_V2_ROUTER } from "./chain.js";
export { TradeGuardTool, createTradeGuardTools } from "./langchain.js";
