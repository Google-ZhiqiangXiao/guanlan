import { evaluateAlert, readingFromSnapshot } from "@/lib/domain/alerts";
import { commitFire, listRules, readSettings } from "./db";
import type { AppRuntime } from "./runtime";

export async function runAlerts(app: AppRuntime, nowMs: number): Promise<{ checked: number; fired: number }> {
  const settings = readSettings(app.db);
  const rules = listRules(app.db).filter((rule) => rule.enabled);
  let fired = 0;
  for (const rule of rules) {
    const series = await app.market.series(rule.symbol, rule.market, rule.klineInterval, settings.dataMode);
    const reading = series.snapshot
      ? readingFromSnapshot(series.freshness, series.lastClose, series.lastCloseTime, series.snapshot)
      : {
          freshness: series.freshness,
          close: null,
          closeTime: null,
          rsi: null,
          atrPct: null,
          volumeRatio: null,
          bbOutside: null,
        };
    const decision = evaluateAlert(rule, reading, nowMs);
    if (decision.action !== "fire") continue;
    const stored = commitFire(
      app.db,
      rule,
      decision.observed,
      decision.message,
      settings.dataMode === "demo" ? "demo" : "live",
      new Date(nowMs).toISOString(),
      nowMs,
    );
    if (stored) fired += 1;
  }
  return { checked: rules.length, fired };
}
