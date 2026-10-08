import { useCallback, useEffect, useState } from "react";

type SwarmBody = {
  town?: { up?: boolean; url?: string; detail?: string };
  snap?: {
    headline?: string;
    stage?: string;
    error?: string;
    probability?: number | null;
    running?: boolean;
    progress?: number;
    message?: string;
    rounds?: { current?: number; total?: number; cap?: number };
    actions?: number;
  };
  note?: string;
  reason?: string;
};

export function SwarmPanel() {
  const [body, setBody] = useState<SwarmBody | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/live/swarm");
    if (!res.ok) throw new Error(`swarm ${res.status}`);
    setBody((await res.json()) as SwarmBody);
  }, []);

  useEffect(() => {
    let stop = false;
    const run = () => {
      load().catch((e) => {
        if (!stop) setErr(e instanceof Error ? e.message : "swarm unread");
      });
    };
    run();
    const id = setInterval(run, body?.snap?.running ? 5000 : 20000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [load, body?.snap?.running]);

  const knock = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/live/swarm", { method: "POST" });
      if (!res.ok) throw new Error(`knock ${res.status}`);
      setBody((await res.json()) as SwarmBody);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "knock failed");
    } finally {
      setBusy(false);
    }
  };

  const snap = body?.snap;

  return (
    <div className="mx-auto grid max-w-3xl gap-3 px-3 py-3 sm:px-4">
      <section className="rounded-sm border border-border bg-card p-4">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">MiroFish</p>
        <p className="mt-2 text-sm text-muted">
          The client is in this build. The town is a separate program on {body?.town?.url || "port 5001"}.{" "}
          {body?.town?.up ? "It answered." : "It did not answer."} A blank probability is not a trade.
        </p>
        <p className="mt-2 font-mono text-xs text-subtle">{body?.town?.detail || "checking"}</p>
        <button
          type="button"
          onClick={() => void knock()}
          disabled={busy}
          className="mt-3 h-11 rounded-sm bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Knocking…" : "Knock once"}
        </button>
      </section>
      <section className="rounded-sm border border-border p-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Last knock</p>
        <p className="mt-2 text-sm">{snap?.headline || "No spark headline yet."}</p>
        <p className="mt-2 font-mono text-xs text-subtle">
          stage {snap?.stage || "idle"}
          {snap?.probability == null ? " · no probability" : ` · ${(snap.probability * 100).toFixed(1)}%`}
          {snap?.running ? ` · ${snap.progress ?? 0}%` : ""}
          {snap?.rounds?.current ? ` · round ${snap.rounds.current}/${snap.rounds.total || snap.rounds.cap}` : ""}
          {snap?.actions ? ` · ${snap.actions} agent actions` : ""}
        </p>
        {snap?.message ? <p className="mt-1 font-mono text-xs text-subtle">{snap.message}</p> : null}
        {body?.reason ? <p className="mt-1 font-mono text-xs text-subtle">{body.reason}</p> : null}
        {snap?.error ? <p className="mt-2 text-sm text-down">{snap.error}</p> : null}
        {err ? <p className="mt-2 text-sm text-down">{err}</p> : null}
      </section>
      <section className="rounded-sm border border-border p-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Waiting on you</p>
        <p className="mt-2 text-sm text-muted">
          These four names go in the MiroFish program, not in this desk. When you have them, the knock can finish a real run.
        </p>
        <ul className="mt-3 space-y-2 font-mono text-xs text-subtle">
          <li>LLM_API_KEY</li>
          <li>LLM_BASE_URL</li>
          <li>LLM_MODEL_NAME</li>
          <li>ZEP_API_KEY</li>
        </ul>
      </section>
    </div>
  );
}
