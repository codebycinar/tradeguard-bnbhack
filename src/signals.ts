/**
 * Market-data layer for the strategy Skill.
 *
 * - Live signals (CoinMarketCap AI Agent Hub): Fear & Greed index + latest quote
 *   (price, % changes, volume). Sponsor capability = CoinMarketCap.
 * - Historical OHLCV for backtesting: Binance public klines (free, no key). CMC's
 *   free tier doesn't expose historical OHLCV, so we use Binance for the price
 *   series and CMC for the agent-native sentiment/derivatives signals.
 *
 * Everything here is read-only HTTP. No keys required for the backtest path; set
 * CMC_API_KEY to enable the live Fear & Greed / quote signals.
 */

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const BINANCE = "https://api.binance.com";
const CMC_BASE = "https://pro-api.coinmarketcap.com";

/** Historical daily (or any-interval) candles from Binance, e.g. symbol "CAKEUSDT". */
export async function getKlines(symbol: string, interval = "1d", limit = 365): Promise<Candle[]> {
  const url = `${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Binance klines ${symbol} ${res.status}`);
  const rows = (await res.json()) as any[];
  return rows.map((r) => ({
    openTime: r[0],
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5],
  }));
}

async function cmcGet(path: string): Promise<any | undefined> {
  const key = process.env.CMC_API_KEY;
  if (!key) return undefined;
  try {
    const res = await fetch(`${CMC_BASE}${path}`, { headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" } });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/** CoinMarketCap Fear & Greed (latest). 0 = extreme fear, 100 = extreme greed. */
export async function getFearGreed(): Promise<{ value: number; classification: string } | undefined> {
  const d = await cmcGet(`/v3/fear-and-greed/latest`);
  const v = d?.data?.value;
  if (v === undefined) return undefined;
  return { value: Number(v), classification: d?.data?.value_classification ?? "" };
}

/** CoinMarketCap latest quote for a symbol (price, 24h/7d change, volume, market cap). */
export async function getQuote(symbol: string): Promise<
  { price: number; pct24h: number; pct7d: number; volume24h: number; marketCap: number } | undefined
> {
  const d = await cmcGet(`/v2/cryptocurrency/quotes/latest?symbol=${symbol}`);
  const data: any = d?.data;
  const entry: any = data?.[symbol]?.[0] ?? (data ? (Object.values(data)[0] as any)?.[0] : undefined);
  const q = entry?.quote?.USD;
  if (!q) return undefined;
  return { price: q.price, pct24h: q.percent_change_24h, pct7d: q.percent_change_7d, volume24h: q.volume_24h, marketCap: q.market_cap };
}

// ---------------------------------------------------------------------------
// Indicators (pure functions, used by both the live Skill and the backtest)
// ---------------------------------------------------------------------------

export function sma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : undefined);
  }
  return out;
}

export function ema(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  const k = 2 / (period + 1);
  let prev: number | undefined;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(undefined); continue; }
    if (prev === undefined) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += values[j];
      prev = s / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  }
  return out;
}

/** MACD line, signal line, histogram. */
export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const line = values.map((_, i) => (ef[i] !== undefined && es[i] !== undefined ? (ef[i]! - es[i]!) : undefined));
  const lineFilled = line.map((v) => v ?? 0);
  const sig = ema(lineFilled, signal).map((v, i) => (line[i] === undefined ? undefined : v));
  const hist = line.map((v, i) => (v !== undefined && sig[i] !== undefined ? v - sig[i]! : undefined));
  return { line, signal: sig, hist };
}
