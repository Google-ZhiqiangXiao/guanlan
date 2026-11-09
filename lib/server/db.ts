import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS, normalizeSettings } from "@/lib/domain/settings";
import type { AlertKind, AlertRule, Interval, Market, Settings, SymbolInfo, WatchItem } from "@/lib/domain/types";

export type Sql = DatabaseSync;

export function openDatabase(filename: string): Sql {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Sql) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      market TEXT NOT NULL CHECK (market IN ('spot', 'perpetual')),
      base_asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (symbol, market)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      market TEXT NOT NULL,
      kind TEXT NOT NULL,
      threshold REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      cooldown_seconds INTEGER NOT NULL,
      kline_interval TEXT NOT NULL,
      last_fired_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER,
      symbol TEXT NOT NULL,
      market TEXT NOT NULL,
      kind TEXT NOT NULL,
      threshold REAL NOT NULL,
      observed REAL NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL,
      fired_at TEXT NOT NULL
    );
  `);
}

function rowOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function mapWatch(value: unknown): WatchItem | null {
  const row = rowOf(value);
  if (!row) return null;
  return {
    id: Number(row.id),
    symbol: String(row.symbol),
    market: row.market as Market,
    baseAsset: String(row.base_asset),
    quoteAsset: String(row.quote_asset),
    createdAt: String(row.created_at),
  };
}

export function listWatch(db: Sql): WatchItem[] {
  return db
    .prepare("SELECT * FROM watchlist ORDER BY id ASC")
    .all()
    .flatMap((item) => {
      const mapped = mapWatch(item);
      return mapped ? [mapped] : [];
    });
}

export function addWatch(db: Sql, info: SymbolInfo, nowIso: string): { ok: true; item: WatchItem } | { ok: false; error: string } {
  const count = rowOf(db.prepare("SELECT COUNT(*) AS n FROM watchlist").get());
  if (count && Number(count.n) >= 50) return { ok: false, error: "观察列表最多 50 个交易对" };
  try {
    const result = db
      .prepare("INSERT INTO watchlist (symbol, market, base_asset, quote_asset, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(info.symbol, info.market, info.baseAsset, info.quoteAsset, nowIso);
    return {
      ok: true,
      item: {
        id: Number(result.lastInsertRowid),
        symbol: info.symbol,
        market: info.market,
        baseAsset: info.baseAsset,
        quoteAsset: info.quoteAsset,
        createdAt: nowIso,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "这个市场里已经有该交易对" };
    throw error;
  }
}

export function removeWatch(db: Sql, id: number): { symbol: string; market: Market } | null {
  const existing = mapWatch(db.prepare("SELECT * FROM watchlist WHERE id = ?").get(id));
  if (!existing) return null;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM alert_rules WHERE symbol = ? AND market = ?").run(existing.symbol, existing.market);
    db.prepare("DELETE FROM watchlist WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { symbol: existing.symbol, market: existing.market };
}

export function readSettings(db: Sql): Settings {
  const row = rowOf(db.prepare("SELECT value FROM settings WHERE key = ?").get("app"));
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = normalizeSettings(JSON.parse(String(row.value)), DEFAULT_SETTINGS);
    return parsed.ok ? parsed.value : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(db: Sql, settings: Settings) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    "app",
    JSON.stringify(settings),
  );
}

function mapRule(value: unknown): AlertRule | null {
  const row = rowOf(value);
  if (!row) return null;
  return {
    id: Number(row.id),
    symbol: String(row.symbol),
    market: row.market as Market,
    kind: row.kind as AlertKind,
    threshold: Number(row.threshold),
    enabled: Number(row.enabled) === 1,
    cooldownSeconds: Number(row.cooldown_seconds),
    klineInterval: row.kline_interval as Interval,
    lastFiredAt: row.last_fired_at == null ? null : String(row.last_fired_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listRules(db: Sql): AlertRule[] {
  return db
    .prepare("SELECT * FROM alert_rules ORDER BY id ASC")
    .all()
    .flatMap((item) => {
      const mapped = mapRule(item);
      return mapped ? [mapped] : [];
    });
}

export function getRule(db: Sql, id: number): AlertRule | null {
  return mapRule(db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id));
}

export function insertRule(
  db: Sql,
  input: Omit<AlertRule, "id" | "lastFiredAt" | "createdAt" | "updatedAt">,
  nowIso: string,
): AlertRule {
  const result = db
    .prepare(
      `INSERT INTO alert_rules
        (symbol, market, kind, threshold, enabled, cooldown_seconds, kline_interval, last_fired_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      input.symbol,
      input.market,
      input.kind,
      input.threshold,
      input.enabled ? 1 : 0,
      input.cooldownSeconds,
      input.klineInterval,
      nowIso,
      nowIso,
    );
  const created = getRule(db, Number(result.lastInsertRowid));
  if (!created) throw new Error("规则写入后无法读取");
  return created;
}

export function updateRule(
  db: Sql,
  id: number,
  patch: { enabled?: boolean; cooldownSeconds?: number },
  nowIso: string,
): AlertRule | null {
  const current = getRule(db, id);
  if (!current) return null;
  const enabled = patch.enabled ?? current.enabled;
  const cooldown = patch.cooldownSeconds ?? current.cooldownSeconds;
  db.prepare("UPDATE alert_rules SET enabled = ?, cooldown_seconds = ?, updated_at = ? WHERE id = ?").run(
    enabled ? 1 : 0,
    cooldown,
    nowIso,
    id,
  );
  return getRule(db, id);
}

export function deleteRule(db: Sql, id: number): boolean {
  const result = db.prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
  return result.changes > 0;
}

export function commitFire(
  db: Sql,
  rule: AlertRule,
  observed: number,
  message: string,
  source: "live" | "demo",
  nowIso: string,
  nowMs: number,
): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = getRule(db, rule.id);
    if (!current || !current.enabled) {
      db.exec("ROLLBACK");
      return false;
    }
    if (current.lastFiredAt) {
      const previous = Date.parse(current.lastFiredAt);
      if (Number.isFinite(previous) && nowMs - previous < current.cooldownSeconds * 1000) {
        db.exec("ROLLBACK");
        return false;
      }
    }
    const text = source === "demo" ? `【示例】${message}` : message;
    db.prepare(
      `INSERT INTO alert_events (rule_id, symbol, market, kind, threshold, observed, message, source, fired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(current.id, current.symbol, current.market, current.kind, current.threshold, observed, text, source, nowIso);
    db.prepare("UPDATE alert_rules SET last_fired_at = ?, updated_at = ? WHERE id = ?").run(nowIso, nowIso, current.id);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type AlertEvent = {
  id: number;
  ruleId: number | null;
  symbol: string;
  market: Market;
  kind: AlertKind;
  threshold: number;
  observed: number;
  message: string;
  source: string;
  firedAt: string;
};

export function listEvents(db: Sql, limit: number): AlertEvent[] {
  return db
    .prepare("SELECT * FROM alert_events ORDER BY id DESC LIMIT ?")
    .all(limit)
    .flatMap((item) => {
      const row = rowOf(item);
      if (!row) return [];
      return [
        {
          id: Number(row.id),
          ruleId: row.rule_id == null ? null : Number(row.rule_id),
          symbol: String(row.symbol),
          market: row.market as Market,
          kind: row.kind as AlertKind,
          threshold: Number(row.threshold),
          observed: Number(row.observed),
          message: String(row.message),
          source: String(row.source),
          firedAt: String(row.fired_at),
        },
      ];
    });
}
