import type { Market, SymbolInfo } from "./types";

export const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

export function normalizeSymbol(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const symbol = input.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return null;
  return symbol;
}

export function isMarket(input: unknown): input is Market {
  return input === "spot" || input === "perpetual";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasSpotPermission(row: Record<string, unknown>): boolean {
  if (row.isSpotTradingAllowed === true) return true;
  if (Array.isArray(row.permissions) && row.permissions.includes("SPOT")) return true;
  if (Array.isArray(row.permissionSets)) {
    return row.permissionSets.some((set) => Array.isArray(set) && set.includes("SPOT"));
  }
  return false;
}

export function spotEntries(payload: unknown): SymbolInfo[] {
  const root = asRecord(payload);
  const rows = root && Array.isArray(root.symbols) ? root.symbols : [];
  const items: SymbolInfo[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    if (record.status !== "TRADING" || record.quoteAsset !== "USDT") continue;
    if (!hasSpotPermission(record)) continue;
    if (typeof record.symbol !== "string" || typeof record.baseAsset !== "string") continue;
    items.push({
      symbol: record.symbol,
      market: "spot",
      baseAsset: record.baseAsset,
      quoteAsset: "USDT",
    });
  }
  return items;
}

export function perpetualEntries(payload: unknown): SymbolInfo[] {
  const root = asRecord(payload);
  const rows = root && Array.isArray(root.symbols) ? root.symbols : [];
  const items: SymbolInfo[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    if (record.status !== "TRADING" || record.contractType !== "PERPETUAL") continue;
    if (record.quoteAsset !== "USDT") continue;
    if (record.marginAsset != null && record.marginAsset !== "USDT") continue;
    if (typeof record.symbol !== "string" || typeof record.baseAsset !== "string") continue;
    items.push({
      symbol: record.symbol,
      market: "perpetual",
      baseAsset: record.baseAsset,
      quoteAsset: "USDT",
    });
  }
  return items;
}

export function searchSymbols(entries: SymbolInfo[], query: string, market: Market | "all", limit: number): SymbolInfo[] {
  const needle = query.trim().toUpperCase();
  return entries
    .filter((entry) => (market === "all" ? true : entry.market === market))
    .filter((entry) => (needle ? entry.symbol.includes(needle) || entry.baseAsset.includes(needle) : true))
    .slice(0, limit);
}

export function findSymbol(entries: SymbolInfo[], symbol: string, market: Market): SymbolInfo | null {
  return entries.find((entry) => entry.symbol === symbol && entry.market === market) ?? null;
}
