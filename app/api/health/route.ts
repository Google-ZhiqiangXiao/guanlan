import { NextRequest } from "next/server";
import { readSettings } from "@/lib/server/db";
import { fail, guard, json } from "@/lib/server/http";
import { getApp, schedulerState } from "@/lib/server/runtime";
import { formatShanghai } from "@/lib/domain/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const app = getApp();
    const settings = readSettings(app.db);
    if (settings.dataMode === "live") {
      await Promise.all([app.market.probe("spot"), app.market.probe("perpetual")]);
    }
    const now = Date.now();
    return json({
      timezone: "Asia/Shanghai",
      serverNow: now,
      serverNowLabel: formatShanghai(now),
      dataMode: settings.dataMode,
      authRequired: Boolean(process.env.ADMIN_TOKEN),
      bindHost: process.env.HOST || "127.0.0.1",
      bindPort: process.env.PORT || "47291",
      venues: {
        spot: app.spotBudget.snapshot("https://api.binance.com", now),
        perpetual: app.futuresBudget.snapshot("https://fapi.binance.com", now),
      },
      cacheEntries: app.market.size,
      scheduler: schedulerState,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "健康检查失败", 500);
  }
}
