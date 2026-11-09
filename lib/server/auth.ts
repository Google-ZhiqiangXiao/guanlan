import { createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "guanlan_session";

export function sessionValue(adminToken: string): string {
  return createHash("sha256").update(`guanlan.v1|${adminToken}`).digest("hex");
}

export function tokenMatches(input: string, adminToken: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(adminToken).digest();
  return timingSafeEqual(left, right);
}

export function sessionStatus(cookie: string | undefined, adminToken: string | undefined): { required: boolean; authenticated: boolean } {
  if (!adminToken) return { required: false, authenticated: true };
  if (!cookie) return { required: true, authenticated: false };
  const expected = sessionValue(adminToken);
  const left = Buffer.from(cookie);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return { required: true, authenticated: false };
  return { required: true, authenticated: timingSafeEqual(left, right) };
}

const failures = new Map<string, { count: number; until: number }>();

export function loginAllowed(key: string, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const current = failures.get(key);
  if (current && current.count >= 8 && current.until > now) {
    return { ok: false, retryAfterSec: Math.ceil((current.until - now) / 1000) };
  }
  return { ok: true };
}

export function registerLoginFailure(key: string, now: number) {
  const current = failures.get(key);
  const count = current && current.until > now ? current.count + 1 : 1;
  failures.set(key, { count, until: now + 10 * 60_000 });
}

export function clearLoginFailures(key: string) {
  failures.delete(key);
}
