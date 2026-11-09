import {
  CATALOG_CACHE_MS,
  CATALOG_STALE_MAX_MS,
  DERIV_CACHE_MS,
  KLINE_CACHE_MS,
  KLINE_LIMIT,
  TICKER_CACHE_MS,
} from "@/lib/domain/constants";
import { demoCandles, demoCatalog, demoDerivatives, demoSeries, demoTicker, DEMO_AS_OF_MS } from "@/lib/demo/fixtures";
import { presentQuote, type Reading } from "@/lib/domain/freshness";
import { indicatorsFromMarketCandles } from "@/lib/domain/indicators";
import { openInterestChange, parseOpenInterestHist } from "@/lib/domain/oi";
import {
  futuresKlineWeight,
  parseFundingHistory,
  parseKlines,
  parseOpenInterest,
  parsePremium,
  parseTickerList,
  spotTickerWeight,
} from "@/lib/domain/parse";
import { findSymbol, perpetualEntries, searchSymbols, spotEntries } from "@/lib/domain/symbols";
import type { Candle, DataMode, Freshness, Interval, Market, QuoteSnapshot, SymbolInfo, Ticker, WatchItem } from "@/lib/domain/types";
import { formatShanghai } from "@/lib/domain/time";
import { BinanceClient } from "./binance";
import { CountWindow, WeightBudget } from "./budget";

type Entry<T> = { value: T; fetchedAt: number };

export class MarketService {
  private cache = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private fundingWindow = new CountWindow(30, 5 * 60_000);
  private oiHistWindow = new CountWindow(30, 5 * 60_000);
  private lastProbeAt: Record<Market, number> = { spot: 0, perpetual: 0 };

  constructor(
    private client: BinanceClient,
    private now: () => number,
  ) {}

  get size() {
    return this.cache.size;
  }

  private getCache<T>(key: string): Entry<T> | null {
    const hit = this.cache.get(key);
    return hit ? (hit as Entry<T>) : null;
  }

  private setCache<T>(key: string, value: T, fetchedAt: number) {
    this.cache.set(key, { value, fetchedAt });
  }

  async probe(market: Market) {
    const now = this.now();
    const budget = this.client.budget(market);
    if (now - this.lastProbeAt[market] < 30_000) return;
    if (budget.backoffUntil > now) return;
    this.lastProbeAt[market] = now;
    const path = market === "spot" ? "/api/v3/ping" : "/fapi/v1/ping";
    await this.client.getJson(market, path, {}, 1);
  }

  async quotes(items: WatchItem[], mode: DataMode): Promise<QuoteSnapshot[]> {
    if (mode === "demo") {
      return items.map((item) => this.demoQuote(item));
    }
    const spotSymbols = items.filter((item) => item.market === "spot").map((item) => item.symbol);
    const perpSymbols = items.filter((item) => item.market === "perpetual").map((item) => item.symbol);
    const [spot, perp] = await Promise.all([
      this.getTickers("spot", spotSymbols),
      this.getTickers("perpetual", perpSymbols),
    ]);
    const now = this.now();
    return items.map((item) => {
      const map = item.market === "spot" ? spot : perp;
      return presentQuote(item, map.get(item.symbol) ?? null, now);
    });
  }

  private demoQuote(item: WatchItem): QuoteSnapshot {
    const ticker = demoTicker(item.symbol, item.market);
    if (!ticker) {
      return {
        ...presentQuote(item, null, this.now()),
        freshness: "demo",
        source: "demo",
        price: null,
        error: "示例清单中没有这个交易对，没有用虚构价格填补。",
        warning: null,
        note: "示例模式",
        fetchedAt: null,
        ageMs: null,
      };
    }
    return {
      ...presentQuote(
        item,
        { upstreamOk: true, fromCache: false, value: ticker, fetchedAt: DEMO_AS_OF_MS, error: null, status: 200 },
        DEMO_AS_OF_MS,
      ),
      freshness: "demo",
      source: "demo",
      note: `内置示例快照，时间固定为 ${formatShanghai(DEMO_AS_OF_MS)}，与当前时刻无关。`,
      warning: null,
      error: null,
    };
  }

