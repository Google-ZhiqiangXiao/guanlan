export function parseDecimal(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isPositiveDecimalString(value: string): boolean {
  const parsed = parseDecimal(value);
  return parsed != null && parsed > 0;
}
