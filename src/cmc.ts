/**
 * CoinMarketCap market-context layer (sponsor capability: CoinMarketCap).
 *
 * Adds the market dimension an autonomous trading agent should weigh before
 * buying a BSC token: is it even listed/tracked, how old is it, how deep is its
 * market cap & 24h volume. A brand-new, unlisted, micro-cap token is a different
 * risk class than a tracked blue-chip — independent of the contract's bytecode.
 *
 * Set CMC_API_KEY (free "Basic" plan works). With no key the layer degrades
 * gracefully: TradeGuard still runs on the on-chain signals and notes that the
 * market layer was skipped.
 */

const CMC_BASE = "https://pro-api.coinmarketcap.com";

export interface MarketContext {
  available: boolean; // did we get data from CMC?
  listed?: boolean; // present in CMC's database for this address
  name?: string;
  symbol?: string;
  cmcRank?: number;
  marketCapUsd?: number;
  volume24hUsd?: number;
  dateAdded?: string;
  ageDays?: number;
  isActive?: boolean;
  notes: string[];
}

async function cmcGet(path: string, key: string): Promise<any | undefined> {
  try {
    const res = await fetch(`${CMC_BASE}${path}`, { headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" } });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function marketContext(contractAddress: string): Promise<MarketContext> {
  const notes: string[] = [];
  const key = process.env.CMC_API_KEY;
  if (!key) {
    return { available: false, notes: ["CMC market layer skipped (set CMC_API_KEY for listing/market-cap/age signals)."] };
  }

  const addr = contractAddress.toLowerCase();
  const info = await cmcGet(`/v2/cryptocurrency/info?address=${addr}`, key);
  const entry = info?.data && Object.values(info.data as Record<string, any>)[0];
  if (!entry) {
    notes.push("Token is NOT listed/tracked on CoinMarketCap — treat as an unverified, very-early or obscure asset (elevated risk for autonomous buys).");
    return { available: true, listed: false, notes };
  }

  const dateAdded: string | undefined = entry.date_added;
  let ageDays: number | undefined;
  if (dateAdded) {
    ageDays = Math.max(0, Math.floor((Date.parse(process.env.TG_NOW ?? new Date().toISOString()) - Date.parse(dateAdded)) / 86400000));
    if (ageDays <= 7) notes.push(`Listed only ${ageDays} day(s) ago — fresh launch; size down and expect volatility/rug risk.`);
  }
  const isActive = entry.is_active === 1 || entry.is_active === true;
  if (!isActive) notes.push("CMC marks this asset inactive/untracked.");

  const quotes = await cmcGet(`/v2/cryptocurrency/quotes/latest?address=${addr}`, key);
  const q = quotes?.data && Object.values(quotes.data as Record<string, any>)[0];
  const usd = q?.quote?.USD;
  const marketCapUsd: number | undefined = usd?.market_cap ?? undefined;
  const volume24hUsd: number | undefined = usd?.volume_24h ?? undefined;
  if (marketCapUsd !== undefined && marketCapUsd > 0 && marketCapUsd < 250_000) notes.push(`Micro-cap (~$${Math.round(marketCapUsd).toLocaleString()}) — thin, easily manipulated; high rug/illiquidity risk.`);
  if (volume24hUsd !== undefined && volume24hUsd < 10_000) notes.push(`Very low 24h volume (~$${Math.round(volume24hUsd).toLocaleString()}) — exits may move the price hard.`);

  return {
    available: true,
    listed: true,
    name: entry.name,
    symbol: entry.symbol,
    cmcRank: q?.cmc_rank,
    marketCapUsd,
    volume24hUsd,
    dateAdded,
    ageDays,
    isActive,
    notes,
  };
}
