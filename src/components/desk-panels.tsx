import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BROKERS, type BrokerChoice } from "@/lib/printgate/broker";
import type { AnalogLive } from "@/lib/live/empirical";
import type { BookId, DeskPayload } from "@/lib/live/types";
import { cn } from "@/lib/utils";

type InboxEvent = {
  id: string;
  type: string;
  url?: string;
  eventClass?: string;
  printValue?: number | null;
  judgment?: string;
  receivedAt?: string;
};

export function liveAnalog(desk: DeskPayload | null): AnalogLive | null {
  if (!desk) return null;
  const next = (desk.next?.name ?? "").toLowerCase();
  const rows = desk.analogs;
  const hit = rows.find((row) => {
    if (row.id.includes("nfp") && next.includes("payroll")) return true;
    if (row.id.includes("cpi") && next.includes("cpi")) return true;
    if (row.id.includes("fomc") && (next.includes("fomc") || next.includes("fed") || next.includes("rate"))) return true;
    if ((row.id.includes("wed") || row.id.includes("eia")) && next.includes("eia")) return true;
    return false;
  });
  return hit ?? rows.find((r) => r.n >= 8) ?? rows[0] ?? null;
}

export function InboxCompact() {
  const [events, setEvents] = useState<InboxEvent[]>([]);
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/firecrawl/inbox");
    if (!res.ok) return;
    const data = (await res.json()) as { events: InboxEvent[] };
    setEvents(data.events);
  }, []);

  const pull = useCallback(async () => {
    setPulling(true);
    setPullNote(null);
    try {
      const res = await fetch("/api/firecrawl/pull", { method: "POST" });
      const data = (await res.json()) as { live?: boolean; events?: InboxEvent[]; errors?: string[] };
      setLive(!!data.live);
      await refresh();
      const n = data.events?.length ?? 0;
      const err = (data.errors ?? []).slice(0, 2).join(" · ");
      setPullNote(n ? `${n} hits` + (err ? ` · ${err}` : "") : err || "quiet");
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  useEffect(() => {
    void fetch("/api/firecrawl/inbox")
      .then((r) => r.json())
      .then((d: { events?: InboxEvent[] }) => setEvents(d.events ?? []))
      .catch(() => setEvents([]));
  }, []);

  return (
    <section className="min-w-0 rounded-sm border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Inbox</h2>
        <Badge tone={live ? "armed" : "neutral"}>{live ? "FC live" : "FC off"}</Badge>
      </div>
      <button
        type="button"
        onClick={() => void pull()}
        disabled={pulling || !live}
        className="mt-3 h-11 w-full rounded-sm border border-border text-sm hover:bg-secondary disabled:opacity-40"
      >
        {pulling ? "Pulling…" : "Pull official"}
      </button>
      {pullNote ? <p className="mt-2 font-mono text-xs text-subtle">{pullNote}</p> : null}
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Quiet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {events.slice(0, 6).map((e) => (
            <li key={e.id} className="border-t border-border pt-2 font-mono text-xs break-words">
              <span className="text-fg">{e.type}</span>
              {e.eventClass ? <span className="text-muted"> · {e.eventClass}</span> : null}
              {e.printValue != null ? <span> · {e.printValue}</span> : null}
              <p className="mt-1 text-muted">{e.judgment || e.url}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CatalystRadar() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reaction, setReaction] = useState("");
  const [open, setOpen] = useState("verify");
  const jobs = [
    ["hunter", "What is coming", "The next macro date that can matter."],
    ["verify", "Is it official", "Only the BLS page and the Fed calendar."],
    ["contradict", "Is it exaggerated", "A date on a calendar is not a direction."],
    ["analogue", "Spark note", "Not a vote. It does not send the order."],
    ["contract", "Did the rule change", "Kalshi wording and the BRTI page."],
  ] as const;
  const [runs, setRuns] = useState<{ name: string; phase?: string; headline?: string; credits?: number | null; quotes?: string[]; urls?: string[] }[]>([]);

  const [sparkLine, setSparkLine] = useState("");

  const loadIntel = useCallback(async () => {
    const res = await fetch("/api/firecrawl/intel");
    if (!res.ok) return;
    const data = (await res.json()) as {
      reaction?: { line?: string } | null;
      runs?: Record<string, { record?: { headline?: string; phase?: string; experimentalProbabilityDelta?: number | null; probabilityDeltaReason?: string; creditsUsed?: number | null; sparkJobIds?: string[]; directQuotes?: string[]; sourceUrls?: string[] }; shadow?: { reason?: string }; trace?: { type?: string }[]; quotes?: string[]; urls?: string[]; error?: string }>;
    };
    setReaction(data.reaction?.line ?? "");
    const list = Object.entries(data.runs ?? {}).map(([name, row]) => ({
      name,
      phase: row.record?.phase,
      headline: row.record?.headline,
      credits: row.record?.creditsUsed,
      quotes: row.quotes ?? row.record?.directQuotes ?? [],
      urls: row.urls ?? row.record?.sourceUrls ?? [],
    }));
    setRuns(list);
    const note = await fetch("/api/firecrawl/radar").then((r) => (r.ok ? r.json() : null)).catch(() => null) as { sparkCard?: { event?: string; quote?: string; bias?: string } | null; spark?: string } | null;
    const card = note?.sparkCard;
    setSparkLine(card?.event ? `${card.event}${card.quote ? ` — “${card.quote}”` : ""}` : note?.spark || "");
  }, []);

  useEffect(() => {
    void loadIntel();
  }, [loadIntel]);

  return (
    <section className="mt-3 rounded-sm border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Context</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">Five questions about the next macro print. They do not produce a trade probability, and none of them can place an order. Price history under this is measured.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setBusy(true);
            void fetch("/api/firecrawl/intel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: true }) })
              .then(() => loadIntel())
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-secondary disabled:opacity-40"
        >
          {busy ? "Working…" : "Update trace"}
        </button>
      </div>
      {sparkLine ? <p className="mt-4 max-w-prose text-base leading-relaxed text-fg">{sparkLine}</p> : null}
      {reaction ? <p className="mt-4 max-w-prose text-base leading-relaxed text-fg">{reaction}</p> : <p className="mt-4 text-sm text-muted">No measured price reaction yet.</p>}
      <div className="mt-4 grid gap-2 md:grid-cols-5">
        {jobs.map(([name, title, blurb]) => {
          const row = runs.find((item) => item.name === name);
          const on = open === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setOpen(name)}
              className={`min-h-28 rounded-sm border p-3 text-left hover:bg-secondary ${on ? "border-primary bg-secondary" : "border-border bg-background"}`}
            >
              <p className="font-mono text-xs uppercase tracking-widest text-primary">{title}</p>
              <p className="mt-2 text-sm text-fg">{blurb}</p>
              <p className="mt-2 font-mono text-xs text-subtle">{row?.phase || "not run"} · {row?.credits ?? "—"} credits</p>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setBusy(true);
            void fetch("/api/firecrawl/intel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow: open }) })
              .then(() => loadIntel())
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className="h-11 rounded-sm bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Working…" : `Run ${open}`}
        </button>
        <button
          type="button"
          onClick={() => {
            void fetch("/api/firecrawl/intel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cancel: true, workflow: open }) }).then(() => loadIntel());
          }}
          className="h-11 rounded-sm border border-border px-3 text-sm hover:bg-secondary"
        >
          Cancel {open}
        </button>
      </div>
      {err ? <p className="mt-2 text-sm text-down">{err}</p> : null}
      <p className="mt-2 text-sm text-muted">
        {runs.find((row) => row.name === open)?.headline || "Pick a check, then run it. The old result stays until the new one finishes."}
      </p>
      {(runs.find((row) => row.name === open)?.quotes ?? []).slice(0, 3).map((q) => (
        <p key={q} className="mt-2 text-sm text-muted">{q}</p>
      ))}
    </section>
  );
}

export function CalendarCompact({ desk }: { desk: DeskPayload | null }) {
  return (
    <section className="min-w-0 rounded-sm border border-border bg-card p-4">
      <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Calendar</h2>
      <ul className="mt-3 space-y-2">
        {(desk?.calendar ?? []).slice(0, 8).map((ev) => (
          <li key={ev.id} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm">{ev.name}</p>
              <Badge tone={ev.importance === "high" ? "down" : "neutral"}>{ev.currency}</Badge>
            </div>
            <p className="mt-1 font-mono text-xs text-subtle">
              {new Date(ev.time).toLocaleString("en-US", { timeZone: "America/New_York" })} ET · forecast {ev.forecast ?? "—"} ·
              prior {ev.previous ?? "—"} · actual {ev.actual ?? "—"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AnalogPanel({
  desk,
  onPickBook,
}: {
  desk: DeskPayload | null;
  onPickBook?: (id: BookId) => void;
}) {
  const next = (desk?.next?.name ?? "").toLowerCase();
  const rows = desk?.analogs ?? [];
  return (
    <section className="@container min-w-0 rounded-sm border border-border bg-card p-4 sm:p-6">
      <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Analogs</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Yahoo 2y. Close vs prior close on the event day. n under 20 is thin.
        {desk?.next ? ` Next: ${desk.next.name}.` : ""}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="py-2 font-medium">Rule</th>
              <th className="py-2 font-medium">Hits</th>
              <th className="py-2 font-medium">n</th>
              <th className="py-2 font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const live =
                (row.id.includes("nfp") && next.includes("payroll")) ||
                (row.id.includes("cpi") && next.includes("cpi")) ||
                (row.id.includes("fomc") && (next.includes("fomc") || next.includes("fed") || next.includes("rate"))) ||
                (row.id.includes("wed") && next.includes("eia"));
              return (
                <tr
                  key={row.id}
                  className={cn("border-t border-border", live && "bg-surface-2", onPickBook && "cursor-pointer")}
                  onClick={() => {
                    if (!onPickBook) return;
                    if (/gold|GC/i.test(row.rule + row.note)) onPickBook("gold");
                    else if (/oil|CL|crude/i.test(row.rule + row.note)) onPickBook("oil");
                    else if (/ES|S&P/i.test(row.rule + row.note)) onPickBook("es");
                    else if (/BTC|bitcoin/i.test(row.rule + row.note)) onPickBook("btc");
                  }}
                >
                  <td className="py-3 pr-4">
                    <p>{row.rule}</p>
                    <p className="mt-1 max-w-prose text-xs text-subtle">{row.note}</p>
                  </td>
                  <td className="py-3 font-mono tabular-nums">{row.hits}</td>
                  <td className="py-3 font-mono tabular-nums">{row.n}</td>
                  <td className="py-3 font-mono tabular-nums">
                    {row.n ? row.rate.toFixed(2) : "—"}
                    <span className="text-subtle"> {row.n >= 20 ? "sample" : "thin"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function BrokerPanel({
  selected,
  onSelect,
}: {
  selected: BrokerChoice["id"];
  onSelect: (id: BrokerChoice["id"]) => void;
}) {
  return (
    <div className="grid gap-3">
      {BROKERS.map((b) => {
        const on = selected === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b.id)}
            className={`rounded-sm border p-4 text-left ${on ? "border-accent/50 bg-secondary" : "border-border bg-card"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{b.name}</h3>
              {on ? <Badge tone="paper">selected</Badge> : <Badge>idle</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted">{b.role}</p>
            <p className="mt-2 font-mono text-xs text-subtle">{b.assets}</p>
            <p className="mt-1 text-sm">
              {b.id === "paper"
                ? "Wired. Marks to last."
                : b.id === "pmus"
                  ? "Keys on disk. Live orders locked."
                  : "Not wired."}
            </p>
            {b.blocker ? <p className="mt-2 text-sm text-down">{b.blocker}</p> : null}
          </button>
        );
      })}
    </div>
  );
}
