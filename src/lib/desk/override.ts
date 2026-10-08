/**
 * Dated, auditable risk overrides (files `risk-override-YYYYMMDD.json` in the desk data dir).
 * The only kind today is `fresh_from_start`: from `start` until `expires` (the next ET-day reset), and only on
 * `et_day`, the day P/L counts only settlements at/after `start` (baseline = realized before `start`), so the
 * full DAILY_STOP_USD applies fresh from `start`. The loss-streak pause only sees post-start settlements too.
 * Open positions, resting orders and pending sends still count at full worst case. The cap itself never changes.
 * After `expires` (or on any other ET day) the override is ignored and never re-applies.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { AccountSnapshot } from "./risk";
import { etDay } from "./time";

export type RiskOverride = {
  id: string;
  kind: "fresh_from_start";
  reason: string;
  created_at: string;
  et_day: string;
  start: string; // ISO
  expires: string; // ISO, the ET-day reset
  baseline_realized_at_creation?: number;
  note?: string;
};

export function loadOverrides(dir: string): RiskOverride[] {
  if (!existsSync(dir)) return [];
  const out: RiskOverride[] = [];
  for (const f of readdirSync(dir)) {
    if (!/^risk-override-\d{8}\.json$/.test(f)) continue;
    try {
      const o = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as RiskOverride;
      if (o.kind === "fresh_from_start" && o.id && o.et_day && Number.isFinite(Date.parse(o.start)) && Number.isFinite(Date.parse(o.expires))) out.push(o);
    } catch {
      /* unreadable override = no override */
    }
  }
  return out;
}

export function activeOverride(list: RiskOverride[], now: number): RiskOverride | null {
  for (const o of list) {
    const start = Date.parse(o.start);
    const end = Date.parse(o.expires);
    if (now >= start && now < end && etDay(now) === o.et_day) return o;
  }
  return null;
}

/** Idempotent: a snapshot already carrying this override is returned unchanged. */
export function applyOverride(s: AccountSnapshot, o: RiskOverride | null): AccountSnapshot {
  if (!o || s.etDay !== o.et_day || s.override?.id === o.id) return s;
  const start = Date.parse(o.start);
  const after = s.settledToday.filter((x) => x.settledMs >= start);
  const realized = after.reduce((a, x) => a + x.pnl, 0);
  return {
    ...s,
    realizedToday: Number(realized.toFixed(4)),
    settledToday: after,
    override: { id: o.id, baseline: Number((s.realizedToday - realized).toFixed(4)), start: o.start, expires: o.expires },
  };
}
