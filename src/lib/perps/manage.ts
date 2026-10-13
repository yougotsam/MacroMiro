/**
 * Position-management plan, shared by the simulator and the OMS. The OMS turns it into native Kalshi exit triggers
 * (PUT /margin/cross/positions/{ticker}/exit_trigger): a full-size bracket {stop_loss_price, take_profit_price=T2}
 * and a partial bracket {count=half, take_profit_price=T1, client_trigger_id}. After T1 the stop moves to break-even
 * (PUT …/exit_trigger/{trigger_id}) and a trailing stop starts (kind="trailing", trail_amount). Every exit is reduce-only
 * and can never open the opposite side.
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

/** The native trigger requests the OMS will send for a plan (fields from perps_openapi.yaml SetCrossExitTriggerRequest). */
export function nativeTriggerRequests(p: ManagePlan, anchorOrderId: string, cidBase: string) {
  const half = Math.floor(p.qty * p.partialFrac);
  return [
    { kind: "bracket", anchor_order_id: anchorOrderId, client_trigger_id: `${cidBase}-full`, stop_loss_price: p.stop.toFixed(4), take_profit_price: p.t2.toFixed(4) },
    ...(half >= 1 ? [{ kind: "bracket", anchor_order_id: anchorOrderId, client_trigger_id: `${cidBase}-t1`, count: String(half), take_profit_price: p.t1.toFixed(4) }] : []),
  ];
}
