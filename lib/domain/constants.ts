export const INDICATORS = {
  emaFast: 20,
  emaSlow: 60,
  rsi: 14,
  atr: 14,
  volumeLookback: 20,
  bbPeriod: 20,
  bbMult: 2,
} as const;

export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export const INTERVAL_MS: Record<(typeof INTERVALS)[number], number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export const LIVE_TTL_MS = 15_000;
export const STALE_MAX_MS = 120_000;
export const TICKER_CACHE_MS = 10_000;
export const KLINE_CACHE_MS = 20_000;
export const CATALOG_CACHE_MS = 30 * 60_000;
export const CATALOG_STALE_MAX_MS = 6 * 60 * 60_000;
export const DERIV_CACHE_MS = 15_000;
export const SELF_WEIGHT_LIMIT = 1200;
export const WEIGHT_WINDOW_MS = 60_000;
export const KLINE_LIMIT = 200;
export const ALERT_INTERVAL_MS = 20_000;

export const INTERVAL_LABEL: Record<(typeof INTERVALS)[number], string> = {
  "1m": "1 分钟",
  "5m": "5 分钟",
  "15m": "15 分钟",
  "1h": "1 小时",
  "4h": "4 小时",
  "1d": "1 日",
};
