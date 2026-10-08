/**
 * Settlement-grade feeds over ONE authenticated Kalshi WebSocket (api.elections.kalshi.com — the
 * external-api-ws host refuses this box, which is why the old desk's RTI feed looked "unauthorized"/stale).
 *   cfbenchmarks_value: BRTI, ETHUSD_RTI, SOLUSD_RTI, XRPUSD_RTI — one-second prints (msg.data.value @ msg.data.time)
 *   pyth_value: Metal.Index.1OZGOLD/USD — KXGOLD15M's settlement source
 * Bootstrap: last hour of 1-second RTI values from the CF Benchmarks REST passthrough.
 * Recorder: every print is appended to <data>/prints/<day>.jsonl for replay/calibration.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { kalshiGet, kalshiWsHeaders } from "@/lib/scan/kalshi-auth";
import { dataDir } from "./config";
import type { Print } from "./settlement";
import { etDay } from "./time";

const WS_URL = "wss://api.elections.kalshi.com/trade-api/ws/v2";
export const RTI = ["BRTI", "ETHUSD_RTI", "SOLUSD_RTI", "XRPUSD_RTI"] as const;
export const GOLD = "Metal.Index.1OZGOLD/USD";
const KEEP_MS = 2 * 3600_000;

type Buf = { bySec: Map<number, number>; lastTs: number; lastRecv: number };

export class Feeds {
  private bufs = new Map<string, Buf>();
  private ws: WebSocket | null = null;
  private pending: string[] = [];
  private stopped = false;
  private backoff = 500;
  status = "init";
  errors = 0;

  constructor(private record = true) {
    for (const k of [...RTI, GOLD]) this.bufs.set(k, { bySec: new Map(), lastTs: 0, lastRecv: 0 });
  }

  push(index: string, tMs: number, v: number, recv = Date.now()) {
    const b = this.bufs.get(index);
    if (!b || !(v > 0)) return;
    const sec = Math.floor(tMs / 1000) * 1000;
    if (!b.bySec.has(sec) && this.record) this.pending.push(JSON.stringify({ i: index, t: sec, v, r: recv }));
    b.bySec.set(sec, v);
    if (sec >= b.lastTs) {
      b.lastTs = sec;
      b.lastRecv = recv;
    }
  }

  prints(index: string, sinceMs = 0): Print[] {
    const b = this.bufs.get(index);
    if (!b) return [];
    return [...b.bySec.entries()].filter(([t]) => t >= sinceMs).sort((a, z) => a[0] - z[0]).map(([t, v]) => ({ t, v }));
  }

  windowMap(index: string, fromMs: number, toMs: number) {
    const b = this.bufs.get(index);
    const m = new Map<number, number>();
    if (!b) return m;
    for (let t = fromMs; t < toMs; t += 1000) {
      const v = b.bySec.get(t);
      if (v != null) m.set(t, v);
    }
    return m;
  }

  last(index: string): (Print & { recv: number }) | null {
    const b = this.bufs.get(index);
    if (!b || !b.lastTs) return null;
    return { t: b.lastTs, v: b.bySec.get(b.lastTs) as number, recv: b.lastRecv };
  }

  /** age of the newest print by its own exchange timestamp */
  ageMs(index: string, now = Date.now()) {
    const l = this.last(index);
    return l ? now - l.t : Infinity;
  }

  prune(now = Date.now()) {
    for (const b of this.bufs.values()) for (const t of b.bySec.keys()) if (t < now - KEEP_MS) b.bySec.delete(t);
  }

  flush() {
    if (!this.pending.length) return;
    try {
      const dir = `${dataDir()}/prints`;
      mkdirSync(dir, { recursive: true });
      appendFileSync(`${dir}/${etDay()}.jsonl`, `${this.pending.join("\n")}\n`);
    } catch {
      /* next flush */
    }
    this.pending = [];
  }

  /** Reload the recorder's own prints (last 2 h) so a restart keeps σ/bars warm — gold has no REST history. */
  reloadRecorded(now = Date.now()) {
    const was = this.record;
    this.record = false;
    try {
      for (const day of new Set([etDay(now - KEEP_MS), etDay(now)])) {
        const f = `${dataDir()}/prints/${day}.jsonl`;
        if (!existsSync(f)) continue;
        for (const line of readFileSync(f, "utf8").split("\n")) {
          if (!line) continue;
          try {
            const r = JSON.parse(line) as { i: string; t: number; v: number; r?: number };
            if (r.t >= now - KEEP_MS && r.t <= now) this.push(r.i, r.t, r.v, r.r ?? r.t);
          } catch {
            /* partial line */
          }
        }
      }
    } finally {
      this.record = was;
    }
  }

  async bootstrap() {
    this.reloadRecorded();
    for (const id of RTI) {
      try {
        const { data } = await kalshiGet<{ data?: { payload?: Array<{ value: string; time: number }> } }>(`/trade-api/v2/cfbenchmarks/values?id=${id}`);
        for (const p of data.data?.payload ?? []) if (p.time % 1000 === 0) this.push(id, p.time, Number(p.value), p.time);
      } catch {
        /* the socket fills it */
      }
    }
  }

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    try {
      this.ws?.close();
    } catch {
      /* */
    }
  }

  private open() {
    if (this.stopped) return;
    this.status = "connecting";
    const ws = new WebSocket(WS_URL, { headers: kalshiWsHeaders() } as unknown as string[]);
    this.ws = ws;
    ws.onopen = () => {
      this.status = "live";
      this.backoff = 500;
      ws.send(JSON.stringify({ id: 1, cmd: "subscribe", params: { channels: ["cfbenchmarks_value"], index_ids: [...RTI] } }));
      ws.send(JSON.stringify({ id: 2, cmd: "subscribe", params: { channels: ["pyth_value"], underlying_tickers: [GOLD] } }));
    };
    ws.onmessage = (ev) => {
      let m: { type?: string; msg?: Record<string, unknown> };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const recv = Date.now();
      if (m.type === "cfbenchmarks_value" && m.msg) {
        try {
          const inner = JSON.parse(String(m.msg.data)) as { time: number; id: string; value: string };
          this.push(inner.id, inner.time, Number(inner.value), recv);
        } catch {
          this.errors += 1;
        }
      } else if (m.type === "pyth_value" && m.msg) {
        this.push(String(m.msg.underlying_ticker), Number(m.msg.source_ts_ms), Number(m.msg.value_usd), recv);
      } else if (m.type === "error") this.errors += 1;
    };
    ws.onclose = () => {
      this.status = "reconnecting";
      this.ws = null;
      if (this.stopped) return;
      setTimeout(() => this.open(), this.backoff);
      this.backoff = Math.min(15_000, this.backoff * 2);
    };
    ws.onerror = () => {
      this.errors += 1;
    };
  }
}
