import { NextRequest } from "next/server";
import { normalizeSettings } from "@/lib/domain/settings";
import { readSettings, writeSettings } from "@/lib/server/db";
import { fail, guard, json, readBody } from "@/lib/server/http";
import { getApp } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  return json(readSettings(getApp().db));
}

export async function PUT(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const current = readSettings(getApp().db);
  const parsed = normalizeSettings(await readBody(request), current);
  if (!parsed.ok) return fail(parsed.error, 400);
  writeSettings(getApp().db, parsed.value);
  return json(parsed.value);
}