  private async getTickers(market: Market, symbols: string[]): Promise<Map<string, Reading<Ticker>>> {
    const out = new Map<string, Reading<Ticker>>();
    const needed: string[] = [];
    const now = this.now();
    for (const symbol of symbols) {
      const cached = this.getCache<Ticker>(`ticker:${market}:${symbol}`);
      if (cached && now - cached.fetchedAt < TICKER_CACHE_MS) {
        out.set(symbol, {
          upstreamOk: true,
          fromCache: true,
          value: cached.value,
          fetchedAt: cached.fetchedAt,
          error: null,
          status: 200,
        });
      } else {
        needed.push(symbol);
      }
    }
    if (!needed.length) return out;
    if (market === "spot") {
      for (let i = 0; i < needed.length; i += 20) {
        const group = needed.slice(i, i + 20);
        const result = await this.client.getJson(
          "spot",
          "/api/v3/ticker/24hr",
          { type: "FULL", symbols: JSON.stringify(group) },
          spotTickerWeight(group.length),
        );
        this.applyTickers(out, market, group, result);
      }
    } else {
      await mapPool(needed, 2, async (symbol) => {
        const result = await this.client.getJson("perpetual", "/fapi/v1/ticker/24hr", { symbol }, 1);
        this.applyTickers(out, market, [symbol], result);
      });
    }
    return out;
  }

  private applyTickers(
    out: Map<string, Reading<Ticker>>,
    market: Market,
    group: string[],
    result: Awaited<ReturnType<BinanceClient["getJson"]>>,
  ) {
    const now = this.now();
    if (!result.ok) {
      for (const symbol of group) {
        const old = this.getCache<Ticker>(`ticker:${market}:${symbol}`);
        out.set(symbol, {
          upstreamOk: false,
          fromCache: Boolean(old),
          value: old?.value ?? null,
          fetchedAt: old?.fetchedAt ?? null,
          error: result.error,
          status: result.status,
        });
      }
      return;
    }
    const parsed = new Map(parseTickerList(result.data).map((ticker) => [ticker.symbol, ticker]));
    for (const symbol of group) {
      const ticker = parsed.get(symbol);
      if (!ticker) {
        const old = this.getCache<Ticker>(`ticker:${market}:${symbol}`);
        out.set(symbol, {
          upstreamOk: false,
          fromCache: Boolean(old),
          value: old?.value ?? null,
          fetchedAt: old?.fetchedAt ?? null,
          error: "交易所没有返回该交易对的有效行情",
          status: result.status,
        });
        continue;
      }
      this.setCache(`ticker:${market}:${symbol}`, ticker, now);
      out.set(symbol, { upstreamOk: true, fromCache: false, value: ticker, fetchedAt: now, error: null, status: result.status });
    }
  }

  async search(query: string, market: Market | "all", mode: DataMode, limit: number) {
    if (mode === "demo") {
      return {
        freshness: "demo" as const,
        error: null,
        warning: "示例清单，不是交易所当前可交易列表。",
        items: searchSymbols(demoCatalog(), query, market, limit),
      };
    }
    const markets: Market[] = market === "all" ? ["spot", "perpetual"] : [market];
    const collected: SymbolInfo[] = [];
    let freshness: Freshness = "live";
    let error: string | null = null;
    let warning: string | null = null;
    for (const item of markets) {
      const catalog = await this.catalog(item);
      if (catalog.freshness === "unavailable") {
        error = catalog.error;
        freshness = "unavailable";
        continue;
      }
      if (catalog.freshness === "stale") {
        freshness = freshness === "unavailable" ? "unavailable" : "stale";
        warning = "交易对清单不是刚刚更新的。";
      }
      collected.push(...catalog.items);
    }
    return {
      freshness,
      error: collected.length ? null : error,
      warning,
      items: searchSymbols(collected, query, market, limit),
    };
  }

  async resolve(symbol: string, market: Market, mode: DataMode): Promise<{ ok: true; info: SymbolInfo } | { ok: false; error: string }> {
    if (mode === "demo") {
      const info = findSymbol(demoCatalog(), symbol, market);
      return info ? { ok: true, info } : { ok: false, error: "示例清单中没有这个交易对" };
    }
    const catalog = await this.catalog(market);
    if (catalog.freshness === "unavailable") {
      return { ok: false, error: catalog.error ?? "交易对清单暂不可用，无法确认该品种，已拒绝加入" };
    }
    const info = findSymbol(catalog.items, symbol, market);
    if (!info) return { ok: false, error: "交易对不在当前市场的可交易清单中" };
    return { ok: true, info };
  }

