/** Settlement adapters. Mock is labeled mock. Missing key or a stale print blocks a live decision. */

export type Feed =
  | { ok: true; source: "cf-brti-60s" | "pyth-gold-1m"; mode: "live" | "mock"; value: number; at: number; ageMs: number }
  | { ok: false; source: "cf-brti-60s" | "pyth-gold-1m"; missing: string; stale: boolean };

const BRTI_MAX_AGE = 5_000;
const PYTH_MAX_AGE = 15_000;

export function brtiFromMessage(msg: unknown, now = Date.now()): Feed {
  const m = msg as { avg_60s_data?: { value?: string; window_end_ts_exclusive?: number } };
  const raw = m?.avg_60s_data?.value;
  const end = m?.avg_60s_data?.window_end_ts_exclusive;
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) {
    return { ok: false, source: "cf-brti-60s", missing: "avg_60s_data.value", stale: true };
  }
  if (!end) return { ok: false, source: "cf-brti-60s", missing: "avg_60s window end", stale: true };
  const ageMs = now - end;
  if (ageMs > BRTI_MAX_AGE || ageMs < -2_000) {
    return { ok: false, source: "cf-brti-60s", missing: `stale ${ageMs}ms`, stale: true };
  }
  return { ok: true, source: "cf-brti-60s", mode: "live", value, at: end, ageMs };
}

export function pythFromPrice(row: unknown, now = Date.now()): Feed {
  const p = row as { price?: string; expo?: number; publish_time?: number };
  const px = Number(p?.price);
  const expo = Number(p?.expo);
  const at = Number(p?.publish_time);
  if (!Number.isFinite(px) || !Number.isFinite(expo) || !at) {
    return { ok: false, source: "pyth-gold-1m", missing: "price/expo/publish_time", stale: true };
  }
  const value = px * 10 ** expo;
  if (value <= 0) return { ok: false, source: "pyth-gold-1m", missing: "non-positive price", stale: true };
  const ageMs = now - at * 1000;
  if (ageMs > PYTH_MAX_AGE) return { ok: false, source: "pyth-gold-1m", missing: `stale ${ageMs}ms`, stale: true };
  return { ok: true, source: "pyth-gold-1m", mode: "live", value, at: at * 1000, ageMs };
}

export function mockFeed(source: "cf-brti-60s" | "pyth-gold-1m", value: number, at: number, now = Date.now()): Feed {
  const max = source === "cf-brti-60s" ? BRTI_MAX_AGE : PYTH_MAX_AGE;
  const ageMs = now - at;
  if (!Number.isFinite(value) || value <= 0) return { ok: false, source, missing: "mock value", stale: true };
  if (ageMs > max) return { ok: false, source, missing: `stale mock ${ageMs}ms`, stale: true };
  return { ok: true, source, mode: "mock", value, at, ageMs };
}

export function liveFeedBlocked(source: "cf-brti-60s" | "pyth-gold-1m", hasKey: boolean): Feed {
  if (!hasKey) {
    return {
      ok: false,
      source,
      missing: source === "cf-brti-60s" ? "Kalshi key required for cfbenchmarks_value" : "PYTH_API_KEY required",
      stale: true,
    };
  }
  return { ok: false, source, missing: "feed not subscribed", stale: true };
}
