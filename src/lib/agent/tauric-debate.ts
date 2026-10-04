import { readMirofish } from "../intel/mirofish.ts";

export type DebateIn = {
  ticker: string;
  side: "bid" | "ask";
  bid: number;
  ask: number;
  lev: number;
  /** How many times the push beat the recent noise. 2 means two standard deviations. */
  pushOverNoise: number;
};

export type DebateOut = { ok: boolean; limit: number; why: string };

/** Bull states the push. Bear kills a wide book, a stop inside the spread, or a crowd that is already the other way. */
export function tauricDebate(input: DebateIn): DebateOut {
  const mid = (input.bid + input.ask) / 2;
  const spreadBps = mid > 0 ? ((input.ask - input.bid) / mid) * 10_000 : 999;
  const stopBps = input.lev > 0 ? (0.1 / input.lev) * 10_000 : 0;
  const bull = `${input.side === "bid" ? "long" : "short"} ${input.ticker} · push ${input.pushOverNoise.toFixed(1)}x noise · ${input.lev.toFixed(1)}x`;
  if (!(input.pushOverNoise >= 2)) return { ok: false, limit: 0, why: `bear: no 2-sigma push · ${bull}` };
  if (spreadBps > 8) return { ok: false, limit: 0, why: `bear: spread ${spreadBps.toFixed(1)} bps eats the fill · ${bull}` };
  if (stopBps < spreadBps * 2) return { ok: false, limit: 0, why: `bear: stop sits inside the spread · ${bull}` };
  const crowd = readMirofish();
  if (crowd && crowd.probability != null) {
    const against = input.side === "bid" ? crowd.probability < 0.35 : crowd.probability > 0.65;
    if (against) return { ok: false, limit: 0, why: `bear: crowd ${Math.round(crowd.probability * 100)}% the other way · ${bull}` };
  }
  const limit = input.side === "bid" ? input.ask : input.bid;
  return { ok: true, limit, why: `bull held · ${bull}` };
}
