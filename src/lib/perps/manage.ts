/**
 * Position-management plan, shared by the simulator and the OMS.
 * The venue call is PUT /trade-api/v2/margin/cross/positions/{ticker}/exit_trigger.
 * A new entry sends one anchored bracket (stop and final target). count and anchor_order_id
 * are never on the same body. The half take-profit is only built once a position is open.
 * The trailing stop is a separate body and is not sent with the entry.
 */
export type ManagePlan = { dir: "long" | "short"; qty: number; entry: number; stop: number; t1: number; t2: number; partialFrac: number; trailR: number; maxHoldMs: number };
export type ManageState = { open: number; stop: number; partialDone: boolean; trailRef: number | null; realized: number; exits: ExitEvent[]; closed: boolean };
export type ExitEvent = { reason: "stop" | "break_even" | "trail" | "t1_partial" | "t2" | "time" | "thesis_invalid" | "gap_stop"; qty: number; price: number; taker: boolean; tMs: number };

export function startState(p: ManagePlan): ManageState { return { open: p.qty, stop: p.stop, partialDone: false, trailRef: null, realized: 0, exits: [], closed: false }; }

/**
 * Advance one bar (o/h/l/c are mark-like prices). Pessimistic ordering inside a bar: if both stop and target are
 * touched in the same bar, the stop is assumed to fill first. A bar that OPENS beyond the stop fills at the open (gap).
 */
export function stepBar(p: ManagePlan, s: ManageState, bar: { t: number; o: number; h: number; l: number; c: number }, entryMs: number, slipPerContract: number): ManageState {
  if (s.closed || s.open <= 0) return s;
  const long = p.dir === "long";
  const r = Math.abs(p.entry - p.stop);
  const st = { ...s, exits: [...s.exits] };
  const close = (qty: number, price: number, reason: ExitEvent["reason"], taker: boolean) => {
    const q = Math.min(qty, st.open);
    if (q <= 0) return;
    st.realized += (long ? price - p.entry : p.entry - price) * q;
    st.open = +(st.open - q).toFixed(6);
    st.exits.push({ reason, qty: q, price, taker, tMs: bar.t });
    if (st.open <= 1e-9) { st.open = 0; st.closed = true; }
  };
  const stopReason = (): ExitEvent["reason"] => (st.trailRef != null ? "trail" : st.partialDone ? "break_even" : "stop");
  // gap through stop at the open
  if (long ? bar.o <= st.stop : bar.o >= st.stop) { close(st.open, long ? bar.o - slipPerContract : bar.o + slipPerContract, "gap_stop", true); return st; }
  const hitStop = long ? bar.l <= st.stop : bar.h >= st.stop;
  if (hitStop) { close(st.open, long ? st.stop - slipPerContract : st.stop + slipPerContract, stopReason(), true); return st; }
  if (!st.partialDone && (long ? bar.h >= p.t1 : bar.l <= p.t1)) {
    close(Math.max(1, Math.floor(p.qty * p.partialFrac)), p.t1, "t1_partial", false); // whole contracts
    st.partialDone = true; st.stop = p.entry; st.trailRef = long ? bar.h : bar.l;
  }
  if (st.closed) return st;
  if (long ? bar.h >= p.t2 : bar.l <= p.t2) { close(st.open, p.t2, "t2", false); return st; }
  if (st.trailRef != null) {
    st.trailRef = long ? Math.max(st.trailRef, bar.h) : Math.min(st.trailRef, bar.l);
    const trailStop = long ? st.trailRef - p.trailR * r : st.trailRef + p.trailR * r;
    st.stop = long ? Math.max(st.stop, trailStop) : Math.min(st.stop, trailStop);
  }
  if (bar.t + 60_000 - entryMs >= p.maxHoldMs) close(st.open, long ? bar.c - slipPerContract : bar.c + slipPerContract, "time", true);
  return st;
}

/** Bracket bodies the OMS can PUT. A fresh entry has no position yet, so only the anchored stop goes out. */
export function nativeTriggerRequests(p: ManagePlan, anchorOrderId: string, cidBase: string, positionOpen = false) {
  const clip = (s: string) => s.slice(0, 64);
  const out: Record<string, unknown>[] = [{
    kind: "bracket",
    anchor_order_id: anchorOrderId,
    client_trigger_id: clip(`${cidBase}-full`),
    stop_loss_price: p.stop.toFixed(4),
    take_profit_price: p.t2.toFixed(4),
  }];
  const half = Math.floor(p.qty * p.partialFrac);
  if (positionOpen && half >= 1) out.push({
    kind: "bracket",
    client_trigger_id: clip(`${cidBase}-t1`),
    count: String(half),
    take_profit_price: p.t1.toFixed(4),
  });
  return out;
}

/** Trailing distance in dollars. Not sent with the entry bracket. One of trail_amount or trail_bps, never both. */
export function trailingStopBody(p: ManagePlan): { kind: "trailing"; trail_amount: string } | null {
  const dist = p.trailR * Math.abs(p.entry - p.stop);
  if (!(dist > 0)) return null;
  return { kind: "trailing", trail_amount: dist.toFixed(4) };
}

/** Move one bracket's stop to the entry. The other leg is left alone. */
export function breakEvenStopBody(entry: number) {
  return { stop_loss_price: entry.toFixed(4) };
}
