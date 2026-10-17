import { useEffect, useState } from "react";

type Row = {
  ticker: string;
  question: string;
  option: string;
  sector: string;
  mode: string;
  yesAsk: number | null;
  target: number | null;
  multiple: number | null;
  bracketGap: number | null;
  winProbability: "UNKNOWN";
};

type Payload = {
  sendsOrders: boolean;
  error: string | null;
  rows: Row[];
  seed: string | null;
  positions: number | null;
  ledger: { preset: number | "live"; shownCash: number; rung: { name: string; from: number; to: number; progress: number }; flips: { ticker: string; status: string }[] };
};

const FILTERS = ["all", "tech", "sports", "culture", "macro", "crypto", "perps"] as const;
const cents = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}¢`);

export function SideQuest() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function load(ticker?: string) {
    const q = ticker ? `?ticker=${encodeURIComponent(ticker)}` : "";
    const res = await fetch(`/api/live/omni${q}`);
    if (!res.ok) throw new Error(`omni ${res.status}`);
    setData((await res.json()) as Payload);
  }

  useEffect(() => {
    load().catch((e) => setErr(e instanceof Error ? e.message : "omni failed"));
  }, []);

  async function markShadow(row: Row) {
    setNote("");
    const res = await fetch("/api/live/omni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "shadow", ticker: row.ticker, question: row.question, mode: row.mode, side: "YES", entry: row.yesAsk, target: row.target, multiple: row.multiple }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; sendsOrders?: boolean };
    if (!res.ok) setNote(res.status === 403 ? "Shadow note refused. Desk token missing. No order was sent." : (body.error ?? `shadow ${res.status}`));
    else setNote("Shadow note saved. No order was sent.");
    await load(row.ticker);
  }

  const rows = (data?.rows ?? []).filter((r) => filter === "all" || r.sector === filter || (filter === "crypto" && r.mode === "fifteen"));

  return (
    <div className="mx-auto grid max-w-5xl gap-3 px-3 py-3 text-sm text-zinc-200 sm:px-4">
      <p className="rounded border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-amber-100">
        Live send is off. This board ranks prices. It does not know the win rate. A shadow note is not an order.
      </p>
      {err ? <p className="text-rose-300">{err}</p> : null}
      {data?.error ? <p className="text-zinc-400">Board: {data.error}</p> : null}
      {data ? (
        <p className="font-mono text-xs text-zinc-400">
          Tracked ${data.ledger.shownCash.toFixed(0)} · preset {String(data.ledger.preset)} · Kalshi positions {data.positions ?? "—"} · rung {data.ledger.rung.name} ${data.ledger.rung.from}→${data.ledger.rung.to} · {Math.round(data.ledger.rung.progress * 100)}% · shadow flips {data.ledger.flips.length}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded px-2 py-1 text-xs ${filter === f ? "bg-cyan-900 text-cyan-100" : "bg-zinc-900 text-zinc-400"}`}>
            {f}
          </button>
        ))}
      </div>
      {rows[0] ? (
        <button type="button" className="w-fit rounded bg-emerald-900 px-3 py-1 text-xs text-emerald-100" onClick={() => markShadow(rows[0]).catch((e) => setErr(String(e)))}>
          Mark top row as a shadow note
        </button>
      ) : null}
      {note ? <p className="text-xs text-zinc-300">{note}</p> : null}
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full text-left font-mono text-xs">
          <thead className="text-zinc-500">
            <tr><th className="px-2 py-1">Question</th><th>Mode</th><th>Ask</th><th>Target</th><th>x</th><th>Gap</th><th>P</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => (
              <tr key={r.ticker} className="border-t border-zinc-800">
                <td className="px-2 py-1">
                  <button type="button" className="text-left text-cyan-200" onClick={() => { setPick(r.ticker); load(r.ticker).catch((e) => setErr(String(e))); }}>
                    {r.question} · {r.option}
                  </button>
                </td>
                <td>{r.mode}</td>
                <td>{cents(r.yesAsk)}</td>
                <td>{cents(r.target)}</td>
                <td>{r.multiple ?? "—"}</td>
                <td>{r.bracketGap ?? "—"}</td>
                <td>{r.winProbability}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pick && data?.seed ? (
        <pre className="whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">{data.seed}</pre>
      ) : null}
      <p className="text-xs text-zinc-500">{data?.note}</p>
    </div>
  );
}
