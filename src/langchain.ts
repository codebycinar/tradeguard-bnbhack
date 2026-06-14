import { StructuredTool } from "@langchain/core/tools";
import type { PublicClient } from "viem";
import { z } from "zod";
import { assessTrade, TradeGuardInputSchema } from "./tradeguard.js";
import { makeBscClient } from "./chain.js";

/**
 * TradeGuard as a LangChain StructuredTool. Drop it into any LangChain / LangGraph
 * BSC trading agent; the agent MUST call it before buying a token and obey the
 * returned verdict (trade / reduce / skip) and the maxAllocationPct size hint.
 *
 * Read-only: constructs (or reuses) a read-only BSC client; never signs.
 */
export class TradeGuardTool extends StructuredTool<typeof TradeGuardInputSchema> {
  name = "trade_guard_assess_trade";
  description =
    "Pre-trade risk gate for autonomous BSC trading agents. BEFORE buying a token, call this with the token contract address. " +
    "Fuses contract safety (upgradeable proxy, owner-mint, pause/blacklist, selfdestruct), trading risk (PancakeSwap liquidity, buy/sell tax, transfer limits, trading-enabled flag) " +
    "and CoinMarketCap market context (listed? age? market cap? volume?) into one decision: verdict = trade / reduce / skip, a 0-100 riskScore, and maxAllocationPct (a position-size cap). " +
    "If verdict is 'skip', do NOT buy. If 'reduce', cap the position at maxAllocationPct of budget.";
  schema = TradeGuardInputSchema;

  constructor(private readonly client: PublicClient = makeBscClient()) {
    super();
  }

  protected async _call(input: z.infer<typeof TradeGuardInputSchema>): Promise<string> {
    try {
      const verdict = await assessTrade(this.client, input.token);
      return JSON.stringify({ status: "success", ...verdict });
    } catch (error: any) {
      return JSON.stringify({ status: "error", message: error?.message ?? String(error) });
    }
  }
}

/** Convenience factory (createXxxTools(agent) style). */
export function createTradeGuardTools(client?: PublicClient) {
  return [new TradeGuardTool(client)];
}
