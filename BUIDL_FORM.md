# DoraHacks BUIDL form — field-by-field (copy/paste)

### BUIDL (project) name
```
TradeGuard
```

### BUIDL logo
Use `assets/logo.png` (480×480). Export from `assets/logo.svg` if needed:
`npx --yes @resvg/resvg-js-cli assets/logo.svg assets/logo.png` (or open the SVG and screenshot).

### Vision  (Describe the problem which this project solves — 256-char limit)
```
Autonomous BSC trading agents need two things before they buy: a signal, and proof the token is safe to hold. TradeGuard is both — a CoinMarketCap trend/sentiment strategy Skill plus a read-only on-chain risk gate (liquidity, tax, owner-mint) that blocks traps.
```

### Category
→ **Crypto / Web3**

### Is this BUIDL an AI Agent?
→ **No**  (TradeGuard is a *Skill* that trading agents call — Track 2 "Strategy Skills" — not an autonomous agent itself.)

### GitHub *(required)*
```
https://github.com/codebycinar/tradeguard-bnbhack
```

### Project website (optional)
Leave blank or reuse the repo URL.

### Demo video (optional)
Optional — Track 2 accepts "public repo + clear setup instructions" (the README has them). If you record one: `npm run demo` (backtest + portfolio + live signal) and `npm run demo:guard` (on-chain gate: CAKE -> REDUCE, WBNB -> TRADE), ~90s, upload Unlisted to YouTube.

### Social links (at least one)
```
https://x.com/<your-handle>
```
Fallback: `https://github.com/codebycinar`

### Describe your BUIDL  (markdown)
Paste the contents of `DESCRIBE.md`.

### Team / Team information
Solo. Paste:
```
Solo builder, coding since 2008 (~17 yrs), focused on EVM smart-contract security & vulnerability research. TradeGuard fuses that security edge (the on-chain risk gate) with a CoinMarketCap-driven strategy — designed, built, and tested end-to-end by me.
```

## Before Submit
- Verify the deadline (Track 2 build window ends **June 21**) and submit before it.
- Make sure the GitHub repo opens and the README renders.
- Track 2 = Strategy Skills (no on-chain registration; submit the Skill on DoraHacks).
