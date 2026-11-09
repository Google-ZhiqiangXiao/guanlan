"use client";

import { useEffect, useState } from "react";
import { INTERVALS, INTERVAL_LABEL } from "@/lib/domain/constants";
import type { Interval, Settings } from "@/lib/domain/types";
import { api } from "@/lib/client/api";
import { Button, Input } from "./ui";

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [session, setSession] = useState<{ required: boolean; authenticated: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings").then(setSettings).catch((reason: Error) => setMessage(reason.message));
    api<{ required: boolean; authenticated: boolean }>("/api/session").then(setSession).catch(() => undefined);
  }, []);

  async function save() {
    if (!settings) return;
    try {
      const next = await api<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(next);
      setMessage("已保存到本机 SQLite。");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
    }
  }

  if (!settings) return <p className="text-sm text-[var(--muted)]">正在读取设置…</p>;

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="font-serif text-4xl">设置</h1>
      <p className="text-sm leading-6 text-[var(--muted)]">指标参数是固定的：EMA20/60、RSI14、ATR14、放量比 20、布林带(20, 2)。这里只保存数据模式、刷新和默认 K 线周期。</p>
      <label className="block text-sm">
        数据模式
        <select className="mt-1 h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3" value={settings.dataMode} onChange={(event) => setSettings({ ...settings, dataMode: event.target.value as Settings["dataMode"] })}>
          <option value="live">实时。失败时显示不可用，不会悄悄换成示例。</option>
          <option value="demo">示例。所有数字都标明来自内置样例。</option>
        </select>
      </label>
      <label className="block text-sm">
        刷新间隔（秒）
        <Input className="mt-1" type="number" value={settings.refreshSeconds} onChange={(event) => setSettings({ ...settings, refreshSeconds: Number(event.target.value) })} />
      </label>
      <label className="block text-sm">
        默认已收盘 K 线周期
        <select className="mt-1 h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3" value={settings.klineInterval} onChange={(event) => setSettings({ ...settings, klineInterval: event.target.value as Interval })}>
          {INTERVALS.map((item) => (
            <option key={item} value={item}>
              {INTERVAL_LABEL[item]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        默认冷却（秒）
        <Input className="mt-1" type="number" value={settings.defaultCooldownSeconds} onChange={(event) => setSettings({ ...settings, defaultCooldownSeconds: Number(event.target.value) })} />
      </label>
      <Button onClick={save}>保存</Button>
      {message ? <p className="text-sm">{message}</p> : null}
      {session?.required ? (
        <Button
          variant="outline"
          onClick={() =>
            api("/api/session", { method: "DELETE" }).then(() => {
              window.location.href = "/login";
            })
          }
        >
          退出登录
        </Button>
      ) : (
        <p className="text-xs leading-5 text-[var(--muted)]">当前按本机回环使用，没有设置 ADMIN_TOKEN，所以不需要登录。如果把 HOST 改成非回环地址，进程会拒绝在没有至少 16 位口令时启动。</p>
      )}
    </div>
  );
}
