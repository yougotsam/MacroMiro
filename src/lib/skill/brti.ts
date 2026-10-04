/** Two different BRTI numbers. Do not use one as the other. */

export type BrtiWindow = { value: number; windowStart: number | null; windowEnd: number; windowSize: number | null };

export type BrtiRead = {
  indexId: string | null;
  valueUsd: number | null;
  sourceTsMs: number | null;
  receivedAt: number | null;
  trailing60: BrtiWindow | null;
  settlement15: BrtiWindow | null;
  mode: "live" | "mock" | "missing";
  stale: boolean;
  missing: string[];
};

type Win = { value?: string; window_size?: number; window_start_ts_ms?: number; window_end_ts_exclusive?: number };

function win(raw: Win | undefined, now: number, maxAge: number): { w: BrtiWindow | null; missing: string | null; stale: boolean } {
  const value = Number(raw?.value);
  const end = raw?.window_end_ts_exclusive;
  if (!raw?.value || !Number.isFinite(value) || value <= 0 || !end) return { w: null, missing: "window", stale: true };
  const stale = now - end > maxAge || now - end < -2_000;
  return {
    w: { value, windowStart: raw.window_start_ts_ms ?? null, windowEnd: end, windowSize: raw.window_size ?? null },
    missing: stale ? "stale" : null,
    stale,
  };
}

export function readBrti(msg: unknown, now = Date.now(), mode: "live" | "mock" = "live"): BrtiRead {
  const m = msg as {
    index_id?: string;
    received_at?: number;
    data?: string;
    avg_60s_data?: Win;
    last_60s_windowed_average_15min?: Win;
  };
  const missing: string[] = [];
  let valueUsd: number | null = null;
  let sourceTsMs: number | null = null;
  if (m?.data) {
    try {
      const inner = JSON.parse(m.data) as { value?: string; time?: number };
      const v = Number(inner.value);
      if (Number.isFinite(v) && v > 0) {
        valueUsd = v;
        sourceTsMs = inner.time ?? null;
      }
    } catch {
      missing.push("data json");
    }
  }
  const trail = win(m?.avg_60s_data, now, 5_000);
  const settle = win(m?.last_60s_windowed_average_15min, now, 70_000);
  if (!m?.avg_60s_data) missing.push("avg_60s_data");
  else if (trail.missing) missing.push(`trailing ${trail.missing}`);
  if (!m?.last_60s_windowed_average_15min) missing.push("last_60s_windowed_average_15min");
  else if (settle.missing) missing.push(`settlement ${settle.missing}`);
  return {
    indexId: m?.index_id ?? null,
    valueUsd,
    sourceTsMs,
    receivedAt: m?.received_at ?? null,
    trailing60: trail.w,
    settlement15: settle.w,
    mode: m ? mode : "missing",
    stale: trail.stale && settle.stale,
    missing,
  };
}

/** Distance-from-strike uses the trailing 60s average. The quarter-hour settlement window is a different field. */
export function spotForDistance(read: BrtiRead): number | null {
  if (read.mode === "missing" || read.trailing60 == null) return null;
  if (read.missing.some((m) => m.startsWith("trailing"))) return null;
  return read.trailing60.value;
}

/** Quarter-hour settlement is the 60-tick close of last_60s_windowed_average_15min. Size 14 is still accumulating. */
export function settlementPrint(read: BrtiRead, inFinalMinute: boolean): number | null {
  if (!inFinalMinute) return null;
  if (read.settlement15 == null || read.settlement15.windowSize !== 60) return null;
  if (read.missing.some((m) => m.startsWith("settlement"))) return null;
  return read.settlement15.value;
}