  private async catalog(market: Market): Promise<{ freshness: Freshness; items: SymbolInfo[]; error: string | null }> {
    const key = `catalog:${market}`;
    const cached = this.getCache<SymbolInfo[]>(key);
    const now = this.now();
    if (cached && now - cached.fetchedAt < CATALOG_CACHE_MS) {
      return { freshness: "live", items: cached.value, error: null };
    }
    const result =
      market === "spot"
        ? await this.client.getJson("spot", "/api/v3/exchangeInfo", {}, 20)
        : await this.client.getJson("perpetual", "/fapi/v1/exchangeInfo", {}, 1);
    if (!result.ok) {
      if (cached && now - cached.fetchedAt <= CATALOG_STALE_MAX_MS) {
        return { freshness: "stale", items: cached.value, error: result.error };
      }
      return { freshness: "unavailable", items: [], error: result.error };
    }
    const items = market === "spot" ? spotEntries(result.data) : perpetualEntries(result.data);
    this.setCache(key, items, now);
    return { freshness: "live", items, error: null };
  }

  async series(symbol: string, market: Market, interval: Interval, mode: DataMode, limit = KLINE_LIMIT) {
    if (mode === "demo") {
      const demo = demoSeries(symbol, market, interval, limit);
      if (!demo) {
        return { freshness: "demo" as const, error: "示例清单中没有这个交易对", warning: null, formingExcluded: 0, fetchedAt: null, candles: [], chart: null, snapshot: null };
      }
      return {
        freshness: "demo" as const,
        error: null,
        warning: null,
        note: "示例 K 线，全部视为已收盘，不是交易所实时数据。",
        formingExcluded: 0,
        fetchedAt: DEMO_AS_OF_MS,
        candles: demo.candles,
        chart: demo.chart,
        snapshot: demo.snapshot,
        lastCloseTime: demo.candles.at(-1)?.closeTime ?? null,
        lastClose: demo.candles.at(-1)?.close ?? null,
      };
    }
    const reading = await this.klines(symbol, market, interval, limit);
    const now = this.now();
    const payload = reading.value;
    const has = Boolean(payload && reading.fetchedAt != null);
    let freshness: Freshness = "unavailable";
    if (has && reading.fetchedAt != null) {
      const age = now - reading.fetchedAt;
      if (!reading.upstreamOk) freshness = age <= 120_000 ? "stale" : "unavailable";
      else if (age <= 15_000) freshness = "live";
      else if (age <= 180_000) freshness = "stale";
    }
    if (freshness === "unavailable" || !payload) {
      return {
        freshness,
        error: reading.error ?? "K 线不可用",
        warning: payload ? "K 线已超过可展示窗口，旧图已隐藏。" : null,
        formingExcluded: 0,
        fetchedAt: null,
        candles: [],
        chart: null,
        snapshot: null,
        lastCloseTime: null,
        lastClose: null,
      };
    }
    const age = reading.fetchedAt == null ? Number.POSITIVE_INFINITY : now - reading.fetchedAt;
    if (!reading.upstreamOk) freshness = age <= 120_000 ? "stale" : "unavailable";
    else freshness = age <= 20_000 ? "live" : age <= 180_000 ? "stale" : "unavailable";
    const view = indicatorsFromMarketCandles(payload, now);
    return {
      freshness,
      error: reading.upstreamOk ? null : reading.error,
      warning: freshness === "stale" ? "K 线刷新失败或已过期。图上是上次成功读取且已收盘的数据，不是实时行情。" : null,
      formingExcluded: view.formingExcluded,
      fetchedAt: reading.fetchedAt,
      candles: view.closed,
      chart: view.chart,
      snapshot: view.snapshot,
      lastCloseTime: view.closed.at(-1)?.closeTime ?? null,
      lastClose: view.closed.at(-1)?.close ?? null,
    };
  }

