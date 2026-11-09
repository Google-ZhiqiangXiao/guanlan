import { NextRequest } from "next/server";
import { formatShanghai } from "@/lib/domain/time";
import { listEvents } from "@/lib/server/db";
import { guard, json } from "@/lib/server/http";
import { getApp } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const items = listEvents(getApp().db, limit).map((event) => ({
    ...event,
    firedAtLabel: formatShanghai(Date.parse(event.firedAt)),
  }));
  return json({ items });
}
