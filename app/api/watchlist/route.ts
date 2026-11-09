import { NextRequest } from "next/server";
import { isMarket, normalizeSymbol } from "@/lib/domain/symbols";
import { addWatch, listWatch, readSettings, removeWatch } from "@/lib/server/db";
import { fail, guard, json, readBody } from "@/lib/server/http";
import { getApp } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  return json({ items: listWatch(getApp().db) });
}

export async function POST(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readBody(request);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const symbol = normalizeSymbol(record.symbol);
  if (!symbol || !isMarket(record.market)) return fail("交易对或市场无效", 400);
  const app = getApp();
  const settings = readSettings(app.db);
  const resolved = await app.market.resolve(symbol, record.market, settings.dataMode);
  if (!resolved.ok) return fail(resolved.error, 400);
  const created = addWatch(app.db, resolved.info, new Date().toISOString());
  if (!created.ok) return fail(created.error, 409);
  return json(created.item, 201);
}

export async function DELETE(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readBody(request);
  const id = body && typeof body === "object" ? (body as { id?: unknown }).id : null;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return fail("缺少有效的观察项编号", 400);
  const removed = removeWatch(getApp().db, id);
  if (!removed) return fail("观察项不存在", 404);
  return json({ ok: true });
}
