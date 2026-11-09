import { INDICATORS } from "./constants";
import type { BandwidthCompare, BollingerPoint, Candle, EmaRelation, IndicatorSnapshot } from "./types";

/** 前 period 根的 SMA 作为种子，之后 EMA_t = C*k + EMA_{t-1}*(1-k)，k=2/(period+1)。不足 period 根则为 null。 */
export function ema(closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(closes.length).fill(null);
  if (!Number.isInteger(period) || period < 2 || closes.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += closes[i];
  seed /= period;
  out[period - 1] = seed;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i += 1) {
    const prev = out[i - 1];
    if (prev == null) return out;
    out[i] = closes[i] * k + prev * (1 - k);
  }
  return out;
}

/**
 * Wilder RSI。第一颗用前 period 个涨跌的简单平均（需要 period+1 个收盘价）。
 * 之后 avg = (prev*(period-1)+current)/period。
 * avgLoss 与 avgGain 同时为 0 时返回 null（0/0）。仅 avgLoss 为 0 时 RSI=100。
 */
export function rsiWilder(closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(closes.length).fill(null);
  if (!Number.isInteger(period) || period < 2 || closes.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

export function rsiFromAverages(avgGain: number, avgLoss: number): number | null {
  if (avgLoss === 0 && avgGain === 0) return null;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** 从第二根开始的真实波幅。第一根没有前收盘价，返回 null。 */
export function trueRange(prevClose: number, high: number, low: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

export function trueRanges(bars: Array<Pick<Candle, "high" | "low" | "close">>): Array<number | null> {
  const out: Array<number | null> = Array(bars.length).fill(null);
  for (let i = 1; i < bars.length; i += 1) {
    out[i] = trueRange(bars[i - 1].close, bars[i].high, bars[i].low);
  }
  return out;
}

/**
 * Wilder ATR。前 period 个 TR 的算术平均是第一颗 ATR，位置在索引 period（第 period+1 根）。
 * 之后 ATR = (prev*(period-1)+TR)/period。不足 period+1 根则全为 null。
 */
export function atrWilder(bars: Array<Pick<Candle, "high" | "low" | "close">>, period: number): Array<number | null> {
  const out: Array<number | null> = Array(bars.length).fill(null);
  if (!Number.isInteger(period) || period < 1 || bars.length < period + 1) return out;
  const tr = trueRanges(bars);
  let sum = 0;
  for (let i = 1; i <= period; i += 1) sum += tr[i] ?? 0;
  let current = sum / period;
  out[period] = current;
  for (let i = period + 1; i < bars.length; i += 1) {
    current = (current * (period - 1) + (tr[i] ?? 0)) / period;
    out[i] = current;
  }
  return out;
}

/** ATR / 收盘价 * 100。收盘价为 0 或 ATR 不可用时返回 null。 */
export function atrPercent(atr: number | null, close: number): number | null {
  if (atr == null || !Number.isFinite(atr) || !Number.isFinite(close) || close === 0) return null;
  return (atr / close) * 100;
}

/**
 * 最近一根已收盘成交量 / 此前 lookback 根已收盘成交量的算术平均。
 * 当前根不进入平均。不足 lookback+1 根，或平均为 0，返回 null。
 */
export function volumeRatio(volumes: number[], lookback: number): number | null {
  if (!Number.isInteger(lookback) || lookback < 1 || volumes.length < lookback + 1) return null;
  const current = volumes[volumes.length - 1];
  const previous = volumes.slice(volumes.length - 1 - lookback, volumes.length - 1);
  if (previous.length !== lookback || !Number.isFinite(current)) return null;
  const average = previous.reduce((sum, value) => sum + value, 0) / lookback;
  if (average === 0 || !Number.isFinite(average)) return null;
  return current / average;
}

/** 总体标准差，分母为 n（ddof=0）。空数组返回 null。 */
export function populationStdev(values: number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 布林带(period, mult)。中轨为 SMA，σ 为总体标准差。
 * 带宽 = (上轨-下轨)/中轨，中轨为 0 时带宽为 null。
 * 不足 period 根时该点为 null。
 */
export function bollinger(closes: number[], period: number, mult: number): Array<BollingerPoint | null> {
  const out: Array<BollingerPoint | null> = Array(closes.length).fill(null);
  if (!Number.isInteger(period) || period < 2 || closes.length < period || !Number.isFinite(mult)) return out;
  for (let i = period - 1; i < closes.length; i += 1) {
    const window = closes.slice(i + 1 - period, i + 1);
    const middle = window.reduce((sum, value) => sum + value, 0) / period;
    const sigma = populationStdev(window) ?? 0;
    const upper = middle + mult * sigma;
    const lower = middle - mult * sigma;
    const bandwidth = middle === 0 ? null : (upper - lower) / middle;
    const close = closes[i];
    out[i] = {
      middle,
      upper,
      lower,
      bandwidth,
      outside: close > upper || close < lower,
    };
  }
  return out;
}

export function compareBandwidth(current: number | null, previous: number | null): BandwidthCompare {
  if (current == null || previous == null) return "unavailable";
  if (current < previous) return "narrower";
  if (current > previous) return "wider";
  return "same";
}

export function emaRelation(fast: number | null, slow: number | null): EmaRelation {
  if (fast == null || slow == null) return "unavailable";
  if (fast > slow) return "short_above";
  if (fast < slow) return "short_below";
  return "equal";
}

export function computeSnapshot(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const emaFast = ema(closes, INDICATORS.emaFast);
  const emaSlow = ema(closes, INDICATORS.emaSlow);
  const rsi = rsiWilder(closes, INDICATORS.rsi);
  const atrSeries = atrWilder(candles, INDICATORS.atr);
  const bands = bollinger(closes, INDICATORS.bbPeriod, INDICATORS.bbMult);
  const last = candles.length - 1;
  const ema20 = last >= 0 ? emaFast[last] : null;
  const ema60 = last >= 0 ? emaSlow[last] : null;
  const atr = last >= 0 ? atrSeries[last] : null;
  const close = last >= 0 ? closes[last] : null;
  const bb = last >= 0 ? bands[last] : null;
  const prev = last >= 1 ? bands[last - 1] : null;
  return {
    ema20,
    ema60,
    emaRelation: emaRelation(ema20, ema60),
    rsi: last >= 0 ? rsi[last] : null,
    atr,
    atrPct: close == null ? null : atrPercent(atr, close),
    volumeRatio: volumeRatio(volumes, INDICATORS.volumeLookback),
    bb,
    bandwidthPct: bb?.bandwidth == null ? null : bb.bandwidth * 100,
    bandwidthVsPrevious: compareBandwidth(bb?.bandwidth ?? null, prev?.bandwidth ?? null),
  };
}

export function seriesForChart(candles: Candle[]) {
  const closes = candles.map((candle) => candle.close);
  const emaFast = ema(closes, INDICATORS.emaFast);
  const emaSlow = ema(closes, INDICATORS.emaSlow);
  const rsi = rsiWilder(closes, INDICATORS.rsi);
  const bands = bollinger(closes, INDICATORS.bbPeriod, INDICATORS.bbMult);
  const points = candles.map((candle) => ({
    time: Math.floor(candle.openTime / 1000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
  const line = (values: Array<number | null>) =>
    values.flatMap((value, index) =>
      value == null ? [] : [{ time: Math.floor(candles[index].openTime / 1000), value }],
    );
  return {
    candles: points,
    ema20: line(emaFast),
    ema60: line(emaSlow),
    rsi: line(rsi),
    bbMiddle: bands.flatMap((point, index) =>
      point ? [{ time: Math.floor(candles[index].openTime / 1000), value: point.middle }] : [],
    ),
    bbUpper: bands.flatMap((point, index) =>
      point ? [{ time: Math.floor(candles[index].openTime / 1000), value: point.upper }] : [],
    ),
    bbLower: bands.flatMap((point, index) =>
      point ? [{ time: Math.floor(candles[index].openTime / 1000), value: point.lower }] : [],
    ),
  };
}

/** 只把 closeTime 早于 now 的 K 线交给指标。形成中的最后一根被排除。 */
export function indicatorsFromMarketCandles(candles: Candle[], now: number) {
  const closed = candles.filter((candle) => candle.closeTime < now);
  const formingExcluded = candles.length - closed.length;
  return { closed, formingExcluded, snapshot: computeSnapshot(closed), chart: seriesForChart(closed) };
}
