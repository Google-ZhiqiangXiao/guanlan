import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAlert, type IndicatorReading } from "@/lib/domain/alerts";
import { presentQuote } from "@/lib/domain/freshness";
import { openInterestChange, parseOpenInterestHist } from "@/lib/domain/oi";
import { normalizeSettings } from "@/lib/domain/settings";
import { findSymbol, perpetualEntries, spotEntries } from "@/lib/domain/symbols";
import { formatShanghai } from "@/lib/domain/time";
import type { AlertRule, WatchItem } from "@/lib/domain/types";
import { demoTicker } from "@/lib/demo/fixtures";
import { evaluateBindPolicy } from "@/lib/bind-policy.mjs";
import { addWatch, commitFire, insertRule, listEvents, listWatch, openDatabase, writeSettings, readSettings } from "@/lib/server/db";
import { createMarketService } from "@/lib/server/market";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "guanlan-"));
  dirs.push(dir);
  return openDatabase(join(dir, "app.sqlite"));
}

function rule(patch: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    symbol: "BTCUSDT",
    market: "spot",
    kind: "close_above",
    threshold: 100,
    enabled: true,
    cooldownSeconds: 300,
    klineInterval: "1h",
    lastFiredAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...patch,
  };
}

function reading(patch: Partial<IndicatorReading> = {}): IndicatorReading {
  return {
    freshness: "live",
    close: 100,
    closeTime: 1_700_000_000_000,
    rsi: 50,
    atrPct: 1,
    volumeRatio: 1,
    bbOutside: false,
    ...patch,
  };
}

describe("alert decisions", () => {
  it("fires on the boundary, then suppresses duplicates until cooldown elapses", () => {
    const now = 1_700_000_000_000;
    const first = evaluateAlert(rule(), reading(), now);
    expect(first.action).toBe("fire");
    if (first.action !== "fire") return;
    expect(first.message).toContain("不是买卖建议");
    const fired = rule({ lastFiredAt: new Date(now).toISOString() });
    expect(evaluateAlert(fired, reading(), now + 299_000).action).toBe("skip");
    expect(evaluateAlert(fired, reading(), now + 300_000).action).toBe("fire");
    expect(evaluateAlert(rule(), reading({ close: 99.99 })).action).toBe("skip");
  });

  it("does not fire on stale data, missing warmup, or a band that is merely narrower", () => {
    expect(evaluateAlert(rule(), reading({ freshness: "stale" }))).toEqual({ action: "skip", reason: "not_actionable" });
    expect(evaluateAlert(rule({ kind: "rsi_above", threshold: 70 }), reading({ rsi: null }))).toEqual({ action: "skip", reason: "no_data" });
    expect(evaluateAlert(rule({ kind: "bb_outside" }), reading({ bbOutside: false }))).toEqual({ action: "skip", reason: "condition_false" });
    expect(evaluateAlert(rule({ kind: "bb_outside" }), reading({ bbOutside: null }))).toEqual({ action: "skip", reason: "no_data" });
    expect(evaluateAlert(rule({ kind: "bb_outside" }), reading({ bbOutside: true })).action).toBe("fire");
    expect(evaluateAlert(rule(), reading({ freshness: "demo" })).action).toBe("fire");
  });

  it("keeps spot and perpetual rules apart and dedups inside the database", () => {
    const db = tempDb();
    const now = Date.parse("2024-01-15T00:00:00.000Z");
    const spot = insertRule(db, { symbol: "BTCUSDT", market: "spot", kind: "close_above", threshold: 1, enabled: true, cooldownSeconds: 300, klineInterval: "1h" }, new Date(now).toISOString());
    const perp = insertRule(db, { symbol: "BTCUSDT", market: "perpetual", kind: "close_above", threshold: 1, enabled: true, cooldownSeconds: 300, klineInterval: "1h" }, new Date(now).toISOString());
    expect(commitFire(db, spot, 10, "spot", "live", new Date(now).toISOString(), now)).toBe(true);
    expect(commitFire(db, spot, 10, "spot again", "live", new Date(now + 1000).toISOString(), now + 1000)).toBe(false);
    expect(commitFire(db, perp, 11, "perp", "live", new Date(now + 1000).toISOString(), now + 1000)).toBe(true);
    expect(listEvents(db, 10)).toHaveLength(2);
    db.close();
  });
});

