import { parseDecimal } from "./numbers";
import type { OiChange } from "./types";

export type OiSample = { value: number; time: number };

/**
 * 只用调用方给出的历史样本计算变化。少于 2 个有效样本时返回不足，不补造前值。
 * 样本按时间排序后取最后两根。前值为 0 时变化额仍给出，变化百分比为 null。
 */
export function openInterestChange(samples: OiSample[]): OiChange {
  const valid = samples.filter((sample) => Number.isFinite(sample.value) && Number.isFinite(sample.time));
  if (valid.length < 2) {
    return { status: "insufficient", reason: "持仓量历史样本少于 2 根，无法计算变化。" };
  }
  const sorted = [...valid].sort((a, b) => a.time - b.time);
  const previous = sorted[sorted.length - 2];
  const latest = sorted[sorted.length - 1];
  const change = latest.value - previous.value;
  return {
    status: "ok",
    previous: previous.value,
    latest: latest.value,
    change,
    changePct: previous.value === 0 ? null : (change / previous.value) * 100,
    previousTime: previous.time,
    latestTime: latest.time,
  };
}

/** 只接受官方 openInterestHist 形态。不是数组则无法验证，返回 null。 */
export function parseOpenInterestHist(body: unknown): OiSample[] | null {
  if (!Array.isArray(body)) return null;
  const samples: OiSample[] = [];
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const value = parseDecimal(record.sumOpenInterest);
    const time = record.timestamp;
    if (value == null || typeof time !== "number" || !Number.isFinite(time)) continue;
    samples.push({ value, time });
  }
  return samples;
}
