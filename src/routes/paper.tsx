import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getPaper, setDeskMode } from "@/lib/paper/paper-fn";

export const Route = createFileRoute("/paper")({ component: PaperPage });

type C = Record<string, unknown> & { dir?: string; ticker: string; series: string; side: string; entryPrice: number; qty: number; availableQty: number; strike: number | null; spot: number | null; tteSec: number; structure: string; setups: string[]; confluence: number | null; confluenceState: string; confluencePoints: Record<string, number> | null; coreEligible9: boolean; wouldEnter?: string[]; reason?: string; spread: number | null; modelProbExperimental: number; calibration: string; kalshiImplied: number; fee: number; evUsd: number; evPerContract: number; score: number; researchNote: string; deskGate: string | null; ts: string; outcome?: string | null; netUsd?: number | null };
type Cfg = { id: string; label: string; portfolio: { accepted: number; settled: number; wins: number; netUsd: number; feesUsd: number; rejectReasons: Record<string, number>; openExposureUsd: number; todayRealizedUsd: number; dailyLossRemainingUsd: number }; why: Record<string, number | null>; entries: number; settled: number; open: number; windows: number; wins: number; netUsd: number; feesUsd: number; ci95Usd: [number, number] | null; recent: C[] };
type Paper = { generatedAt: string; label: string; mode: { mode: string; setAt: string }; collector: Record<string, unknown>; feed: Record<string, { at: string; ticker: string | null; yesAsk: number | null; noAsk: number | null; spot: number | null; indexAgeMs: number | null; gate: string | null; stale: boolean }>; weights: Record<string, number>; ranked: C[]; configs: Cfg[]; research: { events: Record<string, unknown>[]; changedDecisions: number } } | null;

