# TradeGuard — a risk-gated trading-strategy Skill for BSC agents

> Submission for **BNB Hack: AI Trading Agent Edition** — **Track 2 (Strategy Skills)**, powered by CoinMarketCap.
> A CMC-driven, backtestable trading strategy authored as an LLM Skill, with an on-chain pre-trade risk gate.

TradeGuard turns market data into a trading decision **and** keeps an autonomous agent out of traps. It has two parts an agent calls as Skills:

1. **Strategy** — `strategy_signal(symbol)` / `strategy_backtest(symbol)`: a transparent **Risk-Gated Trend-Following** strategy that blends CoinMarketCap **Fear & Greed** with price **trend regime + RSI + MACD** into long/flat **entry / exit / size** rules, with an event-driven backtester (returns vs buy & hold, max drawdown, Sharpe, win rate, exposure).
2. **On-chain risk gate** — `assess_trade(token)`: a **read-only** pre-trade check that fuses contract safety (upgradeable proxy, owner-mint, selfdestruct), trading risk (PancakeSwap liquidity, buy/sell tax, transfer limits, trading-enabled flag) and CMC market context (listed? age? cap? volume?) into a verdict **trade / reduce / skip** + a `maxAllocationPct`. It is the universe filter that runs **before** the strategy sizes into anything.

The strategy answers *"should I be long?"*; the gate answers *"is this token even safe to hold?"*. Together they are the **risk-management layer** an autonomous BSC trader needs.

## Why this is built the way it is (honest framing)

Beating crypto buy & hold with simple technicals is hard, and we don't claim to. What TradeGuard delivers, and what Track 2 actually scores (technical execution, originality, real-world relevance, demo):

- **A real, transparent, backtestable strategy** — not a black box. Trend-following with a trailing stop: high participation in strong uptrends, flat (risk-off) below the regime line.
- **An original on-chain risk gate** — most "strategy skills" ignore *whether the token is a trap*. On BSC that's the difference between a strategy and a drained wallet. This is our edge and it's genuinely novel for this category.
- **Deep CoinMarketCap use** (the sponsor capability): Fear & Greed in the signal, and listing / age / market-cap / volume in the gate.

## Evidence (real runs)

Backtest, daily candles, 25 bps/leg costs, ~1000 days (Binance price series, free):

| Asset | Strategy | Buy & Hold | Max DD | Sharpe | Exposure |
|---|---|---|---|---|---|
| ETH | **+126.6%** | +3.7% | -46.5% | 0.98 | 47% |
| BNB | +106.3% | +182.8% | -37.4% | 0.97 | 56% |
| ADA | -30.4% | -32.3% | -77.2% | 0.14 | 33% |
| LINK | -22.9% | +17.4% | -53.3% | 0.22 | 42% |
| CAKE | -70.0% | +16.7% | -85.5% | -0.23 | 40% |

Trend-following has **positive skew**: it shines on strong trends (ETH crushes B&H; BNB captures most of the bull) and gets whipsawed on choppy names (CAKE/LINK). It is meant to run across a basket; the big winners are designed to pay for the chop. Numbers move with the window — this is a transparent baseline, not a tuned-to-win curve.

On-chain gate (live BSC, read-only):

```
CAKE  -> REDUCE (risk 50/100, maxAlloc 3%)  reasons: mintable token (owner can mint) -> size down
WBNB  -> TRADE  (risk 0/100,  maxAlloc 25%) no blocking risks
<token with no PancakeSwap pair / sell-tax >= 50% / trading disabled> -> SKIP (can't exit)
```

## Architecture

```
  agent (LangChain / MCP / CMC Agent Hub / BNB AI Agent SDK)
        │  strategy_signal / strategy_backtest        │  assess_trade(token)
        ▼                                             ▼
  ┌───────────────────────────┐              ┌──────────────────────────┐
  │  Strategy Skill            │              │  On-chain Risk Gate       │
  │  signals.ts  (CMC F&G,     │  CMC →       │  tradeguard.ts            │
  │   quotes; Binance OHLCV;   │◀──────────── │   ├ analyze.ts (bytecode) │── BSC RPC
  │   RSI/MACD/SMA)            │              │   ├ honeypot.ts (Pancake  │── BSC RPC
  │  strategy.ts (entry/exit)  │              │   │   liquidity/tax/limit)│
  │  backtest.ts (PnL/DD/Sharpe)│             │   └ cmc.ts (market ctx)   │── CoinMarketCap
  └───────────────────────────┘              └──────────────────────────┘
        read-only HTTP / RPC — no private key, no transaction
```

## Required-tech / sponsor mapping

| Capability | How TradeGuard uses it |
|---|---|
| **CoinMarketCap** (required, Track 2) | Fear & Greed in the strategy signal; listing/age/market-cap/volume in the risk gate |
| BNB Chain | the gate reads BSC state (PancakeSwap liquidity, token bytecode) directly |
| (extensible) | Trust Wallet Agent Kit / BNB AI Agent SDK can consume the `assess_trade` + `strategy_signal` Skills as a risk layer before execution (Track 1 bridge) |

## Run it

```bash
npm install
npm test                 # 21 network-free checks (indicators, strategy, backtest, bytecode walker)
npm run demo             # per-asset + equal-weight portfolio backtest, + live signal  (Binance, free)
npm run demo:guard       # on-chain pre-trade risk gate on BSC  (public RPC, free)
npm run mcp              # MCP server: strategy_signal / strategy_backtest / assess_trade
```

Env (all optional — the backtest + gate run with no keys):
```
CMC_API_KEY=...          # enables Fear & Greed in the signal + market-context in the gate (free CMC Basic plan)
BSC_RPC_URL=...          # override the default public BSC RPC
```

## Consume it as a Skill

- **LangChain / LangGraph:** `import { createTradeGuardTools } from "tradeguard-strategy-skill"`
- **Model Context Protocol:** `npm run mcp` → tools `strategy_signal`, `strategy_backtest`, `assess_trade`
- **Direct:** `liveSignal(symbol)`, `backtestSymbol(symbol)`, `assessTrade(client, token)`

## Disclaimer

Heuristic strategy + risk gate, read-only, for research. Not financial advice; crypto trading can lose money. The risk gate is a bytecode/liquidity/market heuristic, not a formal audit.
