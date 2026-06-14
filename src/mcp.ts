#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { liveSignal, backtestSymbol } from "./skill.js";
import { assessTrade } from "./tradeguard.js";
import { makeBscClient } from "./chain.js";

/**
 * TradeGuard Strategy Skill as a Model Context Protocol server (stdio). Any
 * MCP-capable agent (Claude, the CoinMarketCap Agent Hub, BNB AI Agent SDK, ...)
 * can mount this and call:
 *   - strategy_signal   : current long/flat decision + size for a symbol
 *   - strategy_backtest : historical performance of the strategy on a symbol
 *   - assess_trade      : on-chain pre-trade risk gate for a token address
 *
 * Run: tsx src/mcp.ts   (or `npm run mcp`)
 */
const client = makeBscClient();
const server = new McpServer({ name: "tradeguard-strategy-skill", version: "1.0.0" });

server.tool(
  "strategy_signal",
  "Risk-Gated Regime Momentum strategy: return the CURRENT long/flat decision and position size for a symbol (e.g. BNB, CAKE, ETH), blending CoinMarketCap Fear & Greed with price trend + RSI + MACD. Call before deciding to be long.",
  { symbol: z.string().describe("Base symbol, e.g. BNB, CAKE, ETH.") },
  async ({ symbol }) => {
    try {
      const s = await liveSignal(symbol);
      return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({ status: "error", message: e?.message ?? String(e) }) }], isError: true };
    }
  },
);

server.tool(
  "strategy_backtest",
  "Backtest the Risk-Gated Regime Momentum strategy on a symbol over the lookback window. Returns total return vs buy & hold, max drawdown, Sharpe, trade count, win rate and exposure.",
  { symbol: z.string().describe("Base symbol, e.g. BNB, CAKE, ETH."), lookbackDays: z.number().optional().describe("Daily candles to test (default 365).") },
  async ({ symbol, lookbackDays }) => {
    try {
      const r = await backtestSymbol(symbol, lookbackDays ?? 365);
      const { equityCurve, ...metrics } = r;
      return { content: [{ type: "text", text: JSON.stringify(metrics, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({ status: "error", message: e?.message ?? String(e) }) }], isError: true };
    }
  },
);

server.tool(
  "assess_trade",
  "On-chain pre-trade RISK GATE for a BSC token address: fuses contract safety (proxy/owner-mint/selfdestruct), trading risk (PancakeSwap liquidity, buy/sell tax, transfer limits) and CoinMarketCap market context into verdict = trade/reduce/skip + a maxAllocationPct. Use to filter the strategy's tradeable universe.",
  { token: z.string().describe("BSC token contract address.") },
  async ({ token }) => {
    try {
      const v = await assessTrade(client, token);
      return { content: [{ type: "text", text: JSON.stringify(v, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({ status: "error", message: e?.message ?? String(e) }) }], isError: true };
    }
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("tradeguard-strategy-skill MCP server running on stdio");
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
