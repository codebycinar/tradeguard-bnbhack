## TradeGuard — a risk-gated, backtestable trading-strategy Skill for BSC agents

**Track 2 (Strategy Skills), powered by CoinMarketCap.** TradeGuard is a CMC-driven trading strategy authored as an LLM Skill — *plus* the piece most strategy skills skip: an on-chain pre-trade risk gate that keeps an autonomous agent out of traps.

An agent calls two Skills:

- **`strategy_signal(symbol)` / `strategy_backtest(symbol)`** — a transparent **Risk-Gated Trend-Following** strategy that blends CoinMarketCap **Fear & Greed** with price **trend regime + RSI + MACD** into long/flat **entry / exit / size** rules, backed by an event-driven backtester (return vs buy & hold, max drawdown, Sharpe, win rate, exposure).
- **`assess_trade(token)`** — a **read-only** pre-trade risk gate fusing contract safety (upgradeable proxy, owner-mint, selfdestruct), trading risk (PancakeSwap liquidity, buy/sell tax, transfer limits, trading-enabled flag) and CMC market context (listed? age? cap? volume?) into **trade / reduce / skip** + a position-size cap. It filters the tradeable universe *before* the strategy sizes into anything.

### Why it's original & relevant
Most "strategy skills" generate a signal and ignore *whether the token is safe to hold*. On BSC — full of honeypots, owner-mint tokens and rug-pullable pairs — that's the difference between a strategy and a drained wallet. TradeGuard fuses **CMC alpha** with an **on-chain safety gate**: the risk-management layer an autonomous BSC trader actually needs. It plugs into Track 1 agents (Trust Wallet Agent Kit / BNB AI Agent SDK) as the guardrail before execution.

### Honest about performance
We don't claim to beat the market with technicals. The strategy is a transparent trend-follower with positive skew: it shines on strong trends (backtest: **ETH +126.6% vs +3.7% buy & hold**, BNB +106% capturing most of the bull) and is whipsawed on choppy names — it's a basket strategy where the big winners pay for the chop. The value is the **engineering** (clean backtest framework + CMC integration) and the **original on-chain risk gate**.

### Deep CoinMarketCap use (sponsor)
Fear & Greed in the signal; listing / age / market-cap / 24h-volume in the gate.

### Tech
TypeScript · viem (BSC RPC) · CoinMarketCap API · Binance public klines (backtest OHLCV, free) · LangChain tool + MCP server. Read-only end to end — no private key, no transaction. 21 network-free tests; live backtest + on-chain gate demos.

**Repo:** https://github.com/codebycinar/tradeguard-bnbhack
