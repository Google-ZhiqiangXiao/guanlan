import { parseDecimal } from "./numbers";
import type { Candle, Ticker } from "./types";

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isBinanceErrorBody(body: unknown): body is { code: number; msg: string } {
  const row = record(body);
  if (!row) return false;
  return typeof row.code === "number" && typeof row.msg === "string" && !("lastPrice" in row) && !("symbols" in row) && !("serverTime" in row);
}

export function textLooksRestricted(text: string): boolean {
  return text.toLowerCase().includes("restricted location");
}

export function parseTicker(row: unknown): Ticker | null {
  const data = record(row);
  if (!data || typeof data.symbol !== "string") return null;
  if (typeof data.lastPrice !== "string" || parseDecimal(data.lastPrice) == null) return null;
  const optional = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : null);
  const closeTime = typeof data.closeTime === "number" ? data.closeTime : null;
  return {
    symbol: data.symbol,
    lastPrice: data.lastPrice,
    priceChangePercent: optional("priceChangePercent"),
    quoteVolume: optional("quoteVolume"),
    highPrice: optional("highPrice"),
    lowPrice: optional("lowPrice"),
    openPrice: optional("openPrice"),
    closeTime,
  };
}

export function parseTickerList(body: unknown): Ticker[] {
  const rows = Array.isArray(body) ? body : [body];
  return rows.flatMap((row) => {
    const ticker = parseTicker(row);
    return ticker ? [ticker] : [];
  });
}

export function parseKlines(body: unknown): Candle[] | null {
  if (!Array.isArray(body)) return null;
  const candles: Candle[] = [];
  for (const row of body) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const openTime = row[0];
    const closeTime = row[6];
    const open = parseDecimal(row[1]);
    const high = parseDecimal(row[2]);
    const low = parseDecimal(row[3]);
    const close = parseDecimal(row[4]);
    const volume = parseDecimal(row[5]);
    if (typeof openTime !== "number" || typeof closeTime !== "number") continue;
    if (open == null || high == null || low == null || close == null || volume == null) continue;
    if (high < low || closeTime < openTime) continue;
    candles.push({ openTime, closeTime, open, high, low, close, volume });
  }
  candles.sort((a, b) => a.openTime - b.openTime);
  const unique: Candle[] = [];
  for (const candle of candles) {
    if (unique.length && unique[unique.length - 1].openTime === candle.openTime) {
      unique[unique.length - 1] = candle;
    } else {
      unique.push(candle);
    }
  }
  return unique;
}

export type Premium = {
  markPrice: string | null;
  indexPrice: string | null;
  lastFundingRate: string | null;
  interestRate: string | null;
  nextFundingTime: number | null;
  time: number | null;
};

export function parsePremium(body: unknown): Premium | null {
  const row = record(body);
  if (!row || typeof row.symbol !== "string") return null;
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  return {
    markPrice: text("markPrice"),
    indexPrice: text("indexPrice"),
    lastFundingRate: text("lastFundingRate"),
    interestRate: text("interestRate"),
    nextFundingTime: typeof row.nextFundingTime === "number" ? row.nextFundingTime : null,
    time: typeof row.time === "number" ? row.time : null,
  };
}

export function parseOpenInterest(body: unknown): { openInterest: string; time: number | null } | null {
  const row = record(body);
  if (!row || typeof row.openInterest !== "string" || parseDecimal(row.openInterest) == null) return null;
  return { openInterest: row.openInterest, time: typeof row.time === "number" ? row.time : null };
}

export function parseFundingHistory(body: unknown): Array<{ fundingRate: string; fundingTime: number }> | null {
  if (!Array.isArray(body)) return null;
  const rows: Array<{ fundingRate: string; fundingTime: number }> = [];
  for (const item of body) {
    const row = record(item);
    if (!row || typeof row.fundingRate !== "string" || typeof row.fundingTime !== "number") continue;
    if (parseDecimal(row.fundingRate) == null) continue;
    rows.push({ fundingRate: row.fundingRate, fundingTime: row.fundingTime });
  }
  return rows;
}

export function futuresKlineWeight(limit: number): number {
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (limit <= 1000) return 5;
  return 10;
}

export function spotTickerWeight(count: number): number {
  if (count <= 0) return 0;
  if (count <= 20) return 2;
  if (count <= 100) return 40;
  return 80;
}
