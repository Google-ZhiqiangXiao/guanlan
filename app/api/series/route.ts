import { NextRequest } from "next/server";
import { KLINE_LIMIT } from "@/lib/domain/constants";
import { isInterval } from "@/lib/domain/alerts";
import { isMarket, normalizeSymbol } from "@/lib/domain/symbols";
import { listWatch, readSettings } from "@/lib/server/db";
import { fail, guard, json } from "@/lib/server/http";
import { getApp } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol"));
  const market = request.nextUrl.searchParams.get("market");
  const interval = request.nextUrl.searchParams.get("interval");
  if (!symbol || !isMarket(market) || !isInterval(interval)) return fail("参数无效", 400);
  const app = getApp();
  const watched = listWatch(app.db).some((item) => item.symbol === symbol && item.market === market);
  if (!watched) return fail("请先把该交易对加入观察列表", 404);
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? String(KLINE_LIMIT));
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 80), 500) : KLINE_LIMIT;
  const settings = readSettings(app.db);
  const series = await app.market.series(symbol, market, interval, settings.dataMode, limit);
  return json({ symbol, market, interval, ...series });
}