  private async klines(symbol: string, market: Market, interval: Interval, limit: number): Promise<Reading<Candle[]>> {
    const key = `klines:${market}:${symbol}:${interval}:${limit}`;
    const cached = this.getCache<Candle[]>(key);
    const now = this.now();
    if (cached && now - cached.fetchedAt < KLINE_CACHE_MS) {
      return { upstreamOk: true, fromCache: true, value: cached.value, fetchedAt: cached.fetchedAt, error: null, status: 200 };
    }
    const weight = market === "spot" ? 2 : futuresKlineWeight(limit);
    const path = market === "spot" ? "/api/v3/klines" : "/fapi/v1/klines";
    const result = await this.client.getJson(market, path, { symbol, interval, limit: String(limit) }, weight);
    if (!result.ok) {
      return {
        upstreamOk: false,
        fromCache: Boolean(cached),
        value: cached?.value ?? null,
        fetchedAt: cached?.fetchedAt ?? null,
        error: result.error,
        status: result.status,
      };
    }
    const candles = parseKlines(result.data);
    if (!candles) {
      return {
        upstreamOk: false,
        fromCache: Boolean(cached),
        value: cached?.value ?? null,
        fetchedAt: cached?.fetchedAt ?? null,
        error: "K 线数据无法解析",
        status: result.status,
      };
    }
    this.setCache(key, candles, now);
    return { upstreamOk: true, fromCache: false, value: candles, fetchedAt: now, error: null, status: result.status };
  }

  async derivatives(symbol: string, market: Market, mode: DataMode) {
    if (market !== "perpetual") {
      return { ok: false as const, error: "现货没有资金费率和持仓量" };
    }
    if (mode === "demo") {
      const demo = demoDerivatives(symbol);
      if (!demo) return { ok: false as const, error: "示例清单中没有这个永续合约" };
      return {
        ok: true as const,
        freshness: "demo" as const,
        note: "示例资金费率与持仓量，不是交易所实时数据。持仓量变化来自示例清单里写明的两根样本。",
        markPrice: demo.markPrice,
        indexPrice: demo.indexPrice,
        lastFundingRate: demo.lastFundingRate,
        nextFundingTime: demo.nextFundingTime,
        openInterest: demo.openInterest,
        openInterestTime: demo.openInterestTime,
        oiChange: demo.change,
        fundingHistory: demo.fundingHistory,
        errors: { premium: null, openInterest: null, funding: null, oiHist: null },
      };
    }
    const now = this.now();
    const [premium, oi, funding, hist] = await Promise.all([
      this.cachedDeriv("premium", symbol, "/fapi/v1/premiumIndex", { symbol }, 1, DERIV_CACHE_MS, parsePremium),
      this.cachedDeriv("oi", symbol, "/fapi/v1/openInterest", { symbol }, 1, DERIV_CACHE_MS, parseOpenInterest),
      this.fundingHistory(symbol),
      this.oiHistory(symbol),
    ]);
    const premiumFresh = this.derivFreshness(premium, now);
    const oiFresh = this.derivFreshness(oi, now);
    const showPremium = premiumFresh === "live" || premiumFresh === "stale";
    const showOi = oiFresh === "live" || oiFresh === "stale";
    return {
      ok: true as const,
      freshness: worst(premiumFresh, oiFresh),
      note: null,
      markPrice: showPremium ? (premium.value?.markPrice ?? null) : null,
      indexPrice: showPremium ? (premium.value?.indexPrice ?? null) : null,
      lastFundingRate: showPremium ? (premium.value?.lastFundingRate ?? null) : null,
      nextFundingTime: showPremium ? (premium.value?.nextFundingTime ?? null) : null,
      premiumFetchedAt: showPremium ? premium.fetchedAt : null,
      premiumFreshness: premiumFresh,
      openInterest: showOi ? (oi.value?.openInterest ?? null) : null,
      openInterestTime: showOi ? (oi.value?.time ?? null) : null,
      oiFreshness: oiFresh,
      oiChange: hist.change,
      fundingHistory: funding.value ?? [],
      fundingFreshness: funding.freshness,
      errors: {
        premium: premiumFresh === "live" ? null : premium.error,
        openInterest: oiFresh === "live" ? null : oi.error,
        funding: funding.error,
        oiHist: hist.error,
      },
    };
  }

  private derivFreshness<T>(reading: Reading<T>, now: number): Freshness {
    if (!reading.value || reading.fetchedAt == null) return "unavailable";
    const age = now - reading.fetchedAt;
    if (!reading.upstreamOk) return age <= 120_000 ? "stale" : "unavailable";
    if (age <= 20_000) return "live";
    if (age <= 120_000) return "stale";
    return "unavailable";
  }

