/**
 * A series is shut out of one clock window only when that window's after-fee result is negative.
 * The sender does not read this. PR #9 stays shut.
 */
import { netEv, tteBucket, type DecisionRow } from "./scorecard";

export type SeriesWindow = {
  series: string;
  bucket: string;
  n: number;
  ev: number;
  excluded: boolean;
};

export function seriesWindows(rows: DecisionRow[], minN = 15): SeriesWindow[] {
  const groups = new Map<string, DecisionRow[]>();
  for (const r of rows) {
    if (r.settledYes == null) continue;
    const k = `${r.series}|${tteBucket(r.tteSec)}`;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  return [...groups.entries()]
    .map(([k, xs]) => {
      const [series, bucket] = k.split("|");
      const ev = netEv(xs);
      return { series, bucket, n: xs.length, ev, excluded: xs.length >= minN && ev < 0 };
    })
    .sort((a, b) => a.ev - b.ev);
}
