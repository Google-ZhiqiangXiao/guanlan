import { NextRequest } from "next/server";
import { normalizeSymbol } from "@/lib/domain/symbols";
import { listWatch, readSettings } from "@/lib/server/db";
import { fail, guard, json } from "@/lib/server/http";
import { getApp } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol"));
  if (!symbol) return fail("交易对无效", 400);
  const app = getApp();
  const watched = listWatch(app.db).some((item) => item.symbol === symbol && item.market === "perpetual");
  if (!watched) return fail("请先把该永续合约加入观察列表", 404);
  const settings = readSettings(app.db);
  const result = await app.market.derivatives(symbol, "perpetual", settings.dataMode);
  if (!result.ok) return fail(result.error, 400);
  return json(result);
}
