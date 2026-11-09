import { NextRequest } from "next/server";
import { listWatch, readSettings } from "@/lib/server/db";
import { guard, json } from "@/lib/server/http";
import { getApp } from "@/lib/server/runtime";
import { formatShanghai } from "@/lib/domain/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const app = getApp();
  const settings = readSettings(app.db);
  const items = await app.market.quotes(listWatch(app.db), settings.dataMode);
  const now = Date.now();
  return json({
    dataMode: settings.dataMode,
    serverNow: now,
    serverNowLabel: formatShanghai(now),
    items,
  });
}