  private async cachedDeriv<T>(
    name: string,
    symbol: string,
    path: string,
    query: Record<string, string>,
    weight: number,
    ttl: number,
    parse: (body: unknown) => T | null,
  ): Promise<Reading<T>> {
    const key = `${name}:${symbol}`;
    const cached = this.getCache<T>(key);
    const now = this.now();
    if (cached && now - cached.fetchedAt < ttl) {
      return { upstreamOk: true, fromCache: true, value: cached.value, fetchedAt: cached.fetchedAt, error: null, status: 200 };
    }
    const result = await this.client.getJson("perpetual", path, query, weight);
    if (!result.ok) {
      return { upstreamOk: false, fromCache: Boolean(cached), value: cached?.value ?? null, fetchedAt: cached?.fetchedAt ?? null, error: result.error, status: result.status };
    }
    const parsed = parse(result.data);
    if (!parsed) {
      return { upstreamOk: false, fromCache: Boolean(cached), value: cached?.value ?? null, fetchedAt: cached?.fetchedAt ?? null, error: "响应无法解析", status: result.status };
    }
    this.setCache(key, parsed, now);
    return { upstreamOk: true, fromCache: false, value: parsed, fetchedAt: now, error: null, status: result.status };
  }

  private async fundingHistory(symbol: string) {
    const key = `funding:${symbol}`;
    const cached = this.getCache<Array<{ fundingRate: string; fundingTime: number }>>(key);
    const now = this.now();
    if (cached && now - cached.fetchedAt < DERIV_CACHE_MS) {
      return { value: cached.value, freshness: "live" as const, error: null };
    }
    if (!this.fundingWindow.tryTake(now)) {
      return { value: cached?.value ?? [], freshness: cached ? ("stale" as const) : ("unavailable" as const), error: "资金费率历史的本地次数预算已用尽" };
    }
    const result = await this.client.getJson("perpetual", "/fapi/v1/fundingRate", { symbol, limit: "8" }, 1);
    if (!result.ok) {
      return { value: cached?.value ?? [], freshness: cached ? ("stale" as const) : ("unavailable" as const), error: result.error };
    }
    const parsed = parseFundingHistory(result.data);
    if (!parsed) return { value: cached?.value ?? [], freshness: "unavailable" as const, error: "资金费率历史无法解析" };
    this.setCache(key, parsed, now);
    return { value: parsed, freshness: "live" as const, error: null };
  }

  private async oiHistory(symbol: string): Promise<{ change: ReturnType<typeof openInterestChange>; error: string | null }> {
    const key = `oihist:${symbol}`;
    const cached = this.getCache<ReturnType<typeof parseOpenInterestHist>>(key);
    const now = this.now();
    if (cached && now - cached.fetchedAt < DERIV_CACHE_MS && cached.value) {
      return { change: openInterestChange(cached.value), error: null };
    }
    if (!this.oiHistWindow.tryTake(now)) {
      return {
        change: cached?.value ? openInterestChange(cached.value) : { status: "insufficient", reason: "持仓量历史的本地次数预算已用尽，没有伪造变化。" },
        error: "持仓量历史的本地次数预算已用尽",
      };
    }
    const result = await this.client.getJson("perpetual", "/futures/data/openInterestHist", { symbol, period: "1h", limit: "2" }, 1);
    if (!result.ok) {
      return {
        change: { status: "insufficient", reason: "持仓量历史没有拿到可验证样本，变化标为不足。" },
        error: result.error,
      };
    }
    const parsed = parseOpenInterestHist(result.data);
    if (!parsed) {
      return { change: { status: "insufficient", reason: "持仓量历史无法解析，没有伪造变化。" }, error: "持仓量历史无法解析" };
    }
    this.setCache(key, parsed, now);
    return { change: openInterestChange(parsed), error: parsed.length < 2 ? "持仓量历史样本少于 2 根" : null };
  }
}

function worst(a: Freshness, b: Freshness): Freshness {
  const rank: Record<Freshness, number> = { unavailable: 0, stale: 1, demo: 2, live: 3 };
  return rank[a] <= rank[b] ? a : b;
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export function createMarketService(options: { fetchFn?: typeof fetch; now?: () => number; spotBudget?: WeightBudget; futuresBudget?: WeightBudget }) {
  const now = options.now ?? (() => Date.now());
  const spotBudget = options.spotBudget ?? new WeightBudget(1200, 60_000, now);
  const futuresBudget = options.futuresBudget ?? new WeightBudget(1200, 60_000, now);
  const client = new BinanceClient(options.fetchFn ?? fetch, { spot: spotBudget, perpetual: futuresBudget }, now);
  return { market: new MarketService(client, now), spotBudget, futuresBudget, client };
}

export { demoCandles };