describe("freshness", () => {
  const item: WatchItem = { id: 1, symbol: "BTCUSDT", market: "spot", baseAsset: "BTC", quoteAsset: "USDT", createdAt: "" };
  const ticker = { symbol: "BTCUSDT", lastPrice: "100.00", priceChangePercent: "1", quoteVolume: "5", highPrice: "1", lowPrice: "1", openPrice: "1", closeTime: 10 };

  it("never labels a failed refresh as live", () => {
    const stale = presentQuote(item, { upstreamOk: false, fromCache: true, value: ticker, fetchedAt: 1_000, error: "失败", status: 451 }, 2_000);
    expect(stale.freshness).toBe("stale");
    expect(stale.price).toBe("100.00");
    const hidden = presentQuote(item, { upstreamOk: false, fromCache: true, value: ticker, fetchedAt: 0, error: "失败", status: 451 }, 130_000);
    expect(hidden.freshness).toBe("unavailable");
    expect(hidden.price).toBeNull();
    const live = presentQuote(item, { upstreamOk: true, fromCache: false, value: ticker, fetchedAt: 1_000, error: null, status: 200 }, 2_000);
    expect(live.freshness).toBe("live");
  });
});

describe("open interest change", () => {
  it("calculates only from two real samples", () => {
    expect(openInterestChange([{ value: 10, time: 1 }]).status).toBe("insufficient");
    expect(parseOpenInterestHist({ code: 0, msg: "no" })).toBeNull();
    const parsed = parseOpenInterestHist([
      { sumOpenInterest: "100.5", timestamp: 10 },
      { sumOpenInterest: "110.5", timestamp: 20 },
    ]);
    const change = openInterestChange(parsed ?? []);
    expect(change).toMatchObject({ status: "ok", previous: 100.5, latest: 110.5, change: 10 });
    expect(openInterestChange([{ value: 0, time: 1 }, { value: 2, time: 2 }])).toMatchObject({ status: "ok", changePct: null });
  });
});

describe("symbols and settings", () => {
  it("keeps the same symbol distinct across spot and perpetual", () => {
    const spot = spotEntries({
      symbols: [
        { symbol: "BTCUSDT", status: "TRADING", quoteAsset: "USDT", baseAsset: "BTC", isSpotTradingAllowed: true },
        { symbol: "BTCUSDT", status: "TRADING", quoteAsset: "BTC", baseAsset: "ETH", isSpotTradingAllowed: true },
        { symbol: "ETHUSDT", status: "BREAK", quoteAsset: "USDT", baseAsset: "ETH", isSpotTradingAllowed: true },
      ],
    });
    const perp = perpetualEntries({
      symbols: [
        { symbol: "BTCUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT", marginAsset: "USDT", baseAsset: "BTC" },
        { symbol: "BTCUSDT_240329", status: "TRADING", contractType: "CURRENT_QUARTER", quoteAsset: "USDT", marginAsset: "USDT", baseAsset: "BTC" },
      ],
    });
    expect(spot.map((item) => item.symbol)).toEqual(["BTCUSDT"]);
    expect(perp.map((item) => `${item.market}:${item.symbol}`)).toEqual(["perpetual:BTCUSDT"]);
    expect(findSymbol(spot, "BTCUSDT", "spot")?.market).toBe("spot");
    expect(findSymbol(perp, "BTCUSDT", "spot")).toBeNull();
  });

  it("rejects an unknown data mode", () => {
    expect(normalizeSettings({ dataMode: "synthetic" }).ok).toBe(false);
    expect(normalizeSettings({ refreshSeconds: 15, klineInterval: "1h" }).ok).toBe(true);
  });
});

