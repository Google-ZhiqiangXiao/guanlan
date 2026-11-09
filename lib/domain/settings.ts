import { INTERVALS } from "./constants";
import type { DataMode, Interval, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  dataMode: "live",
  refreshSeconds: 15,
  klineInterval: "1h",
  defaultCooldownSeconds: 300,
};

export function normalizeSettings(input: unknown, current: Settings = DEFAULT_SETTINGS): { ok: true; value: Settings } | { ok: false; error: string } {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const next: Settings = { ...current };
  if ("dataMode" in source) {
    if (source.dataMode !== "live" && source.dataMode !== "demo") {
      return { ok: false, error: "数据模式只能是实时或示例" };
    }
    next.dataMode = source.dataMode as DataMode;
  }
  if ("refreshSeconds" in source) {
    const value = source.refreshSeconds;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 5 || value > 120) {
      return { ok: false, error: "刷新间隔需为 5 到 120 秒的整数" };
    }
    next.refreshSeconds = value;
  }
  if ("klineInterval" in source) {
    if (typeof source.klineInterval !== "string" || !(INTERVALS as readonly string[]).includes(source.klineInterval)) {
      return { ok: false, error: "K 线周期不在允许列表中" };
    }
    next.klineInterval = source.klineInterval as Interval;
  }
  if ("defaultCooldownSeconds" in source) {
    const value = source.defaultCooldownSeconds;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 30 || value > 86_400) {
      return { ok: false, error: "默认冷却需为 30 到 86400 秒的整数" };
    }
    next.defaultCooldownSeconds = value;
  }
  return { ok: true, value: next };
}
