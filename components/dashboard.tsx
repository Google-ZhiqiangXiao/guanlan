"use client";

import { useEffect, useState } from "react";
import { INTERVALS, INTERVAL_LABEL } from "@/lib/domain/constants";
import type { BandwidthCompare, EmaRelation, Freshness, Interval, Market, QuoteSnapshot, Settings } from "@/lib/domain/types";
import { formatShanghai } from "@/lib/domain/time";
import { api } from "@/lib/client/api";
import { Badge, Button, Dialog, Input } from "./ui";
import { ChartPanel } from "./chart-panel";

type Health = {
  serverNowLabel: string;
  dataMode: "live" | "demo";
  venues: {
    spot: Venue;
    perpetual: Venue;
  };
};
type Venue = { restricted: boolean; lastError: string | null; lastSuccessAt: number | null; lastStatus: number | null; usedWeight: number; weightLimit: number };
type Series = {
  freshness: Freshness;
  error: string | null;
  warning: string | null;
  note?: string | null;
  formingExcluded: number;
  chart: null | {
    candles: Array<{ time: number; open: number; high: number; low: number; close: number }>;
    ema20: Array<{ time: number; value: number }>;
    ema60: Array<{ time: number; value: number }>;
    bbUpper: Array<{ time: number; value: number }>;
    bbMiddle: Array<{ time: number; value: number }>;
    bbLower: Array<{ time: number; value: number }>;
  };
  snapshot: null | {
    ema20: number | null;
    ema60: number | null;
    emaRelation: EmaRelation;
    rsi: number | null;
    atr: number | null;
    atrPct: number | null;
    volumeRatio: number | null;
    bandwidthPct: number | null;
    bandwidthVsPrevious: BandwidthCompare;
    bb: { middle: number; upper: number; lower: number; outside: boolean } | null;
  };
};
type SymbolHit = { symbol: string; market: Market; baseAsset: string };
type Derivatives = {
  freshness: Freshness;
  note: string | null;
  markPrice: string | null;
  indexPrice: string | null;
  lastFundingRate: string | null;
  nextFundingTime: number | null;
  openInterest: string | null;
  oiChange: { status: "ok"; change: number; changePct: number | null; previous: number; latest: number } | { status: "insufficient"; reason: string };
  errors: { premium: string | null; openInterest: string | null; oiHist: string | null };
};

const relationText: Record<EmaRelation, string> = {
  short_above: "EMA20 在 EMA60 之上。这只说明两条均线的位置。",
  short_below: "EMA20 在 EMA60 之下。这只说明两条均线的位置。",
  equal: "EMA20 与 EMA60 相等。",
  unavailable: "均线样本不足。",
};
const bandText: Record<BandwidthCompare, string> = {
  narrower: "带宽比上一根已收盘 K 线更窄。",
  wider: "带宽比上一根已收盘 K 线更宽。",
  same: "带宽与上一根已收盘 K 线相同。",
  unavailable: "没有上一根可比较的带宽。",
};

function freshnessLabel(value: Freshness) {
  if (value === "live") return "实时";
  if (value === "stale") return "已过期";
  if (value === "demo") return "示例";
  return "不可用";
}

function toneOf(value: string | null): "danger" | "pine" | "muted" {
  const n = value == null ? 0 : Number(value);
  if (n > 0) return "danger";
  if (n < 0) return "pine";
  return "muted";
}