describe("persistence", () => {
  it("keeps both markets after the database is reopened", () => {
    const dir = mkdtempSync(join(tmpdir(), "guanlan-"));
    dirs.push(dir);
    const filename = join(dir, "app.sqlite");
    const first = openDatabase(filename);
    addWatch(first, { symbol: "BTCUSDT", market: "spot", baseAsset: "BTC", quoteAsset: "USDT" }, "2024-01-01T00:00:00.000Z");
    addWatch(first, { symbol: "BTCUSDT", market: "perpetual", baseAsset: "BTC", quoteAsset: "USDT" }, "2024-01-01T00:00:01.000Z");
    writeSettings(first, { dataMode: "demo", refreshSeconds: 20, klineInterval: "4h", defaultCooldownSeconds: 120 });
    const removedRules = insertRule(first, { symbol: "BTCUSDT", market: "spot", kind: "atr_pct_above", threshold: 2, enabled: true, cooldownSeconds: 60, klineInterval: "1h" }, "2024-01-01T00:00:02.000Z");
    expect(removedRules.market).toBe("spot");
    first.close();
    const second = openDatabase(filename);
    const items = listWatch(second);
    expect(items.map((item) => item.market).sort()).toEqual(["perpetual", "spot"]);
    expect(readSettings(second).dataMode).toBe("demo");
    second.close();
  });
});

describe("market outage", () => {
  it("shows a 451 as unavailable and does not call the exchange in demo mode", async () => {
    let calls = 0;
    const blocked = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          code: 0,
          msg: "Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms. Please contact customer service if you believe you received this message in error.",
        }),
        { status: 451, headers: { "content-type": "application/json" } },
      );
    };
    let now = 1_700_000_000_000;
    const blockedService = createMarketService({ fetchFn: blocked, now: () => now });
    const item: WatchItem = { id: 7, symbol: "BTCUSDT", market: "spot", baseAsset: "BTC", quoteAsset: "USDT", createdAt: "" };
    const failed = await blockedService.market.quotes([item], "live");
    expect(failed[0].freshness).toBe("unavailable");
    expect(failed[0].price).toBeNull();
    expect(failed[0].error).toContain("451");
    expect(calls).toBe(1);

    calls = 0;
    const demo = createMarketService({
      fetchFn: async () => {
        calls += 1;
        throw new Error("demo must not fetch");
      },
      now: () => now,
    });
    const both = await demo.market.quotes(
      [item, { ...item, id: 8, market: "perpetual" }],
      "demo",
    );
    expect(calls).toBe(0);
    expect(both[0].freshness).toBe("demo");
    expect(both[1].freshness).toBe("demo");
    expect(both[0].price).toBe(demoTicker("BTCUSDT", "spot")?.lastPrice);
    expect(both[1].price).toBe(demoTicker("BTCUSDT", "perpetual")?.lastPrice);
    expect(both[0].price).not.toBe(both[1].price);
    now += 1;
  });

  it("turns a failed refresh of a recent price into stale, not live", async () => {
    let phase: "ok" | "down" = "ok";
    let now = 5_000_000;
    const fetchFn = async () => {
      if (phase === "ok") {
        return new Response(JSON.stringify({ symbol: "ETHUSDT", lastPrice: "4000.00", priceChangePercent: "-0.4", quoteVolume: "9", highPrice: "1", lowPrice: "1", openPrice: "1", closeTime: now }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: -1000, msg: "down" }), { status: 500 });
    };
    const { market } = createMarketService({ fetchFn, now: () => now });
    const item: WatchItem = { id: 3, symbol: "ETHUSDT", market: "perpetual", baseAsset: "ETH", quoteAsset: "USDT", createdAt: "" };
    expect((await market.quotes([item], "live"))[0].freshness).toBe("live");
    phase = "down";
    now += 11_000;
    const stale = (await market.quotes([item], "live"))[0];
    expect(stale.freshness).toBe("stale");
    expect(stale.price).toBe("4000.00");
    now += 130_000;
    const hidden = (await market.quotes([item], "live"))[0];
    expect(hidden.freshness).toBe("unavailable");
    expect(hidden.price).toBeNull();
  });
});

describe("clock and bind policy", () => {
  it("formats Asia/Shanghai and refuses a public bind without a token", () => {
    expect(formatShanghai(Date.parse("2024-01-15T01:30:00.000Z"))).toBe("2024-01-15 09:30:00（上海）");
    expect(evaluateBindPolicy("127.0.0.1", "").ok).toBe(true);
    expect(evaluateBindPolicy("0.0.0.0", "short").ok).toBe(false);
    expect(evaluateBindPolicy("0.0.0.0", "1234567890abcdef").ok).toBe(true);
  });
});
