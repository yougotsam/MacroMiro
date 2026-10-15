/** Current candle replay label. Anything else is the old fake-book era or an unknown file. */
export const CURRENT_REPLAY_LABEL = "CANDLE_ONLY_NOT_EXECUTABLE";

export function pickCurrentReplay(files: { name: string; label?: string | null }[]) {
  const current = files.filter((f) => f.label === CURRENT_REPLAY_LABEL);
  const quarantined = files.filter((f) => f.label !== CURRENT_REPLAY_LABEL).map((f) => f.name);
  return { file: current.length ? current[current.length - 1].name : null, quarantined };
}

export function emptyTradeReport(trades: { t: number; exits: string; entry: number; stop: number }[] | null | undefined) {
  if (!trades?.length) return { trades: 0, note: "zero trades is a result", at: null as string | null, stopMedian: null as number | null, trace: null as null };
  const stops = trades.map((x) => Math.abs(x.entry - x.stop) / x.entry).sort((a, b) => a - b);
  const trace = trades.find((x) => /t1_partial/.test(x.exits)) ?? trades[0];
  return { trades: trades.length, note: "candle proxy, not a fill", at: new Date(trace.t).toISOString(), stopMedian: stops[Math.floor(stops.length / 2)], trace };
}
