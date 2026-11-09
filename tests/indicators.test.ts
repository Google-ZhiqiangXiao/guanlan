import { describe, expect, it } from "vitest";
import { atrPercent, atrWilder, bollinger, ema, indicatorsFromMarketCandles, populationStdev, rsiFromAverages, rsiWilder, trueRange, volumeRatio } from "@/lib/domain/indicators";
import type { Candle } from "@/lib/domain/types";

function candle(close: number, extra?: Partial<Candle>): Candle {
  return {
    openTime: extra?.openTime ?? 0,
    closeTime: extra?.closeTime ?? 1,
    open: extra?.open ?? close,
    high: extra?.high ?? close,
    low: extra?.low ?? close,
    close,
    volume: extra?.volume ?? 1,
  };
}

describe("EMA", () => {
  it("uses an SMA seed and the standard smoothing constant", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("stays unavailable before the period is filled", () => {
    const values = ema(Array.from({ length: 59 }, () => 10), 60);
    expect(values.every((value) => value == null)).toBe(true);
    expect(ema(Array.from({ length: 60 }, () => 10), 60)[59]).toBe(10);
  });
});

describe("Wilder RSI", () => {
  it("smooths after the simple-average seed", () => {
    const values = rsiWilder([10, 11, 10, 12, 11], 3);
    expect(values[3]).toBe(75);
    expect(values[4]).toBeCloseTo(600 / 11, 8);
    expect(values.slice(0, 3)).toEqual([null, null, null]);
  });

  it("returns null for a zero-over-zero seed and 100 when there is no loss", () => {
    expect(rsiFromAverages(0, 0)).toBeNull();
    expect(rsiFromAverages(1, 0)).toBe(100);
    const flat = rsiWilder(Array.from({ length: 15 }, () => 20), 14);
    expect(flat[14]).toBeNull();
    const rising = rsiWilder(Array.from({ length: 15 }, (_, index) => index + 1), 14);
    expect(rising[14]).toBe(100);
    expect(rsiWilder(Array.from({ length: 14 }, () => 1), 14).every((value) => value == null)).toBe(true);
  });
});

describe("Wilder ATR", () => {
  it("uses the largest true-range component and then Wilder smoothing", () => {
    expect(trueRange(10, 14, 13)).toBe(4);
    expect(trueRange(10, 11, 9.5)).toBe(1.5);
    const bars = [
      candle(9, { high: 10, low: 8 }),
      candle(11, { high: 12, low: 9 }),
      candle(8, { high: 11, low: 7 }),
      candle(9.5, { high: 10, low: 9 }),
    ];
    expect(trueRange(9, 12, 9)).toBe(3);
    expect(trueRange(11, 11, 7)).toBe(4);
    const values = atrWilder(bars, 2);
    expect(values[0]).toBeNull();
    expect(values[1]).toBeNull();
    expect(values[2]).toBeCloseTo(3.5, 8);
    expect(values[3]).toBeCloseTo(2.75, 8);
  });

  it("needs period plus one bars and rejects a zero close for ATR percent", () => {
    expect(atrWilder(Array.from({ length: 14 }, () => candle(1)), 14).every((value) => value == null)).toBe(true);
    expect(atrPercent(null, 10)).toBeNull();
    expect(atrPercent(2, 0)).toBeNull();
    expect(atrPercent(2, 50)).toBe(4);
  });
});

describe("volume ratio", () => {
  it("divides the latest closed bar by the previous 20 and excludes itself", () => {
    const volumes = [...Array.from({ length: 20 }, (_, index) => index + 1), 100];
    expect(volumeRatio(volumes, 20)).toBeCloseTo(100 / 10.5, 8);
    expect(volumeRatio(Array.from({ length: 20 }, () => 1), 20)).toBeNull();
    expect(volumeRatio([...Array.from({ length: 20 }, () => 0), 5], 20)).toBeNull();
  });
});

describe("Bollinger Bands", () => {
  it("uses population standard deviation and a zero band on a constant series", () => {
    const constant = bollinger(Array.from({ length: 20 }, () => 5), 20, 2);
    expect(constant[19]).toEqual({ middle: 5, upper: 5, lower: 5, bandwidth: 0, outside: false });
    expect(populationStdev(Array.from({ length: 20 }, () => 5))).toBe(0);
  });

  it("matches the 20-point formula and flags a close outside the band", () => {
    const closes = [...Array.from({ length: 19 }, () => 10), 30];
    const point = bollinger(closes, 20, 2)[19];
    const sigma = Math.sqrt(19);
    expect(point?.middle).toBe(11);
    expect(point?.upper).toBeCloseTo(11 + 2 * sigma, 8);
    expect(point?.lower).toBeCloseTo(11 - 2 * sigma, 8);
    expect(point?.bandwidth).toBeCloseTo((4 * sigma) / 11, 8);
    expect(point?.outside).toBe(true);
  });

  it("returns unavailable bandwidth when the middle is zero and when warmup is short", () => {
    const zeros = bollinger([...Array.from({ length: 10 }, () => 1), ...Array.from({ length: 10 }, () => -1)], 20, 2)[19];
    expect(zeros?.middle).toBe(0);
    expect(zeros?.bandwidth).toBeNull();
    expect(zeros?.outside).toBe(false);
    expect(bollinger(Array.from({ length: 19 }, () => 3), 20, 2).every((point) => point == null)).toBe(true);
  });
});

describe("closed candles only", () => {
  it("ignores a forming candle when computing indicators", () => {
    const closed = Array.from({ length: 80 }, (_, index) =>
      candle(100, { openTime: index * 1000, closeTime: index * 1000 + 999, high: 101, low: 99, volume: 10 }),
    );
    const forming = candle(1000, { openTime: 80_000, closeTime: 90_000, high: 1100, low: 900, volume: 9999 });
    const now = 80_500;
    const withForming = indicatorsFromMarketCandles([...closed, forming], now);
    const without = indicatorsFromMarketCandles(closed, now);
    expect(withForming.formingExcluded).toBe(1);
    expect(withForming.snapshot).toEqual(without.snapshot);
    expect(withForming.snapshot.volumeRatio).not.toBeNull();
  });
});
