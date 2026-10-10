import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getPaper, setDeskMode } from "@/lib/paper/paper-fn";

export const Route = createFileRoute("/paper")({ component: PaperPage });

type C = Record<string, unknown> & { ticker: string; series: string; side: string; entryPrice: number; qty: number; availableQty: number; strike: number | null; spot: number | null; tteSec: number; structure: string; setups: string[]; confluence: number; modelProbExperimental: number; calibration: string; kalshiImplied: number; fee: number; evUsd: number; evPerContract: number; score: number; researchNote: string; deskGate: string | null; ts: string; outcome?: string | null; netUsd?: number | null };
type Cfg = { id: string; label: string; entries: number; settled: number; open: number; windows: number; wins: number; netUsd: number; feesUsd: number; ci95Usd: [number, number] | null; recent: C[] };
type Paper = { generatedAt: string; label: string; mode: { mode: string; setAt: string }; collector: Record<string, unknown>; feed: Record<string, { at: string; ticker: string | null; yesAsk: number | null; noAsk: number | null; spot: number | null; indexAgeMs: number | null; gate: string | null; stale: boolean }>; weights: Record<string, number>; ranked: C[]; configs: Cfg[]; research: { events: Record<string, unknown>[]; changedDecisions: number } } | null;

const usd = (x: number | null | undefined) => (x == null ? "open" : `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const name = (s: string) => s.replace("KX", "").replace("15M", "");

function Cand({ c }: { c: C }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="py-1 pr-2">{name(c.series)}<div className="text-muted">{c.ticker}</div></td>
      <td className="pr-2 uppercase">{c.side}</td>
      <td className="pr-2">${c.entryPrice.toFixed(3)} × {c.qty}<div className="text-muted">avail {Math.floor(c.availableQty)}</div></td>
      <td className="pr-2">{c.strike ?? "–"}<div className="text-muted">spot {c.spot ?? "–"}</div></td>
      <td className="pr-2">{Math.round(c.tteSec / 60)}m {c.tteSec % 60}s</td>
      <td className="pr-2">{c.structure}<div className="text-muted">{c.setups.join(", ") || "no setup"} · conf {c.confluence}/13</div></td>
      <td className="pr-2">{pct(c.modelProbExperimental)} <span className="text-muted">EXPERIMENTAL</span><div className="text-muted">{c.calibration}</div></td>
      <td className="pr-2">{pct(c.kalshiImplied)}</td>
      <td className="pr-2">{usd(c.evUsd)}<div className="text-muted">fee ${c.fee.toFixed(4)}</div></td>
      <td className="pr-2">{c.score}</td>
      <td className="pr-2">{c.outcome ? `${c.outcome.toUpperCase()} → ${usd(c.netUsd)}` : c.deskGate ?? "–"}</td>
    </tr>
  );
}
function Table({ rows }: { rows: C[] }) {
  if (!rows.length) return <p className="text-sm text-muted">None.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full font-mono text-xs"><thead><tr className="text-left text-muted">
      {["Market", "Side", "Entry × qty", "Strike", "Left", "Structure / setups", "Model P (side)", "Kalshi implied", "EV after fees", "Score", "Outcome / gate"].map((h) => <th key={h} className="pr-2 font-normal">{h}</th>)}
    </tr></thead><tbody>{rows.map((c, i) => <Cand key={i} c={c} />)}</tbody></table></div>
  );
}

function PaperPage() {
  const [d, setD] = useState<Paper>(null);
  const [cfg, setCfg] = useState("B_setups");
  const load = useCallback(() => void getPaper().then((t) => setD(JSON.parse(t) as Paper)), []);
  useEffect(() => { load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  const sel = d?.configs.find((c) => c.id === cfg);
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-end justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
        <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Sniper desk · paper</p><h1 className="font-display text-2xl italic">Markets, ranked candidates, paper P&amp;L</h1></div>
        <Link to="/" className="flex h-11 items-center text-sm text-muted hover:text-fg">Back to desk</Link>
      </header>
      {!d ? <p className="p-6 text-sm text-muted">No paper file yet. Run <code>npm run paper</code>.</p> : (
        <div className="grid gap-6 p-4 sm:p-6">
          <p className="rounded border border-border p-3 text-sm">{d.label} Updated {new Date(d.generatedAt).toLocaleTimeString()}.</p>
          <section aria-label="Mode" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Mode: {d.mode.mode}</h2>
            <div className="flex flex-wrap gap-2">
              {([["FULL_STANDBY", "Standby"], ["MARKET_DATA_ONLY", "Observation"], ["RESEARCH_PAPER", "Paper research"]] as const).map(([m, l]) => (
                <button key={m} type="button" className={`h-11 rounded border px-4 text-sm ${d.mode.mode === m ? "border-fg" : "border-border text-muted"}`} onClick={() => void setDeskMode({ data: { mode: m } }).then(load)}>{l}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">None of these can send a real order. Paid Firecrawl research stays off in every mode (no job approved). Collector pid {String(d.collector.pid ?? "–")}, last tick {String(d.collector.lastTickAt ?? "–")}, errors {String(d.collector.errors ?? "–")}.</p>
          </section>
          <section aria-label="Feed health" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Markets and feed health</h2>
            {Object.entries(d.feed).map(([s, f]) => (
              <p key={s} className={`border-t border-border py-1 font-mono text-xs ${f.stale ? "text-red-500" : ""}`}>{name(s)} · {f.ticker ?? "no open market"} · YES ask {f.yesAsk ?? "–"} · NO ask {f.noAsk ?? "–"} · index {f.spot ?? "–"} ({f.indexAgeMs ?? "–"} ms) · {f.stale ? "STALE/CLOSED" : "live"} · {new Date(f.at).toLocaleTimeString()}</p>
            ))}
          </section>
          <section aria-label="Ranked" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Ranked opportunities now</h2>
            <p className="mb-2 text-xs text-muted">Score = EV¢/contract × {d.weights.evCents} + confluence × {d.weights.confluencePoint} + setups × {d.weights.setupHit} + research¢ × {d.weights.researchCents}. EXPERIMENTAL ranking, not a calibrated probability.</p>
            <Table rows={d.ranked} />
          </section>
          <section aria-label="Configs" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Paper results by config (USD, after Kalshi fees, one entry per contract, $3 cap)</h2>
            {d.configs.map((c) => (
              <button key={c.id} type="button" onClick={() => setCfg(c.id)} className={`block w-full border-t border-border py-1 text-left font-mono text-xs ${cfg === c.id ? "text-fg" : "text-muted"}`}>
                {c.label}: {c.entries} entries, {c.settled} settled ({c.wins} won) over {c.windows} windows · net {usd(c.netUsd)} · fees ${c.feesUsd.toFixed(2)} · 95% {c.ci95Usd ? `${usd(c.ci95Usd[0])} to ${usd(c.ci95Usd[1])}` : "n/a"}
              </button>
            ))}
            <h3 className="mt-3 text-sm">Latest paper entries: {sel?.label}</h3>
            <Table rows={[...(sel?.recent ?? [])].reverse()} />
          </section>
          <section aria-label="Research" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Research relevance</h2>
            <p className="text-xs text-muted">Decisions changed by research (C vs B): {d.research.changedDecisions}.</p>
            {d.research.events.map((e, i) => <p key={i} className="border-t border-border py-1 font-mono text-xs">{JSON.stringify(e)}</p>)}
          </section>
        </div>
      )}
    </div>
  );
}
