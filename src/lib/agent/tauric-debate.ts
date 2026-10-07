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

/** Bull states the push. Bear does not sit a wide book. A crowd that is already the other way can still kill it. */
export function tauricDebate(input: DebateIn): DebateOut {
  const bull = `${input.side === "bid" ? "long" : "short"} ${input.ticker} · push ${input.pushOverNoise.toFixed(1)}x noise · ${input.lev.toFixed(1)}x`;
  if (!(input.pushOverNoise >= 2)) return { ok: false, limit: 0, why: `bear: no 2-sigma push · ${bull}` };
  const crowd = readMirofish();
  if (crowd && crowd.probability != null) {
    const against = input.side === "bid" ? crowd.probability < 0.35 : crowd.probability > 0.65;
    if (against) return { ok: false, limit: 0, why: `bear: crowd ${Math.round(crowd.probability * 100)}% the other way · ${bull}` };
  }
  const limit = input.side === "bid" ? input.ask : input.bid;
  return { ok: true, limit, why: `bull held · ${bull}` };
}