const usd = (x: number | null | undefined) => (x == null ? "open" : `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const name = (s: string) => s.replace("KX", "").replace("15M", "");

function Cand({ c }: { c: C }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="py-1 pr-2">{name(c.series)}<div className="text-neutral-300">{c.ticker}</div></td>
      <td className="pr-2 uppercase">{c.side}</td>
      <td className="pr-2">${c.entryPrice.toFixed(3)} × {c.qty}<div className="text-neutral-300">depth {Math.floor(c.availableQty)} · spread {c.spread ?? "–"}</div></td>
      <td className="pr-2">{c.strike ?? "–"}<div className="text-neutral-300">spot {c.spot ?? "–"}</div></td>
      <td className="pr-2">{Math.round(c.tteSec / 60)}m {c.tteSec % 60}s</td>
      <td className="pr-2">{c.structure}<div className="text-neutral-300">{c.setups.join(", ") || "no setup"} · {c.dir ?? ""}</div><div className={c.confluenceState === "VALID_SCORE" ? "text-emerald-300" : "text-amber-300"}>13-pt: {c.confluence == null ? c.confluenceState : `${c.confluence}/13 (${c.confluenceState})`}{c.coreEligible9 ? " · CORE 9+" : ""}</div>{c.confluencePoints ? <div className="text-neutral-400">{Object.entries(c.confluencePoints).map(([k, v]) => `${k} ${v}`).join(" · ")}</div> : null}</td>
      <td className="pr-2">{pct(c.modelProbExperimental)} <span className="text-neutral-300">EXPERIMENTAL</span><div className="text-neutral-300">{c.calibration}</div></td>
      <td className="pr-2">{pct(c.kalshiImplied)}</td>
      <td className="pr-2">{usd(c.evUsd)}<div className="text-neutral-300">fee ${c.fee.toFixed(4)}</div></td>
      <td className="pr-2"><span className="rounded bg-sky-900 px-1 text-sky-100">rank {c.score}</span><div className="text-neutral-400">experimental, not 13-pt</div></td>
      <td className="pr-2">{c.outcome ? <span className={(c.netUsd ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}>{c.outcome.toUpperCase()} → {usd(c.netUsd)}</span> : <span>{c.reason ?? c.deskGate ?? "–"}</span>}{c.wouldEnter?.length ? <div className="text-emerald-300">enters: {c.wouldEnter.join(", ")}</div> : null}<div className="text-neutral-400">desk gate: {c.deskGate ?? "–"}</div></td>
    </tr>
  );
}
function Table({ rows }: { rows: C[] }) {
  if (!rows.length) return <p className="text-sm text-neutral-300">None.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full font-mono text-xs"><thead><tr className="text-left text-neutral-300">
      {["Market", "Side", "Entry × qty", "Strike", "Left", "Structure / setups", "Model P (side)", "Kalshi implied", "EV after fees", "Rank (experimental)", "Decision / outcome"].map((h) => <th key={h} className="pr-2 font-normal">{h}</th>)}
    </tr></thead><tbody>{rows.map((c, i) => <Cand key={i} c={c} />)}</tbody></table></div>
  );
}

function PaperPage() {
  const [d, setD] = useState<Paper>(null);
  const [cfg, setCfg] = useState("C_time_ranked");
  const load = useCallback(() => void getPaper().then((t) => setD(JSON.parse(t) as Paper)), []);
  useEffect(() => { load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  const sel = d?.configs.find((c) => c.id === cfg);
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-end justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
        <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">Sniper desk · paper</p><h1 className="font-display text-2xl italic">Markets, ranked candidates, paper P&amp;L</h1></div>
        <Link to="/" className="flex h-11 items-center text-sm text-neutral-300 hover:text-fg">Back to desk</Link>
      </header>
      {!d ? <p className="p-6 text-sm text-neutral-300">No paper file yet. Run <code>npm run paper</code>.</p> : (
        <div className="grid gap-6 p-4 sm:p-6">
          <p role="alert" className="rounded border-2 border-amber-500 bg-amber-950 p-3 text-base font-semibold text-amber-100">This page is paper. It does not send. Live 15-minute orders use the desk engine. Live perpetuals use the margin button. CALIBRATED_MODEL_APPROVED is true.</p>
          <p className="rounded border border-border p-3 text-sm">{d.label} Updated {new Date(d.generatedAt).toLocaleTimeString()}.</p>
          <section aria-label="Mode" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Research mode: {d.mode.mode === "RESEARCH_PAPER" ? "PAPER_RESEARCH" : d.mode.mode === "MARKET_DATA_ONLY" ? "OBSERVATION" : "STANDBY"}</h2>
            <p className="mb-2 text-sm"><span className="rounded bg-emerald-900 px-2 py-0.5 text-emerald-100">Kalshi collection: {d.collector.lastTickAt && Date.now() - Date.parse(String(d.collector.lastTickAt)) < 120_000 ? "RUNNING" : "NOT RUNNING"}</span> <span className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-100">Paid Firecrawl research: OFF (standby, 0 credits)</span> <span className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-100">Paper engine: {Date.now() - Date.parse(d.generatedAt) < 180_000 ? "RUNNING" : "STALE"}</span></p>
            <div className="flex flex-wrap gap-2">
              {([["FULL_STANDBY", "STANDBY"], ["MARKET_DATA_ONLY", "OBSERVATION"], ["RESEARCH_PAPER", "PAPER_RESEARCH"]] as const).map(([m, l]) => (
                <button key={m} type="button" className={`h-11 rounded border px-4 text-sm ${d.mode.mode === m ? "border-fg" : "border-border text-neutral-300"}`} onClick={() => void setDeskMode({ data: { mode: m } }).then(load)}>{l}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-300">None of these can send a real order. Paid Firecrawl research stays off in every mode (no job approved). Collector pid {String(d.collector.pid ?? "–")}, last tick {String(d.collector.lastTickAt ?? "–")}, errors {String(d.collector.errors ?? "–")}.</p>
          </section>
          <section aria-label="Feed health" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Markets and feed health</h2>
            {Object.entries(d.feed).map(([s, f]) => (
              <p key={s} className={`border-t border-border py-1 font-mono text-xs ${f.stale ? "text-red-500" : ""}`}>{name(s)} · {f.ticker ?? "no open market"} · YES ask {f.yesAsk ?? "–"} · NO ask {f.noAsk ?? "–"} · index {f.spot ?? "–"} ({f.indexAgeMs ?? "–"} ms) · {f.stale ? "STALE/CLOSED" : "live"} · {new Date(f.at).toLocaleTimeString()}</p>
            ))}
          </section>
          <section aria-label="Ranked" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Ranked opportunities now</h2>
            <p className="mb-2 text-xs text-neutral-300">Score = EV¢/contract × {d.weights.evCents} + confluence × {d.weights.confluencePoint} + setups × {d.weights.setupHit} + research¢ × {d.weights.researchCents}. EXPERIMENTAL ranking, not a calibrated probability.</p>
            <Table rows={d.ranked} />
          </section>
          <section aria-label="Configs" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Old paper replay. Not the live perpetual plan.</h2>
            {d.configs.map((c) => (
              <button key={c.id} type="button" onClick={() => setCfg(c.id)} className={`block w-full border-t border-border py-1 text-left font-mono text-xs ${cfg === c.id ? "text-fg" : "text-neutral-300"}`}>
                <span className="text-fg">{c.label}</span><br />Unrestricted: {c.entries} entries, {c.settled} settled ({c.wins} won), {c.windows} windows, net <span className={c.netUsd >= 0 ? "text-emerald-300" : "text-red-300"}>{usd(c.netUsd)}</span>, fees ${c.feesUsd.toFixed(2)} · Realistic portfolio ($3/$9/$4/−$15): {c.portfolio.accepted} taken, {c.portfolio.wins} won, net <span className={c.portfolio.netUsd >= 0 ? "text-emerald-300" : "text-red-300"}>{usd(c.portfolio.netUsd)}</span>, open ${c.portfolio.openExposureUsd.toFixed(2)}, daily loss remaining ${c.portfolio.dailyLossRemainingUsd.toFixed(2)}
              </button>
            ))}
            <h3 className="mt-3 text-sm">Latest paper entries: {sel?.label}</h3>
            <Table rows={[...(sel?.recent ?? [])].reverse()} />
          </section>
          <section aria-label="Research" className="rounded border border-border p-4">
            <h2 className="mb-2 text-lg">Research relevance</h2>
            <p className="text-xs text-neutral-300">Decisions changed by pre-entry research (E vs C): {d.research.changedDecisions}.</p>
            {d.research.events.map((e, i) => <p key={i} className="border-t border-border py-1 font-mono text-xs">{JSON.stringify(e)}</p>)}
          </section>
        </div>
      )}
    </div>
  );
}
