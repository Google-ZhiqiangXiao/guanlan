import { INTERVALS } from "./constants";
import type { AlertKind, AlertRule, Freshness, IndicatorSnapshot, Interval, Market } from "./types";

export const ALERT_KINDS: AlertKind[] = [
  "close_above",
  "close_below",
  "rsi_above",
  "rsi_below",
  "atr_pct_above",
  "volume_ratio_above",
  "bb_outside",
];

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  close_above: "已收盘价高于或等于",
  close_below: "已收盘价低于或等于",
  rsi_above: "RSI14 高于或等于",
  rsi_below: "RSI14 低于或等于",
  atr_pct_above: "ATR14 占收盘价百分比高于或等于",
  volume_ratio_above: "放量比高于或等于",
  bb_outside: "最新已收盘价在布林带外",
};

export type IndicatorReading = {
  freshness: Freshness;
  close: number | null;
  closeTime: number | null;
  rsi: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  bbOutside: boolean | null;
};

export type Decision =
  | { action: "skip"; reason: "disabled" | "not_actionable" | "no_data" | "condition_false" | "cooldown" }
  | { action: "fire"; observed: number; message: string };

export function marketLabel(market: Market): string {
  return market === "spot" ? "现货" : "USDT本位永续";
}

export function observationKey(market: Market, symbol: string): string {
  return `${market}:${symbol}`;
}

function actionable(freshness: Freshness): boolean {
  return freshness === "live" || freshness === "demo";
}

export function evaluateAlert(rule: AlertRule, reading: IndicatorReading | null, nowMs = Date.now()): Decision {
  if (!rule.enabled) return { action: "skip", reason: "disabled" };
  if (!reading || !actionable(reading.freshness)) return { action: "skip", reason: "not_actionable" };

  const observed = observedValue(rule.kind, reading);
  if (observed == null) return { action: "skip", reason: "no_data" };
  if (!conditionMet(rule, observed, reading)) return { action: "skip", reason: "condition_false" };

  if (rule.lastFiredAt) {
    const previous = Date.parse(rule.lastFiredAt);
    if (Number.isFinite(previous) && nowMs - previous < rule.cooldownSeconds * 1000) {
      return { action: "skip", reason: "cooldown" };
    }
  }

  return { action: "fire", observed, message: alertMessage(rule, observed, reading) };
}

function observedValue(kind: AlertKind, reading: IndicatorReading): number | null {
  if (kind === "close_above" || kind === "close_below") return reading.close;
  if (kind === "rsi_above" || kind === "rsi_below") return reading.rsi;
  if (kind === "atr_pct_above") return reading.atrPct;
  if (kind === "volume_ratio_above") return reading.volumeRatio;
  if (kind === "bb_outside") return reading.bbOutside == null ? null : reading.bbOutside ? 1 : 0;
  return null;
}

function conditionMet(rule: AlertRule, observed: number, reading: IndicatorReading): boolean {
  if (rule.kind === "bb_outside") return reading.bbOutside === true;
  if (rule.kind === "close_above" || rule.kind === "rsi_above" || rule.kind === "atr_pct_above" || rule.kind === "volume_ratio_above") {
    return observed >= rule.threshold;
  }
  return observed <= rule.threshold;
}

function alertMessage(rule: AlertRule, observed: number, reading: IndicatorReading): string {
  const when = reading.closeTime == null ? "收盘时间未知" : `已收盘K线收盘时间 ${new Date(reading.closeTime).toISOString()}`;
  const detail =
    rule.kind === "bb_outside"
      ? "最新已收盘价在布林带(20,2)之外。等于轨道不算在外。"
      : `${ALERT_KIND_LABEL[rule.kind]}。观测值 ${observed}，阈值 ${rule.threshold}。`;
  return `${rule.symbol} ${marketLabel(rule.market)} ${rule.klineInterval} ${detail}${when}。这只是阈值提醒，不是买卖建议。`;
}

export function readingFromSnapshot(
  freshness: Freshness,
  close: number | null,
  closeTime: number | null,
  snapshot: IndicatorSnapshot,
): IndicatorReading {
  return {
    freshness,
    close,
    closeTime,
    rsi: snapshot.rsi,
    atrPct: snapshot.atrPct,
    volumeRatio: snapshot.volumeRatio,
    bbOutside: snapshot.bb ? snapshot.bb.outside : null,
  };
}

export function isAlertKind(value: unknown): value is AlertKind {
  return typeof value === "string" && ALERT_KINDS.includes(value as AlertKind);
}

export function isInterval(value: unknown): value is Interval {
  return typeof value === "string" && (INTERVALS as readonly string[]).includes(value);
}

export function validateAlertDraft(input: {
  kind: AlertKind;
  threshold: number;
  cooldownSeconds: number;
  klineInterval: Interval;
}): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(input.threshold)) return { ok: false, error: "阈值必须是有限数字" };
  if (!Number.isInteger(input.cooldownSeconds) || input.cooldownSeconds < 30 || input.cooldownSeconds > 86_400) {
    return { ok: false, error: "冷却时间需为 30 到 86400 秒" };
  }
  if (!isInterval(input.klineInterval)) return { ok: false, error: "K 线周期不在允许列表中" };
  if (input.kind === "bb_outside") return { ok: true };
  if (input.kind === "rsi_above" || input.kind === "rsi_below") {
    if (input.threshold < 0 || input.threshold > 100) return { ok: false, error: "RSI 阈值需在 0 到 100" };
    return { ok: true };
  }
  if (input.kind === "atr_pct_above") {
    if (!(input.threshold > 0) || input.threshold > 1000) return { ok: false, error: "ATR 百分比阈值需大于 0 且不超过 1000" };
    return { ok: true };
  }
  if (input.kind === "volume_ratio_above") {
    if (!(input.threshold > 0) || input.threshold > 1000) return { ok: false, error: "放量比阈值需大于 0 且不超过 1000" };
    return { ok: true };
  }
  if (!(input.threshold > 0)) return { ok: false, error: "价格阈值需大于 0" };
  return { ok: true };
}
