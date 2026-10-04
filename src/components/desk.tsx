import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { eiaStreet, printed, seriesFor } from "@/lib/live/calendar";
import type { DeskPayload } from "@/lib/live/types";
import {
  GOLD_BOOK,
  runPipeline,
  type Fill,
  type PipelineResult,
  type Print,
  type Series,
} from "@/lib/printgate/engine";

const STEPS = ["Monitor", "Extract", "Surprise", "Rails", "Paper"] as const;

export function PrintPanel({
  desk,
  dayPnl = 0,
  openPositions = 0,
  onFill,
}: {
  desk: DeskPayload | null;
  dayPnl?: number;
  openPositions?: number;
  onFill?: (fill: Fill) => void;
}) {
  const hit = desk ? printed(desk.calendar) ?? eiaStreet(desk.calendar) : undefined;
  const street = hit;
  const [seriesId, setSeriesId] = useState(GOLD_BOOK.series[0].id);
  const series = GOLD_BOOK.series.find((s) => s.id === seriesId) ?? GOLD_BOOK.series[0];
  const [consensus, setConsensus] = useState("");
  const [printValue, setPrintValue] = useState("");
  const [tape, setTape] = useState<PipelineResult[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const last = tape[0] ?? null;
  const activeStep = useMemo(() => stepIndex(last), [last]);

  const livePx =
    series.instrument === "CL"
      ? desk?.snapshot.oil
      : series.instrument === "GC"
        ? desk?.snapshot.gold
        : series.instrument === "ES"
          ? desk?.snapshot.es
          : desk?.snapshot.btc;

  useEffect(() => {
    if (!street) return;
    const sid = seriesFor(street.name);
    if (sid) setSeriesId(sid);
    if (street.forecast != null && consensus === "") setConsensus(String(street.forecast));
    if (street.actual != null && printValue === "") setPrintValue(String(street.actual));
  }, [street, consensus, printValue]);

  function fire(consOverride?: number | null) {
    const raw = printValue.trim();
    if (raw === "") return;
    const value = Number(raw);
    const consRaw = consOverride !== undefined ? consOverride : consensus.trim() === "" ? null : Number(consensus);
    if (!Number.isFinite(value)) return;
    const prints: Print[] = [
      {
        seriesId: series.id,
        printValue: value,
        sourceUrl: series.urls[0],
        unit: series.unit,
        confidence: "high",
        passage: `${series.name} print ${value}`,
      },
      {
        seriesId: series.id,
        printValue: value,
        sourceUrl: series.urls[1],
        unit: series.unit,
        confidence: "high",
        passage: `${series.name} confirm ${value}`,
      },
    ];
    const result = runPipeline({
      book: GOLD_BOOK,
      seriesId: series.id,
      prints,
      consensus: consRaw,
      openPositions: openPositions + fills.length,
      dayPnl,
      lastPrice: livePx,
      empirical: desk?.analogs,
    });
    setTape((t) => [result, ...t].slice(0, 12));
    if (result.fill) {
      setFills((f) => [result.fill!, ...f]);
      onFill?.(result.fill);
    }
  }

  return (
    <main className="grid gap-4 px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:px-8 md:py-6">
      <section className="min-w-0 rounded-md border border-border bg-card p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Street</h2>
          {last ? (
            <Badge tone={last.verdict === "arm" ? "armed" : "down"}>{last.verdict}</Badge>
          ) : (
            <Badge>idle</Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          Street from the calendar. Fill is live {series.instrument}.
        </p>
        <ol className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-5">
          {STEPS.map((label, i) => (
            <li
              key={label}
            className={`flex items-center gap-3 rounded-md border px-3 py-3 sm:flex-col sm:text-center sm:px-2 ${
                i <= activeStep ? "border-accent/40 bg-secondary text-fg" : "border-border text-subtle"
              }`}
            >
              <span className="font-mono text-xs">{String(i + 1).padStart(2, "0")}</span>
              <p className="text-xs">{label}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Print" value={last ? String(last.prints[0]?.printValue ?? "—") : "—"} />
          <Stat
            label="Surprise"
            value={last?.surprise ? `${last.surprise.pct >= 0 ? "+" : ""}${last.surprise.pct.toFixed(2)}%` : "—"}
          />
          <Stat label="Side" value={last?.side ? last.side.toUpperCase() : "FLAT"} />
        </div>
        <p className="mt-5 font-mono text-sm text-muted">
          {last?.reason ?? "Enter the official print. Street is consensus."}
        </p>
        {last?.analog ? (
          <p className="mt-2 text-sm text-muted">
            {last.analog.rule} · p {last.analog.usedP.toFixed(2)} {last.analog.source} n={last.analog.n}
          </p>
        ) : null}
        {last?.fill ? (
          <div className="mt-5 rounded-[var(--radius-lg)] border border-armed/30 bg-bg p-4">
            <p className="text-xs uppercase tracking-wide text-subtle">Paper fill @ live last</p>
            <p className="mt-1 font-mono text-lg tabular-nums">
              {last.fill.side.toUpperCase()} {last.fill.qty} {last.fill.instrument} @ {last.fill.price}
            </p>
          </div>
        ) : null}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th className="py-2 font-medium">Verdict</th>
                <th className="py-2 font-medium">Surprise</th>
                <th className="py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {tape.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-muted">
                    Empty.
                  </td>
                </tr>
              ) : (
                tape.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-3 font-mono text-xs uppercase">{row.verdict}</td>
                    <td className="py-3 font-mono tabular-nums">
                      {row.surprise ? `${row.surprise.pct.toFixed(2)}%` : "—"}
                    </td>
                    <td className="py-3 text-muted break-words">{row.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="min-w-0 flex flex-col gap-4">
        <section className="rounded-md border border-border bg-card p-4 md:p-6">
          <h2 className="text-sm font-medium">Official print</h2>
          {street ? (
            <p className="mt-2 text-sm text-muted">
              {street.name} {new Date(street.time).toLocaleString("en-US", { timeZone: "America/New_York" })} ET ·
              street {String(street.forecast ?? "—")} · prior {String(street.previous ?? "—")}
              {street.actual != null ? ` · actual ${String(street.actual)}` : ""}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">No print in this window.</p>
          )}
          <label className="mt-4 block text-xs uppercase tracking-wide text-subtle">Series</label>
          <select
            className="mt-2 h-11 w-full rounded-md border border-border bg-bg px-3 text-base"
            value={seriesId}
            onChange={(e) => setSeriesId(e.target.value)}
          >
            {GOLD_BOOK.series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <SeriesMeta series={series} livePx={livePx} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-subtle">Street</label>
              <Input className="mt-2 font-mono" inputMode="decimal" value={consensus} onChange={(e) => setConsensus(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-subtle">Actual</label>
              <Input className="mt-2 font-mono" inputMode="decimal" value={printValue} onChange={(e) => setPrintValue(e.target.value)} />
            </div>
          </div>
          <Button className="mt-4 w-full" onClick={() => fire()}>
            Run gate
          </Button>
          {street?.actual != null ? (
            <Button
              className="mt-2 w-full"
              variant="secondary"
              onClick={() => {
                setPrintValue(String(street.actual));
                if (street.forecast != null) setConsensus(String(street.forecast));
                const sid = seriesFor(street.name);
                if (sid) setSeriesId(sid);
              }}
            >
              Load {street.name} actual {String(street.actual)}
            </Button>
          ) : null}
          <Button className="mt-2 w-full" variant="ghost" onClick={() => fire(null)}>
            Fire without street
          </Button>
        </section>
        <section className="rounded-md border border-border bg-card p-4 md:p-6">
          <h2 className="text-sm font-medium">Open paper</h2>
          {fills.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No fills.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {fills.map((f) => (
                <li key={f.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <p className="font-mono text-sm tabular-nums">
                    {f.side.toUpperCase()} {f.qty} {f.instrument} @ {f.price}
                  </p>
                  <p className="text-xs text-muted">{f.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <p className="text-xs uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums">{value}</p>
    </div>
  );
}

function SeriesMeta({ series, livePx }: { series: Series; livePx?: number }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-muted">
      <div>
        <dt className="uppercase tracking-wide text-subtle">Instrument</dt>
        <dd className="font-mono text-fg">{series.instrument}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-subtle">Map</dt>
        <dd className="font-mono text-fg">
          {series.sideIfPrintAbove ? `above → ${series.sideIfPrintAbove}` : "none"}
        </dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-subtle">Live last</dt>
        <dd className="font-mono text-fg">{livePx != null ? livePx.toFixed(2) : "—"}</dd>
      </div>
      <div>
        <dt className="uppercase tracking-wide text-subtle">Min surprise</dt>
        <dd className="font-mono text-fg">{series.minAbsSurprisePct}%</dd>
      </div>
    </dl>
  );
}

function stepIndex(last: PipelineResult | null): number {
  if (!last) return -1;
  if (last.fill) return 4;
  if (last.railsLog.includes("rails_clear") || last.verdict === "block") {
    if (!last.surprise) return 1;
    return last.verdict === "arm" ? 4 : 3;
  }
  if (last.surprise) return 2;
  return 1;
}
