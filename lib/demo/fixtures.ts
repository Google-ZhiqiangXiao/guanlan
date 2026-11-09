import { INTERVAL_MS } from "@/lib/domain/constants";
import { computeSnapshot, seriesForChart } from "@/lib/domain/indicators";
import { openInterestChange, type OiSample } from "@/lib/domain/oi";
import type { Candle, Interval, Market, SymbolInfo, Ticker } from "@/lib/domain/types";

/** 示例快照固定在这个时刻，不跟当前时钟走。 */
export const DEMO_AS_OF_MS = Date.parse("2024-01-15T01:30:00.000Z");

type Book = {
  symbol: string;
  base: string;
  spotPrice: string;
  perpPrice: string;
  spotChange: string;
  perpChange: string;
  spotQuoteVolume: string;
  perpQuoteVolume: string;
  funding: string;
  oi: string;
};

const BOOKS: Book[] = [
  {
    symbol: "BTCUSDT",
    base: "BTC",
    spotPrice: "100000.00",
    perpPrice: "100100.00",
    spotChange: "1.25",
    perpChange: "1.10",
    spotQuoteVolume: "1000000000.00",
    perpQuoteVolume: "2000000000.00",
    funding: "0.00010000",
    oi: "12345.678",
  },
  {
    symbol: "ETHUSDT",
    base: "ETH",
    spotPrice: "4000.00",
    perpPrice: "4002.00",
    spotChange: "-0.40",
    perpChange: "-0.25",
    spotQuoteVolume: "500000000.00",
    perpQuoteVolume: "800000000.00",
    funding: "-0.00005000",
    oi: "234567.5",
  },
  {
    symbol: "SOLUSDT",
    base: "SOL",
    spotPrice: "150.00",
    perpPrice: "150.20",
    spotChange: "0.00",
    perpChange: "0.15",
    spotQuoteVolume: "80000000.00",
    perpQuoteVolume: "120000000.00",
    funding: "0.00008000",
    oi: "890123.0",
  },
];

export function demoCatalog(): SymbolInfo[] {
  return BOOKS.flatMap((book) => [
    { symbol: book.symbol, market: "spot" as const, baseAsset: book.base, quoteAsset: "USDT" },
    { symbol: book.symbol, market: "perpetual" as const, baseAsset: book.base, quoteAsset: "USDT" },
  ]);
}

function bookOf(symbol: string): Book | null {
  return BOOKS.find((book) => book.symbol === symbol) ?? null;
}

export function demoTicker(symbol: string, market: Market): Ticker | null {
  const book = bookOf(symbol);
  if (!book) return null;
  const price = market === "spot" ? book.spotPrice : book.perpPrice;
  const change = market === "spot" ? book.spotChange : book.perpChange;
  const quoteVolume = market === "spot" ? book.spotQuoteVolume : book.perpQuoteVolume;
  const numeric = Number(price);
  return {
    symbol,
    lastPrice: price,
    priceChangePercent: change,
    quoteVolume,
    highPrice: (numeric * 1.01).toFixed(2),
    lowPrice: (numeric * 0.99).toFixed(2),
    openPrice: (numeric / (1 + Number(change) / 100)).toFixed(2),
    closeTime: DEMO_AS_OF_MS,
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function demoCandles(symbol: string, market: Market, interval: Interval, limit: number): Candle[] | null {
  const book = bookOf(symbol);
  if (!book) return null;
  const end = Number(market === "spot" ? book.spotPrice : book.perpPrice);
  const step = INTERVAL_MS[interval];
  const count = Math.max(1, Math.min(limit, 200));
  const seed = hash(`${symbol}:${market}`) % 20;
  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const openTime = DEMO_AS_OF_MS - (count - i) * step;
    const wave = Math.sin((i + seed) / 6) * end * 0.015;
    const open = end + wave;
    const close = i === count - 1 ? end : end + Math.sin((i + 1 + seed) / 6) * end * 0.015;
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    const volume = 100 + ((i + seed) % 7) * 10;
    candles.push({
      openTime,
      closeTime: openTime + step - 1,
      open,
      high,
      low,
      close,
      volume: i === count - 1 ? 400 : volume,
    });
  }
  return candles;
}

export function demoSeries(symbol: string, market: Market, interval: Interval, limit: number) {
  const candles = demoCandles(symbol, market, interval, limit);
  if (!candles) return null;
  return {
    candles,
    snapshot: computeSnapshot(candles),
    chart: seriesForChart(candles),
  };
}

export function demoOiSamples(symbol: string): OiSample[] | null {
  const book = bookOf(symbol);
  if (!book) return null;
  const latest = Number(book.oi);
  return [
    { value: latest - latest * 0.01, time: DEMO_AS_OF_MS - 3_600_000 },
    { value: latest, time: DEMO_AS_OF_MS },
  ];
}

export function demoDerivatives(symbol: string) {
  const book = bookOf(symbol);
  if (!book) return null;
  const samples = demoOiSamples(symbol) ?? [];
  return {
    markPrice: book.perpPrice,
    indexPrice: book.spotPrice,
    lastFundingRate: book.funding,
    nextFundingTime: DEMO_AS_OF_MS + 4 * 3_600_000,
    openInterest: book.oi,
    openInterestTime: DEMO_AS_OF_MS,
    change: openInterestChange(samples),
    fundingHistory: [
      { fundingRate: book.funding, fundingTime: DEMO_AS_OF_MS - 8 * 3_600_000 },
      { fundingRate: book.funding, fundingTime: DEMO_AS_OF_MS },
    ],
  };
}
