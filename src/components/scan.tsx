import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Fail, Quiet } from "@/components/fail";
import type { ScanAction, ScanPayload, ScanRow } from "@/lib/scan/types";
import { cn } from "@/lib/utils";

const ACTION: Record<ScanAction, string> = {
  scan: "SCAN",
  cancel: "CANCEL",
  watch: "WATCH",
};

export function ScanPanel({ onPaper }: { onPaper?: (row: ScanRow) => void }) {
  const [data, setData] = useState<ScanPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<ScanAction | "all">("all");
  const [busy, setBusy] = useState(false);
  const [pingNote, setPingNote] = useState<string | null>(null);

  const load = useCallback(async (fresh = false, silent = false) => {
    if (!silent) setBusy(true);
    try {
      const res = await fetch(fresh ? "/api/live/scan?fresh=1" : "/api/live/scan");
      if (!res.ok) throw new Error(`scan ${res.status}`);
      setData((await res.json()) as ScanPayload);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "scan failed");
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.hidden) return;
      void load(false, true);
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return filter === "all" ? data.rows : data.rows.filter((r) => r.action === filter);
  }, [data, filter]);

  if (err) return <Fail message={`Scan failed: ${err}.`} />;
  if (!data) return <Quiet message="Scanning Poly + Binance + DexScreener…" />;

  return (
    <main className="px-4 py-4 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-sm border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
          <p className="font-mono text-xs text-subtle">
            Gamma + Dex + Jup + Poly US · clip ${data.clipUsd} · {data.scanN} scan · {data.cancelN} cancel
            {data.basisPct != null ? ` · BTC basis ${(data.basisPct * 100).toFixed(3)}%` : ""}
            {data.solUsd != null ? ` · SOL ${data.solUsd.toFixed(2)}` : ""}
            {data.jupUsd != null ? ` · Jup ${data.jupUsd.toFixed(2)}` : ""}
            {data.fair
              ? ` · >$${data.fair.strike.toLocaleString()} YES ${data.fair.yes.toFixed(2)} fair ${data.fair.fair.toFixed(2)}`
              : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {(["all", "scan", "watch", "cancel"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "h-11 min-w-11 px-3 text-sm rounded-md",
                  filter === f ? "bg-primary text-primary-foreground" : "text-muted hover:bg-secondary",
                )}
              >
                {f}
              </button>
            ))}
            <Button variant="secondary" onClick={() => void load(true)} disabled={busy}>
              Reload
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setPingNote(null);
                try {
                  const res = await fetch("/api/live/telegram", { method: "POST" });
                  const json = (await res.json()) as { ok?: boolean; reason?: string; error?: string };
                  setPingNote(json.ok ? "sent" : json.error || json.reason || "failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ping Zeebs
            </Button>
            {pingNote ? <span className="font-mono text-xs text-subtle">{pingNote}</span> : null}
          </div>
        </header>

        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <ScanLine key={r.id} row={r} onPaper={onPaper} />
          ))}
        </ul>

        <footer className="grid gap-3 border-t border-border px-3 py-3 sm:grid-cols-3 sm:px-4">
          {data.modules.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2">
              <p className="text-sm">
                {m.name}
                <span className="ml-2 font-mono text-xs text-subtle">{m.detail}</span>
              </p>
              <Badge tone={m.state === "down" ? "down" : m.state === "filtering" ? "paper" : "armed"}>{m.state}</Badge>
            </div>
          ))}
        </footer>
      </section>
    </main>
  );
}

function ScanLine({ row, onPaper }: { row: ScanRow; onPaper?: (row: ScanRow) => void }) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "font-mono text-xs",
            row.action === "cancel" && "text-down",
            row.action === "scan" && "text-armed",
          )}
        >
          {ACTION[row.action]}
        </span>
        <span className="font-mono text-xs tabular-nums text-subtle">
          {row.price == null ? "—" : row.price >= 10 ? row.price.toFixed(2) : row.price.toFixed(3)}
        </span>
      </div>
      <p className="mt-1 text-sm">{row.market}</p>
      <p className="font-mono text-xs text-subtle">
        {row.venue} · {new Date(row.ts).toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" })} ET · {row.note}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 min-w-11 items-center px-3 text-sm text-subtle hover:text-fg"
          >
            Open
          </a>
        ) : null}
        {onPaper && row.action === "scan" ? (
          <button type="button" className="h-11 min-w-11 px-3 text-sm rounded-md bg-secondary" onClick={() => onPaper(row)}>
            Paper
          </button>
        ) : null}
      </div>
    </li>
  );
}