function num(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "样本不足";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function Dashboard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [quotes, setQuotes] = useState<QuoteSnapshot[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState<Market | "all">("all");
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [series, setSeries] = useState<(Series & { id: number }) | null>(null);
  const [interval, setInterval] = useState<Interval>("1h");
  const [deriv, setDeriv] = useState<(Derivatives & { symbol: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reloadQuotes() {
    const body = await api<{ items: QuoteSnapshot[]; dataMode: Settings["dataMode"] }>("/api/quotes");
    setQuotes(body.items);
    setSelected((current) => current ?? body.items[0]?.id ?? null);
  }

  useEffect(() => {
    let stop = false;
    api<Settings>("/api/settings")
      .then((value) => {
        if (stop) return;
        setSettings(value);
        setInterval(value.klineInterval);
      })
      .catch((reason: Error) => setError(reason.message));
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    let stop = false;
    const pull = () => {
      reloadQuotes().catch((reason: Error) => {
        if (!stop) setError(reason.message);
      });
      api<Health>("/api/health")
        .then((value) => {
          if (!stop) setHealth(value);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, settings.refreshSeconds * 1000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [settings]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, market, limit: "20" });
      api<{ items: SymbolHit[]; error: string | null }>(`/api/symbols?${params}`)
        .then((body) => {
          setHits(body.items);
          setSearchError(body.error);
        })
        .catch((reason: Error) => setSearchError(reason.message));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, market, settings?.dataMode]);

  const current = quotes.find((item) => item.id === selected) ?? null;
  const visibleSeries = current && series?.id === current.id ? series : null;
  const visibleDeriv = current?.market === "perpetual" && deriv?.symbol === current.symbol ? deriv : null;

  useEffect(() => {
    if (!current) return;
    let stop = false;
    const id = current.id;
    api<Series>(`/api/series?symbol=${current.symbol}&market=${current.market}&interval=${interval}`)
      .then((body) => {
        if (!stop) setSeries({ ...body, id });
      })
      .catch((reason: Error) => {
        if (!stop) setSeries({ id, freshness: "unavailable", error: reason.message, warning: null, formingExcluded: 0, chart: null, snapshot: null });
      });
    if (current.market === "perpetual") {
      api<Derivatives>(`/api/derivatives?symbol=${current.symbol}`)
        .then((body) => {
          if (!stop) setDeriv({ ...body, symbol: current.symbol });
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        });
    }
    return () => {
      stop = true;
    };
  }, [current, interval, settings?.dataMode]);

  async function addSymbol(hit: SymbolHit) {
    setBusy(true);
    try {
      const created = await api<QuoteSnapshot>("/api/watchlist", { method: "POST", body: JSON.stringify(hit) });
      await reloadQuotes();
      setSelected(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加入失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeSymbol(id: number) {
    await api("/api/watchlist", { method: "DELETE", body: JSON.stringify({ id }) });
    setSelected(null);
    await reloadQuotes();
  }

  async function setMode(dataMode: "live" | "demo") {
    const next = await api<Settings>("/api/settings", { method: "PUT", body: JSON.stringify({ dataMode }) });
    setSettings(next);
    setConfirmDemo(false);
    setSeries(null);
    setDeriv(null);
  }

  const restricted = health?.venues.spot.restricted || health?.venues.perpetual.restricted;
  const outage = health?.venues.spot.lastError || health?.venues.perpetual.lastError;

  return (
    <div className="space-y-4">
      {settings?.dataMode === "demo" ? (
        <div className="rounded-3xl border border-[#e2c48a] bg-[#f8ecd4] px-4 py-3 text-sm leading-6">
          示例模式。价格、K 线、指标、资金费率和持仓量都来自内置样例，时间固定在 2024-01-15 09:30:00（上海），不是交易所实时数据。
          <Button className="ml-3" size="sm" variant="outline" onClick={() => setMode("live")}>
            回到实时模式
          </Button>
        </div>
      ) : null}
      {settings?.dataMode === "live" && (restricted || outage) ? (
        <div className="rounded-3xl border border-[#efc7bf] bg-[#f8ebe6] px-4 py-3 text-sm leading-6">
          <div className="font-medium text-[var(--cinnabar)]">公开行情不可用</div>
          <p>{health?.venues.spot.lastError || health?.venues.perpetual.lastError}</p>
          <p className="mt-1 text-[var(--muted)]">实时模式不会自动换成示例数据。只有你确认后，界面才会切换。</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => setConfirmDemo(true)}>
            查看示例数据
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-[var(--cinnabar)]">{error}</p> : null}
      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-3xl bg-[var(--tide-ink)] p-4 text-[#f6f3ea] shadow-[var(--shadow)]">
          <div className="text-xs text-[#c9d5d1]">加入观察</div>
          <div className="mt-3 flex gap-2">
            {(["all", "spot", "perpetual"] as const).map((item) => (
              <button key={item} className={`rounded-full px-3 py-1 text-xs ${market === item ? "bg-[#f6f3ea] text-[var(--tide-ink)]" : "bg-white/10"}`} onClick={() => setMarket(item)}>
                {item === "all" ? "全部" : item === "spot" ? "现货" : "永续"}
              </button>
            ))}
          </div>
          <Input className="mt-3 border-white/10 bg-white/10 text-[#f6f3ea] placeholder:text-white/50" placeholder="搜索 BTC 或 BTCUSDT" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="mt-3 max-h-40 space-y-2 overflow-auto">
            {searchError ? <p className="text-xs text-[#f0c7bf]">{searchError}</p> : null}
            {hits.map((hit) => (
              <div key={`${hit.market}:${hit.symbol}`} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {hit.baseAsset}
                  <span className="ml-2 text-xs text-[#c9d5d1]">{hit.market === "spot" ? "现货" : "永续"}</span>
                </span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => addSymbol(hit)}>
                  加入
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-5 text-xs text-[#c9d5d1]">观察列表</div>
          <div className="mt-2 space-y-2">
            {quotes.length === 0 ? <p className="text-sm text-[#c9d5d1]">还没有观察对象。先搜索现货或 USDT 永续。</p> : null}
            {quotes.map((item) => (
              <button key={item.id} className={`w-full rounded-2xl px-3 py-2 text-left ${selected === item.id ? "bg-white/15" : "bg-white/5"}`} onClick={() => setSelected(item.id)}>
                <div className="flex items-center justify-between">
                  <span>{item.symbol}</span>
                  <span className="text-xs">{item.market === "spot" ? "现货" : "永续"}</span>
                </div>
                <div className="num mt-1 text-sm">{item.price ?? "不可用"}</div>
              </button>
            ))}
          </div>
        </aside>
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
            <span>服务器时间 {health?.serverNowLabel ?? "—"}</span>
            <span>现货权重 {health ? `${health.venues.spot.usedWeight}/${health.venues.spot.weightLimit}` : "—"}</span>
            <span>合约权重 {health ? `${health.venues.perpetual.usedWeight}/${health.venues.perpetual.weightLimit}` : "—"}</span>
          </div>
          {!current ? (
            <div className="rounded-3xl border border-dashed border-[var(--line)] bg-[var(--paper-2)] p-8">
              <h1 className="font-serif text-4xl">先选一个交易对</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">同一个代码可以同时加入现货和 USDT 本位永续，两边分开保存，不会混成一个价格。</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-3xl border border-[var(--line)] bg-[var(--paper-2)] p-5 shadow-[var(--shadow)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="font-serif text-4xl">{current.symbol}</h1>
                      <Badge tone={current.market === "spot" ? "tide" : "ochre"}>{current.market === "spot" ? "现货" : "USDT本位永续"}</Badge>
                      <Badge tone={current.freshness === "live" ? "pine" : current.freshness === "demo" ? "ochre" : "danger"}>{freshnessLabel(current.freshness)}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {current.note || current.warning || (current.fetchedAt ? `读取于 ${formatShanghai(current.fetchedAt)}` : "没有成功读取时间")}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeSymbol(current.id)}>
                    移除
                  </Button>
                </div>
                {current.freshness === "unavailable" ? (
                  <p className="mt-6 text-lg text-[var(--cinnabar)]">{current.error || "行情不可用，未显示旧价格。"}</p>
                ) : (
                  <div className="mt-4 flex flex-wrap items-end gap-6">
                    <div className="num text-5xl">{current.price}</div>
                    <Badge tone={toneOf(current.priceChangePercent)}>{current.priceChangePercent == null ? "涨跌幅不可用" : `${Number(current.priceChangePercent) > 0 ? "+" : ""}${current.priceChangePercent}%`}</Badge>
                    <div className="text-sm text-[var(--muted)]">24 小时成交额 {current.quoteVolume ?? "—"}</div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {INTERVALS.map((item) => (
                  <button key={item} className={`rounded-full px-3 py-1 text-xs ${interval === item ? "bg-[var(--tide)] text-white" : "bg-white"}`} onClick={() => setInterval(item)}>
                    {INTERVAL_LABEL[item]}
                  </button>
                ))}
              </div>
              {visibleSeries?.warning ? <p className="text-sm text-[var(--ochre)]">{visibleSeries.warning}</p> : null}
              {visibleSeries?.note ? <p className="text-sm text-[var(--ochre)]">{visibleSeries.note}</p> : null}
              {visibleSeries?.error && visibleSeries.freshness === "unavailable" ? <p className="text-sm text-[var(--cinnabar)]">{visibleSeries.error}</p> : null}
              <ChartPanel
                candles={visibleSeries?.chart?.candles ?? []}
                ema20={visibleSeries?.chart?.ema20 ?? []}
                ema60={visibleSeries?.chart?.ema60 ?? []}
                bbUpper={visibleSeries?.chart?.bbUpper ?? []}
                bbMiddle={visibleSeries?.chart?.bbMiddle ?? []}
                bbLower={visibleSeries?.chart?.bbLower ?? []}
              />
              <p className="text-xs leading-5 text-[var(--muted)]">
                图上只画已收盘 K 线{visibleSeries?.formingExcluded ? `，已排除 ${visibleSeries.formingExcluded} 根未收盘 K 线` : ""}。青线 EMA20，赭线 EMA60，紫线是布林带(20, 2)上下轨，灰线是中轨。轨道外不等于买卖信号。
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Metric title="EMA20 / EMA60" value={`${num(visibleSeries?.snapshot?.ema20 ?? null)} / ${num(visibleSeries?.snapshot?.ema60 ?? null)}`} detail={relationText[visibleSeries?.snapshot?.emaRelation ?? "unavailable"]} />
                <Metric title="RSI14" value={num(visibleSeries?.snapshot?.rsi ?? null)} detail="Wilder 平滑。0/0 时标为样本不足。" />
                <Metric title="ATR14 / ATR%" value={`${num(visibleSeries?.snapshot?.atr ?? null, 4)} / ${num(visibleSeries?.snapshot?.atrPct ?? null)}%`} detail="真实波幅经 Wilder 平滑，百分比是 ATR 除以收盘价。" />
                <Metric title="放量比" value={num(visibleSeries?.snapshot?.volumeRatio ?? null)} detail="最近已收盘量 / 此前 20 根已收盘均量，不含当前根。" />
                <Metric title="布林带宽" value={visibleSeries?.snapshot?.bandwidthPct == null ? "样本不足" : `${num(visibleSeries.snapshot.bandwidthPct)}%`} detail={`${bandText[visibleSeries?.snapshot?.bandwidthVsPrevious ?? "unavailable"]} 收在轨道外：${visibleSeries?.snapshot?.bb == null ? "样本不足" : visibleSeries.snapshot.bb.outside ? "是" : "否"}。`} />
              </div>
              {current.market === "perpetual" ? (
                <div className="rounded-3xl border border-[var(--line)] bg-white p-5">
                  <h2 className="font-serif text-2xl">资金费率与持仓量</h2>
                  {visibleDeriv?.note ? <p className="mt-2 text-sm text-[var(--ochre)]">{visibleDeriv.note}</p> : null}
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <div>
                      <div className="text-xs text-[var(--muted)]">最新资金费率</div>
                      <div className="num mt-1 text-xl">{visibleDeriv?.lastFundingRate ?? visibleDeriv?.errors.premium ?? "不可用"}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">下次资金费时间 {visibleDeriv?.nextFundingTime ? formatShanghai(visibleDeriv.nextFundingTime) : "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--muted)]">标记 / 指数价格</div>
                      <div className="num mt-1 text-xl">{visibleDeriv?.markPrice ?? "—"} / {visibleDeriv?.indexPrice ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--muted)]">持仓量原值</div>
                      <div className="num mt-1 text-xl">{visibleDeriv?.openInterest ?? visibleDeriv?.errors.openInterest ?? "不可用"}</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        {visibleDeriv?.oiChange.status === "ok"
                          ? `最近两根历史样本变化 ${visibleDeriv.oiChange.change.toLocaleString("zh-CN")}（${visibleDeriv.oiChange.changePct == null ? "前值为 0，百分比不可用" : `${visibleDeriv.oiChange.changePct.toFixed(2)}%`}）`
                          : visibleDeriv?.oiChange.reason || visibleDeriv?.errors.oiHist || "持仓量变化样本不足"}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">现货没有资金费率和持仓量。</p>
              )}
            </div>
          )}
        </section>
      </section>
      <Dialog open={confirmDemo} onOpenChange={setConfirmDemo} title="切换到示例模式">
        <p>切换之后，画面上的数字全部来自内置样例，并会一直标明“示例”。这不会被当作实时行情。</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => setMode("demo")}>确认查看示例</Button>
          <Button variant="outline" onClick={() => setConfirmDemo(false)}>
            留在实时模式
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-3xl border border-[var(--line)] bg-white p-4">
      <div className="text-xs text-[var(--muted)]">{title}</div>
      <div className="num mt-2 text-xl">{value}</div>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{detail}</p>
    </div>
  );
}
