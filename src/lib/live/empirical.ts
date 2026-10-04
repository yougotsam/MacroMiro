import type { Bar } from "./types";

export type AnalogLive = {
  id: string;
  rule: string;
  n: number;
  hits: number;
  rate: number;
  source: string;
  note: string;
};

/** Statement day (meeting day 2). Source: federalreserve.gov/monetarypolicy/fomccalendars.htm */
const FOMC: string[] = [
  "2024-01-31",
  "2024-03-20",
  "2024-05-01",
  "2024-06-12",
  "2024-07-31",
  "2024-09-18",
  "2024-11-07",
  "2024-12-18",
  "2025-01-29",
  "2025-03-19",
  "2025-05-07",
  "2025-06-18",
  "2025-07-30",
  "2025-09-17",
  "2025-11-05",
  "2025-12-10",
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
];

function etDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function firstFridays(bars: Bar[]) {
  if (!bars.length) return [];
  const start = new Date(bars[0].t);
  const end = new Date(bars[bars.length - 1].t);
  const out: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur.getTime() <= end.getTime() + 864e5) {
    const d = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
    out.push(d.toISOString().slice(0, 10));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

function retOn(bars: Bar[], day: string): number | null {
  const idx = bars.findIndex((b) => etDate(b.t) === day);
  if (idx <= 0) return null;
  const prev = bars[idx - 1].c;
  const cur = bars[idx].c;
  if (!prev) return null;
  return (cur - prev) / prev;
}

function wednesdays(bars: Bar[]) {
  return bars.filter((b) => new Date(b.t).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }) === "Wed").map((b) => etDate(b.t));
}

function score(bars: Bar[], days: string[], dir: "up" | "down"): { n: number; hits: number; rate: number } {
  let n = 0;
  let hits = 0;
  for (const d of days) {
    const r = retOn(bars, d);
    if (r == null) continue;
    n += 1;
    if (dir === "down" && r < 0) hits += 1;
    if (dir === "up" && r > 0) hits += 1;
  }
  return { n, hits, rate: n ? hits / n : 0 };
}

export function analogFromDaily(packs: { gold: Bar[]; es: Bar[]; oil: Bar[]; btc: Bar[] }): AnalogLive[] {
  const nfp = firstFridays(packs.gold);
  const eiaDays = wednesdays(packs.oil);
  const nfpGold = score(packs.gold, nfp, "down");
  const fomcGold = score(packs.gold, FOMC, "down");
  const fomcEs = score(packs.es, FOMC, "down");
  const wedOil = score(packs.oil, eiaDays, "down");
  const row = (id: string, rule: string, s: { n: number; hits: number; rate: number }, note: string): AnalogLive => ({
    id,
    rule,
    n: s.n,
    hits: s.hits,
    rate: s.rate,
    source: "Yahoo daily · 2y",
    note,
  });
  return [
    row("nfp-gold-down", "First Friday → gold down", nfpGold, "NFP window. Not vs street."),
    row("fomc-gold-down", "FOMC day → gold down", fomcGold, "Statement date. No rate surprise."),
    row("fomc-es-down", "FOMC day → ES down", fomcEs, "Often priced before 14:00 ET."),
    row("wed-oil-down", "Wednesday → WTI down", wedOil, "EIA weekday. Not inventory surprise."),
  ];
}
