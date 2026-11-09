import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionStatus } from "./auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function fail(message: string, status: number) {
  return json({ error: message }, status);
}

export async function readBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function guard(request: NextRequest): NextResponse | null {
  const status = sessionStatus(request.cookies.get(SESSION_COOKIE)?.value, process.env.ADMIN_TOKEN);
  if (!status.authenticated) return fail("需要管理口令", 401);
  return null;
}
