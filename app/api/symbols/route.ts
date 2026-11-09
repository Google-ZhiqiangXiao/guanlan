import { NextRequest } from "next/server";
import { isMarket } from "@/lib/domain/symbols";
import { readSettings } from "@/lib/server/db";
import { guard, json } from "@/lib/server/http";
import { getApp } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const marketParam = request.nextUrl.searchParams.get("market") ?? "all";
  const market = marketParam === "all" || isMarket(marketParam) ? marketParam : "all";
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "30");
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 30;
  const settings = readSettings(getApp().db);
  const result = await getApp().market.search(q, market, settings.dataMode, limit);
  return json(result);
}
