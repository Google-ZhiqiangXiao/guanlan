import { LIVE_TTL_MS, STALE_MAX_MS } from "./constants";
import type { Freshness, QuoteSnapshot, QuoteSource, Ticker, WatchItem } from "./types";

export type Reading<T> = {
  upstreamOk: boolean;
  fromCache: boolean;
  value: T | null;
  fetchedAt: number | null;
  error: string | null;
  status: number | null;
};

export function classifyReading(input: {
  upstreamOk: boolean;
  fetchedAt: number | null;
  hasPayload: boolean;
  now: number;
  liveTtlMs?: number;
  staleMaxMs?: number;
}): Freshness {
  if (!input.hasPayload || input.fetchedAt == null) return "unavailable";
  const age = input.now - input.fetchedAt;
  const liveTtl = input.liveTtlMs ?? LIVE_TTL_MS;
  const staleMax = input.staleMaxMs ?? STALE_MAX_MS;
  if (!input.upstreamOk) {
    return age <= staleMax ? "stale" : "unavailable";
  }
  if (age <= liveTtl) return "live";
  if (age <= staleMax) return "stale";
  return "unavailable";
}

export function presentQuote(item: WatchItem, reading: Reading<Ticker> | null, now: number): QuoteSnapshot {
  const payload = reading?.value ?? null;
  const fetchedAt = reading?.fetchedAt ?? null;
  const upstreamOk = reading?.upstreamOk ?? false;
  const fromCache = reading?.fromCache ?? false;
  const hasPayload = Boolean(payload && fetchedAt != null);
  const freshness = classifyReading({ upstreamOk, fetchedAt, hasPayload, now });
  let source: QuoteSource = "none";
  let price: string | null = null;
  let warning: string | null = null;
  if (freshness === "live") {
    source = fromCache ? "cache" : "binance";
    price = payload?.lastPrice ?? null;
  } else if (freshness === "stale") {
    source = "cache";
    price = payload?.lastPrice ?? null;
    warning = "刷新失败或已超出实时窗口。下面的数字是上次成功读取的结果，不是实时行情。";
  } else {
    price = null;
    warning = payload ? "上次成功读取已超过可展示窗口，旧价格已隐藏。" : null;
  }
  return {
    id: item.id,
    symbol: item.symbol,
    market: item.market,
    baseAsset: item.baseAsset,
    quoteAsset: item.quoteAsset,
    freshness,
    source,
    price,
    priceChangePercent: freshness === "unavailable" ? null : (payload?.priceChangePercent ?? null),
    quoteVolume: freshness === "unavailable" ? null : (payload?.quoteVolume ?? null),
    highPrice: freshness === "unavailable" ? null : (payload?.highPrice ?? null),
    lowPrice: freshness === "unavailable" ? null : (payload?.lowPrice ?? null),
    openPrice: freshness === "unavailable" ? null : (payload?.openPrice ?? null),
    exchangeTime: freshness === "unavailable" ? null : (payload?.closeTime ?? null),
    fetchedAt: freshness === "unavailable" ? null : fetchedAt,
    ageMs: fetchedAt == null || freshness === "unavailable" ? null : Math.max(0, now - fetchedAt),
    error: reading?.error ?? (hasPayload ? null : "没有可用行情"),
    warning,
    note: null,
  };
}
