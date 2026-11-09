export class WeightBudget {
  readonly limit: number;
  readonly windowMs: number;
  private hits: Array<{ at: number; weight: number }> = [];
  backoffUntil = 0;
  lastError: string | null = null;
  lastStatus: number | null = null;
  lastSuccessAt: number | null = null;
  lastErrorAt: number | null = null;
  lastAttemptAt: number | null = null;
  restricted = false;

  constructor(
    limit: number,
    windowMs: number,
    private now: () => number = Date.now,
  ) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  used(now = this.now()): number {
    this.prune(now);
    return this.hits.reduce((sum, hit) => sum + hit.weight, 0);
  }

  tryTake(weight: number, now = this.now()): { ok: true } | { ok: false; error: string } {
    if (weight <= 0) return { ok: true };
    if (now < this.backoffUntil) {
      const remain = Math.ceil((this.backoffUntil - now) / 1000);
      return { ok: false, error: `本地退避中，约 ${remain} 秒内不再请求交易所` };
    }
    this.prune(now);
    const used = this.hits.reduce((sum, hit) => sum + hit.weight, 0);
    if (used + weight > this.limit) {
      return { ok: false, error: "本地请求权重预算已用尽，本分钟不再访问交易所" };
    }
    this.hits.push({ at: now, weight });
    return { ok: true };
  }

  noteBackoff(seconds: number, now = this.now()) {
    const ms = Math.min(Math.max(seconds, 1), 30 * 60) * 1000;
    this.backoffUntil = Math.max(this.backoffUntil, now + ms);
  }

  snapshot(origin: string, now = this.now()) {
    return {
      origin,
      usedWeight: this.used(now),
      weightLimit: this.limit,
      windowMs: this.windowMs,
      backoffUntil: this.backoffUntil > now ? this.backoffUntil : null,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastStatus: this.lastStatus,
      lastError: this.lastError,
      restricted: this.restricted,
    };
  }

  private prune(now: number) {
    const cutoff = now - this.windowMs;
    this.hits = this.hits.filter((hit) => hit.at > cutoff);
  }
}

export class CountWindow {
  private hits: number[] = [];
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  tryTake(now: number): boolean {
    this.hits = this.hits.filter((time) => now - time < this.windowMs);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}
