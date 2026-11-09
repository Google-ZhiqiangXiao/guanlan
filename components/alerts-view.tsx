"use client";

import { useEffect, useState } from "react";
import { ALERT_KIND_LABEL, ALERT_KINDS } from "@/lib/domain/alerts";
import { INTERVALS, INTERVAL_LABEL } from "@/lib/domain/constants";
import type { AlertKind, Interval, Market, Settings } from "@/lib/domain/types";
import { api } from "@/lib/client/api";
import { Badge, Button, Input, Switch } from "./ui";

type Watch = { id: number; symbol: string; market: Market };
type Rule = {
  id: number;
  symbol: string;
  market: Market;
  kind: AlertKind;
  threshold: number;
  enabled: boolean;
  cooldownSeconds: number;
  klineInterval: Interval;
};
type EventItem = { id: number; message: string; source: string; firedAtLabel: string; symbol: string; market: Market };

export function AlertsView() {
  const [watch, setWatch] = useState<Watch[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [watchId, setWatchId] = useState<number | "">("");
  const [kind, setKind] = useState<AlertKind>("close_above");
  const [threshold, setThreshold] = useState("100");
  const [cooldown, setCooldown] = useState("300");
  const [interval, setIntervalValue] = useState<Interval>("1h");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [list, ruleBody, eventBody, settingBody] = await Promise.all([
      api<{ items: Watch[] }>("/api/watchlist"),
      api<{ items: Rule[] }>("/api/alert-rules"),
      api<{ items: EventItem[] }>("/api/alert-events"),
      api<Settings>("/api/settings"),
    ]);
    setWatch(list.items);
    setRules(ruleBody.items);
    setEvents(eventBody.items);
    setSettings(settingBody);
    setCooldown(String(settingBody.defaultCooldownSeconds));
    setIntervalValue(settingBody.klineInterval);
  }

  useEffect(() => {
    let stop = false;
    Promise.all([
      api<{ items: Watch[] }>("/api/watchlist"),
      api<{ items: Rule[] }>("/api/alert-rules"),
      api<{ items: EventItem[] }>("/api/alert-events"),
      api<Settings>("/api/settings"),
    ])
      .then(([list, ruleBody, eventBody, settingBody]) => {
        if (stop) return;
        setWatch(list.items);
        setRules(ruleBody.items);
        setEvents(eventBody.items);
        setSettings(settingBody);
        setCooldown(String(settingBody.defaultCooldownSeconds));
        setIntervalValue(settingBody.klineInterval);
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message);
      });
    return () => {
      stop = true;
    };
  }, []);

  async function createRule() {
    const item = watch.find((entry) => entry.id === watchId);
    if (!item) {
      setError("先选择观察列表里的交易对");
      return;
    }
    try {
      await api("/api/alert-rules", {
        method: "POST",
        body: JSON.stringify({
          symbol: item.symbol,
          market: item.market,
          kind,
          threshold: kind === "bb_outside" ? 0 : Number(threshold),
          cooldownSeconds: Number(cooldown),
          klineInterval: interval,
        }),
      });
      setError(null);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-4xl">阈值提醒</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          规则只读取已收盘 K 线。预热不足、刷新失败或数据过期时不触发。同一条规则在冷却时间内不会重复写入。{settings?.dataMode === "demo" ? "当前是示例模式，触发记录会带【示例】。" : "实时模式下不会用示例数据触发。"}
        </p>
      </div>
      {error ? <p className="text-sm text-[var(--cinnabar)]">{error}</p> : null}
      <section className="grid gap-3 rounded-3xl border border-[var(--line)] bg-[var(--paper-2)] p-4 md:grid-cols-2">
        <label className="text-sm">
          观察对象
          <select className="mt-1 h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3" value={watchId} onChange={(event) => setWatchId(event.target.value ? Number(event.target.value) : "")}>
            <option value="">选择</option>
            {watch.map((item) => (
              <option key={item.id} value={item.id}>
                {item.symbol} · {item.market === "spot" ? "现货" : "永续"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          条件
          <select className="mt-1 h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3" value={kind} onChange={(event) => setKind(event.target.value as AlertKind)}>
            {ALERT_KINDS.map((item) => (
              <option key={item} value={item}>
                {ALERT_KIND_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        {kind === "bb_outside" ? <p className="text-sm text-[var(--muted)]">这条规则没有额外阈值，只在收盘价严格处于布林带之外时触发。</p> : <label className="text-sm">阈值<Input className="mt-1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>}
        <label className="text-sm">
          冷却秒数
          <Input className="mt-1" value={cooldown} onChange={(event) => setCooldown(event.target.value)} />
        </label>
        <label className="text-sm">
          已收盘 K 线周期
          <select className="mt-1 h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3" value={interval} onChange={(event) => setIntervalValue(event.target.value as Interval)}>
            {INTERVALS.map((item) => (
              <option key={item} value={item}>
                {INTERVAL_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button onClick={createRule}>添加提醒</Button>
        </div>
      </section>
      <section className="space-y-3">
        {rules.length === 0 ? <p className="text-sm text-[var(--muted)]">还没有提醒规则。</p> : null}
        {rules.map((rule) => (
          <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[var(--line)] bg-white px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{rule.symbol}</span>
                <Badge tone={rule.market === "spot" ? "tide" : "ochre"}>{rule.market === "spot" ? "现货" : "永续"}</Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {ALERT_KIND_LABEL[rule.kind]}
                {rule.kind === "bb_outside" ? "" : ` ${rule.threshold}`} · {INTERVAL_LABEL[rule.klineInterval]} · 冷却 {rule.cooldownSeconds} 秒
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={rule.enabled} onCheckedChange={(enabled) => api(`/api/alert-rules`, { method: "PATCH", body: JSON.stringify({ id: rule.id, enabled }) }).then(reload)} />
              <Button size="sm" variant="ghost" onClick={() => api("/api/alert-rules", { method: "DELETE", body: JSON.stringify({ id: rule.id }) }).then(reload)}>
                删除
              </Button>
            </div>
          </div>
        ))}
      </section>
      <section>
        <h2 className="font-serif text-2xl">站内记录</h2>
        <div className="mt-3 space-y-2">
          {events.length === 0 ? <p className="text-sm text-[var(--muted)]">还没有触发记录。</p> : null}
          {events.map((event) => (
            <article key={event.id} className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm leading-6">
              <div className="text-xs text-[var(--muted)]">{event.firedAtLabel}</div>
              <Badge tone={event.source === "demo" ? "ochre" : "tide"}>{event.source === "demo" ? "示例触发" : "实时触发"}</Badge>
              <p className="mt-1">{event.message}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
