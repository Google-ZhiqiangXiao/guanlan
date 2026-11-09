import type { Market } from "@/lib/domain/types";
import { isBinanceErrorBody, textLooksRestricted } from "@/lib/domain/parse";
import { WeightBudget } from "./budget";

export const SPOT_ORIGIN = "https://api.binance.com";
export const FUTURES_ORIGIN = "https://fapi.binance.com";

export type Upstream =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string; restricted: boolean; retryAfterSec: number | null };

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

function failureMessage(status: number, body: unknown, raw: string, restricted: boolean): string {
  const msg = isBinanceErrorBody(body) ? body.msg.slice(0, 180) : "";
  if (restricted) {
    return `交易所从当前网络位置拒绝了公开行情（HTTP ${status || "网络"}）。没有改用其他地址，也没有改用示例数据。`;
  }
  if (status === 429) return `触发交易所频率限制（HTTP 429）${msg ? `：${msg}` : ""}。已按 Retry-After 退避。`;
  if (status === 418) return `交易所暂时封禁了当前 IP（HTTP 418）${msg ? `：${msg}` : ""}。已停止请求并等待。`;
  if (status === 0) return raw;
  return `交易所请求失败（HTTP ${status}）${msg ? `：${msg}` : ""}`;
}

export class BinanceClient {
  constructor(
    private fetchFn: typeof fetch,
    private budgets: { spot: WeightBudget; perpetual: WeightBudget },
    private now: () => number,
  ) {}

  budget(market: Market): WeightBudget {
    return market === "spot" ? this.budgets.spot : this.budgets.perpetual;
  }

  async getJson(market: Market, path: string, query: Record<string, string | undefined>, weight: number): Promise<Upstream> {
    const budget = this.budget(market);
    const started = this.now();
    budget.lastAttemptAt = started;
    const gate = budget.tryTake(weight, started);
    if (!gate.ok) {
      if (!budget.lastError) {
        budget.lastError = gate.error;
        budget.lastErrorAt = started;
      }
      return { ok: false, status: budget.lastStatus ?? 0, error: gate.error, restricted: budget.restricted, retryAfterSec: null };
    }
    const origin = market === "spot" ? SPOT_ORIGIN : FUTURES_ORIGIN;
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { accept: "application/json", "user-agent": "guanlan-watch/0.1" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "网络错误";
      const text = `无法连接交易所：${message}`;
      budget.lastError = text;
      budget.lastErrorAt = this.now();
      budget.lastStatus = 0;
      return { ok: false, status: 0, error: text, restricted: false, retryAfterSec: null };
    }
    if (response.status >= 300 && response.status < 400) {
      const text = "交易所返回了重定向，已拒绝跟随";
      budget.lastError = text;
      budget.lastErrorAt = this.now();
      budget.lastStatus = response.status;
      return { ok: false, status: response.status, error: text, restricted: false, retryAfterSec: null };
    }
    const raw = await response.text();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }
    const restricted = response.status === 451 || textLooksRestricted(raw) || (isBinanceErrorBody(body) && textLooksRestricted(body.msg));
    if (!response.ok || isBinanceErrorBody(body)) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      if (response.status === 429 || response.status === 418) {
        budget.noteBackoff(retryAfter ?? (response.status === 418 ? 120 : 30));
      } else if (restricted) {
        budget.noteBackoff(60);
        budget.restricted = true;
      }
      const error = failureMessage(response.status, body, raw.slice(0, 180), restricted);
      budget.lastError = error;
      budget.lastErrorAt = this.now();
      budget.lastStatus = response.status;
      return { ok: false, status: response.status, error, restricted, retryAfterSec: retryAfter };
    }
    budget.restricted = false;
    budget.lastError = null;
    budget.lastStatus = response.status;
    budget.lastSuccessAt = this.now();
    return { ok: true, status: response.status, data: body };
  }
}
