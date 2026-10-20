/**
 * Closed 15m and 1h bars from the settlement-index prints already on disk.
 * A minute exists only when it has a print. A higher bar exists only when every
 * minute in it exists. Gaps are counted and not filled. These bars have no volume.
 * They do not go through BarStore.validateBars, which drops a bar that has no volume.
 * They do not enter the settlement price.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REFERENCE, SERIES, dataDir, type Series } from "./config";
import { RESEARCH_PRODUCT } from "./market-data";
import { resampleComplete, type Candle } from "./sniper";

/** Same floor evaluateSniper already uses. Not lowered. */
export const INDEX_BARS_NEEDED = 60;

export type PrintLine = { i: string; t: number; v: number };

export type IndexSnap = {
  series: Series;
  index: string;
  m15: Candle[];
  h1: Candle[];
  minutes: number;
  gaps15: number;
  builtAt: number;
};

const snaps = new Map<string, IndexSnap>();

export function indexSnap(series: string): IndexSnap | null {
  return snaps.get(series) ?? null;
}
export function putIndexSnap(series: string, snap: IndexSnap): void {
  snaps.set(series, snap);
}
export function clearIndexSnaps(): void {
  snaps.clear();
}

export function indexVeto(n: number): string {
  return `15m index bars ${n}/${INDEX_BARS_NEEDED}; gaps not filled`;
}

const ZERO_POINTS = { structure: 0, liquidity: 0, flow: 0, momentum: 0, regime: 0, macro: 0, trigger: 0 };

/** A short history stays NONE. It does not score a partial setup that could open a ticket. */
export function vetoEvidence<T extends { setup: string; score: number; families: number; points: typeof ZERO_POINTS; tags: string[]; missing: string[]; eligible: boolean }>(e: T, veto: string): T {
  return { ...e, setup: "NONE", score: 0, families: 0, points: { ...ZERO_POINTS }, tags: [], missing: [veto], eligible: false };
}

export function chooseBlind(series: string): { m15: Candle[]; h1: Candle[]; veto: string | null } {
  const s = indexSnap(series);
  const n = s?.m15.length ?? 0;
  if (s && n >= INDEX_BARS_NEEDED) return { m15: s.m15, h1: s.h1, veto: null };
  return { m15: [], h1: [], veto: indexVeto(n) };
}

type Minute = { o: number; h: number; l: number; c: number; ot: number; ct: number };

/** One candle per minute that has at least one print. The still-open minute is left out. No volume. */
export function minuteCandles(prints: { t: number; v: number }[], now: number): Candle[] {
  const cur = Math.floor(now / 60_000) * 60_000;
  const byMin = new Map<number, Minute>();
  for (const p of prints) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.v) || p.v <= 0 || p.t > now) continue;
    const m = Math.floor(p.t / 60_000) * 60_000;
    if (m >= cur) continue;
    const prev = byMin.get(m);
    if (!prev) {
      byMin.set(m, { o: p.v, h: p.v, l: p.v, c: p.v, ot: p.t, ct: p.t });
      continue;
    }
    if (p.t < prev.ot) {
      prev.o = p.v;
      prev.ot = p.t;
    }
    if (p.t >= prev.ct) {
      prev.c = p.v;
      prev.ct = p.t;
    }
    if (p.v > prev.h) prev.h = p.v;
    if (p.v < prev.l) prev.l = p.v;
  }
  return [...byMin.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, x]) => ({ t, o: x.o, h: x.h, l: x.l, c: x.c }));
}

/** Closed higher bars, plus how many buckets inside the span were not complete. */
export function higherBars(minutes: Candle[], step: 15 | 60, now: number): { bars: Candle[]; gaps: number } {
  const closedMin = minutes.filter((b) => b.t + 60_000 <= now);
  const bars = resampleComplete(closedMin, step).filter((b) => b.t + step * 60_000 <= now);
  if (!closedMin.length) return { bars, gaps: 0 };
  const ms = step * 60_000;
  const buckets = new Map<number, number>();
  for (const b of closedMin) {
    const bucket = Math.floor(b.t / ms);
    if (bucket * ms + ms > now) continue;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const keys = [...buckets.keys()];
  if (!keys.length) return { bars, gaps: 0 };
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  let gaps = 0;
  for (let b = lo; b <= hi; b += 1) if ((buckets.get(b) ?? 0) !== step) gaps += 1;
  return { bars, gaps };
}

export function buildIndexSnap(series: Series, prints: { t: number; v: number }[], now: number): IndexSnap {
  const minutes = minuteCandles(prints, now);
  const m15 = higherBars(minutes, 15, now);
  const h1 = higherBars(minutes, 60, now);
  return {
    series,
    index: REFERENCE[series].index,
    m15: m15.bars,
    h1: h1.bars,
    minutes: minutes.length,
    gaps15: m15.gaps,
    builtAt: now,
  };
}

function blindSeries(): Series[] {
  return SERIES.filter((s) => RESEARCH_PRODUCT[s] == null);
}

export function snapsFromLines(lines: PrintLine[], now: number): IndexSnap[] {
  const want = new Map(blindSeries().map((s) => [REFERENCE[s].index, s]));
  const grouped = new Map<string, { t: number; v: number }[]>();
  for (const id of want.keys()) grouped.set(id, []);
  for (const line of lines) {
    const bag = grouped.get(line.i);
    if (bag) bag.push({ t: line.t, v: line.v });
  }
  return [...want.entries()].map(([id, series]) => buildIndexSnap(series, grouped.get(id) ?? [], now));
}

export function readPrintLines(dir: string): PrintLine[] {
  if (!dir) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  const out: PrintLine[] = [];
  for (const name of names) {
    let text = "";
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as { i?: unknown; t?: unknown; v?: unknown };
        if (typeof r.i === "string" && typeof r.t === "number" && typeof r.v === "number") out.push({ i: r.i, t: r.t, v: r.v });
      } catch {
        /* torn last line */
      }
    }
  }
  return out;
}

/** Price only. A volume field would be a lie, and validateBars would drop the bar. */
export function writeIndexCache(dir: string, snap: IndexSnap): void {
  mkdirSync(dir, { recursive: true });
  const dump = (bars: Candle[]) => (bars.length ? `${bars.map((b) => JSON.stringify({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })).join("\n")}\n` : "");
  writeFileSync(join(dir, `${snap.series}-15m.jsonl`), dump(snap.m15));
  writeFileSync(join(dir, `${snap.series}-60m.jsonl`), dump(snap.h1));
}

export function refreshIndexBars(opts: { printsDir?: string; outDir?: string; now?: number; lines?: PrintLine[] } = {}): IndexSnap[] {
  const now = opts.now ?? Date.now();
  const lines = opts.lines ?? readPrintLines(opts.printsDir ?? `${dataDir()}/prints`);
  const built = snapsFromLines(lines, now);
  for (const snap of built) {
    snaps.set(snap.series, snap);
    if (opts.outDir) writeIndexCache(opts.outDir, snap);
  }
  return built;
}
