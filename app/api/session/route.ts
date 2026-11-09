import { NextRequest } from "next/server";
import { clearLoginFailures, loginAllowed, SESSION_COOKIE, sessionStatus, sessionValue, tokenMatches, registerLoginFailure } from "@/lib/server/auth";
import { fail, json, readBody } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const status = sessionStatus(request.cookies.get(SESSION_COOKIE)?.value, process.env.ADMIN_TOKEN);
  return json(status);
}

export async function POST(request: NextRequest) {
  const admin = process.env.ADMIN_TOKEN;
  if (!admin) return fail("本机未启用口令", 400);
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const allowed = loginAllowed(key, now);
  if (!allowed.ok) return fail(`尝试过多，请在 ${allowed.retryAfterSec} 秒后再试`, 429);
  const body = await readBody(request);
  const token = body && typeof body === "object" && typeof (body as { token?: unknown }).token === "string" ? (body as { token: string }).token : "";
  if (!tokenMatches(token, admin)) {
    registerLoginFailure(key, now);
    return fail("口令不正确", 401);
  }
  clearLoginFailures(key);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionValue(admin), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
