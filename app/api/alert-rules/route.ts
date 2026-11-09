import { NextRequest } from "next/server";
import { isAlertKind, isInterval, validateAlertDraft } from "@/lib/domain/alerts";
import { isMarket, normalizeSymbol } from "@/lib/domain/symbols";
import { deleteRule, insertRule, listRules, listWatch, readSettings, updateRule } from "@/lib/server/db";
import { fail, guard, json, readBody } from "@/lib/server/http";
import { getApp } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  return json({ items: listRules(getApp().db) });
}

export async function POST(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = record(await readBody(request));
  const symbol = normalizeSymbol(body.symbol);
  if (!symbol || !isMarket(body.market) || !isAlertKind(body.kind)) return fail("规则参数无效", 400);
  const app = getApp();
  const watched = listWatch(app.db).some((item) => item.symbol === symbol && item.market === body.market);
  if (!watched) return fail("只能为观察列表中的交易对创建提醒", 400);
  const settings = readSettings(app.db);
  const threshold = body.kind === "bb_outside" ? 0 : body.threshold;
  const cooldown = typeof body.cooldownSeconds === "number" ? body.cooldownSeconds : settings.defaultCooldownSeconds;
  const interval = isInterval(body.klineInterval) ? body.klineInterval : settings.klineInterval;
  if (typeof threshold !== "number") return fail("阈值必须是数字", 400);
  const valid = validateAlertDraft({ kind: body.kind, threshold, cooldownSeconds: cooldown, klineInterval: interval });
  if (!valid.ok) return fail(valid.error, 400);
  const created = insertRule(
    app.db,
    { symbol, market: body.market, kind: body.kind, threshold, enabled: body.enabled !== false, cooldownSeconds: cooldown, klineInterval: interval },
    new Date().toISOString(),
  );
  return json(created, 201);
}

export async function PATCH(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = record(await readBody(request));
  if (typeof body.id !== "number" || !Number.isInteger(body.id)) return fail("缺少规则编号", 400);
  const patch: { enabled?: boolean; cooldownSeconds?: number } = {};
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return fail("启用状态无效", 400);
    patch.enabled = body.enabled;
  }
  if ("cooldownSeconds" in body) {
    if (typeof body.cooldownSeconds !== "number" || !Number.isInteger(body.cooldownSeconds) || body.cooldownSeconds < 30 || body.cooldownSeconds > 86_400) {
      return fail("冷却时间需为 30 到 86400 秒", 400);
    }
    patch.cooldownSeconds = body.cooldownSeconds;
  }
  const updated = updateRule(getApp().db, body.id, patch, new Date().toISOString());
  if (!updated) return fail("规则不存在", 404);
  return json(updated);
}

export async function DELETE(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = record(await readBody(request));
  if (typeof body.id !== "number" || !Number.isInteger(body.id)) return fail("缺少规则编号", 400);
  if (!deleteRule(getApp().db, body.id)) return fail("规则不存在", 404);
  return json({ ok: true });
}
