import type { INTERVALS } from "./constants";

export type Market = "spot" | "perpetual";
export type Interval = (typeof INTERVALS)[number];
export type Freshness = "live" | "stale" | "unavailable" | "demo";
export type DataMode = "live" | "demo";
export type QuoteSource = "binance" | "cache" | "demo" | "none";

export type AlertKind =
  | "close_above"
  | "close_below"
  | "rsi_above"
  | "rsi_below"
  | "atr_pct_above"
  | "volume_ratio_above"
  | "bb_outside";

export type Candle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Ticker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string | null;
  quoteVolume: string | null;
  highPrice: string | null;
  lowPrice: string | null;
  openPrice: string | null;
  closeTime: number | null;
};

export type SymbolInfo = {
  symbol: string;
  market: Market;
  baseAsset: string;
  quoteAsset: string;
};

export type WatchItem = {
  id: number;
  symbol: string;
  market: Market;
  baseAsset: string;
  quoteAsset: string;
  createdAt: string;
};

export type Settings = {
  dataMode: DataMode;
  refreshSeconds: number;
  klineInterval: Interval;
  defaultCooldownSeconds: number;
};

export type AlertRule = {
  id: number;
  symbol: string;
  market: Market;
  kind: AlertKind;
  threshold: number;
  enabled: boolean;
  cooldownSeconds: number;
  klineInterval: Interval;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BandwidthCompare = "narrower" | "wider" | "same" | "unavailable";
export type EmaRelation = "short_above" | "short_below" | "equal" | "unavailable";

export type BollingerPoint = {
  middle: number;
  upper: number;
  lower: number;
  /** (上轨-下轨)/中轨。中轨为 0 时为 null。 */
  bandwidth: number | null;
  /** 收盘价严格高于上轨或低于下轨。等于轨道不算在外。 */
  outside: boolean;
};

export type IndicatorSnapshot = {
  ema20: number | null;
  ema60: number | null;
  emaRelation: EmaRelation;
  rsi: number | null;
  atr: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  bb: BollingerPoint | null;
  bandwidthPct: number | null;
  bandwidthVsPrevious: BandwidthCompare;
};

export type QuoteSnapshot = {
  id: number;
  symbol: string;
  market: Market;
  baseAsset: string;
  quoteAsset: string;
  freshness: Freshness;
  source: QuoteSource;
  price: string | null;
  priceChangePercent: string | null;
  quoteVolume: string | null;
  highPrice: string | null;
  lowPrice: string | null;
  openPrice: string | null;
  exchangeTime: number | null;
  fetchedAt: number | null;
  ageMs: number | null;
  error: string | null;
  warning: string | null;
  note: string | null;
};

export type OiChange =
  | {
      status: "ok";
      previous: number;
      latest: number;
      change: number;
      changePct: number | null;
      previousTime: number;
      latestTime: number;
    }
  | { status: "insufficient"; reason: string };
