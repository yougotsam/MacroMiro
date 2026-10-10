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
  private officialAverages = new Map<string, { value: number; windowSize: number; t: number }>();
  /** Kalshi-provided final-minute accumulation, NOT our locally invented index value. */
  lastOfficialAverage(index: string) { return this.officialAverages.get(index) ?? null; }
  private ws: WebSocket | null = null;
  private pending: string[] = [];
  private stopped = false;
  private backoff = 500;
  private lastMsgAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** an open socket that stops delivering prints (seen 2026-10-09 18:15Z: "live" for 3 h with no index) is torn down */
  static readonly STALL_MS = 45_000;
  stalls = 0;
  status = "init";
  errors = 0;

  constructor(private record = true) {
    for (const k of [...RTI, GOLD]) this.bufs.set(k, { bySec: new Map(), lastTs: 0, lastRecv: 0 });
  }

  push(index: string, tMs: number, v: number, recv = Date.now()) {
    const b = this.bufs.get(index);
    if (!b || !Number.isFinite(v) || v <= 0 || !Number.isFinite(tMs) || !Number.isFinite(recv)) return;
    if (tMs > recv + 2_000 || tMs < recv - 7 * 24 * 3600_000) return;
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
    if (!this.watchdog) this.watchdog = setInterval(() => this.checkStall(), 15_000);
  }

  /** Read-only market-data reconnect: no orders, no gate change. Returns true when it forced a reconnect. */
  checkStall(now = Date.now()) {
    if (this.stopped || this.status !== "live" || !this.lastMsgAt) return false;
    // Root cause of the Oct 9 18:11Z gap: the socket stayed open ("live") but stopped delivering index values.
    // Stall = no message at all, OR any crypto index silent for 2x STALL_MS while the socket claims to be live.
    const silentIndex = RTI.some((id) => { const b = this.bufs.get(id); return !!b && b.lastRecv > 0 && now - b.lastRecv > 2 * Feeds.STALL_MS; });
    if (now - this.lastMsgAt < Feeds.STALL_MS && !silentIndex) return false;
    this.stalls += 1;
    this.status = "stalled";
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* already gone */ }
    if (ws) { ws.onclose = null; ws.onmessage = null; }
    setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(15_000, this.backoff * 2);
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
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
      this.lastMsgAt = Date.now();
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
      if (m.type === "cfbenchmarks_value" || m.type === "pyth_value") this.lastMsgAt = recv;
      if (m.type === "cfbenchmarks_value" && m.msg) {
        try {
          const inner = JSON.parse(String(m.msg.data)) as { time: number; id: string; value: string };
          this.push(inner.id, inner.time, Number(inner.value), recv);
          const avg = m.msg.last_60s_windowed_average_15min as {
            value?: string; window_size?: number
          } | undefined;
          const count = Number(avg?.window_size);
          const value = Number(avg?.value);
          if (avg && Number.isInteger(count) && count >= 1 && count <= 60 &&
              Number.isFinite(value) && value > 0 && Math.abs(inner.time - recv) < 5_000) {
            this.officialAverages.set(inner.id, { value, windowSize: count, t: inner.time });
          }
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

/**
 * Does Kalshi's official 60 s accumulator describe the same second as our latest index print?
 * Our prints are floored to the whole second; the accumulator carries the raw millisecond time,
 * so both are compared at second resolution (review B3). The count must equal the seconds of the
 * window (close − 60 s, close] printed so far.
 */
export function officialMatches(official: { t: number; windowSize: number } | null | undefined, lastT: number, closeMs: number): boolean {
  if (!official || !Number.isFinite(official.t) || !Number.isFinite(lastT)) return false;
  const expected = Math.floor(lastT / 1000) - Math.floor(closeMs / 1000) + 60;
  return Math.floor(official.t / 1000) === Math.floor(lastT / 1000) && official.windowSize === expected;
}
