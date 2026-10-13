/**
 * Pluggable MAKER interface (Loop Engineering: maker proposes, an independent checker grades).
 *  - CodeMaker: the current deterministic engine (highest confluence score among qualifying candidates).
 *  - LlmMaker: one LLM call per qualifying signal; reads the skill text, ACTIVE lessons and the recent bars, returns
 *    a direction or skip WITH reasoning. Reasoning is stored for the owner/retros only — the checker never receives it
 *    (checker.ts accepts only {t, netUsd, oos}).
 *  - StubMaker: deterministic stand-in for tests (no network, no cost).
 * Cost meter: every call's real provider-reported tokens × list price (llm-meter.ts) is charged against P&L.
 * Spend is capped by LoopGuard before each call. Uses only a key already present in the environment.
 */
import { costOf } from "@/lib/research/llm-meter";
import type { SelectCtx } from "@/lib/perps/sim";
import type { LoopGuard } from "./budget";
import { askBrain, type BrainAnswer, type BrainCall } from "@/lib/brain/brain.server";
import { brainModel, brainReady, type BrainId } from "@/lib/brain/model";

export type MakerDecision = { dir: "long" | "short" | null; reasoning: string; promptTokens: number; completionTokens: number; costUsd: number; error?: string };
export interface Maker { name: string; decide(ctx: SelectCtx): Promise<MakerDecision> }

export const codePick = (ctx: SelectCtx) => (ctx.quals.length ? [...ctx.quals].sort((a, b) => b.score - a.score)[0].dir : null);
export class CodeMaker implements Maker {
  name = "code";
  async decide(ctx: SelectCtx): Promise<MakerDecision> { return { dir: codePick(ctx), reasoning: "code: highest confluence score", promptTokens: 0, completionTokens: 0, costUsd: 0 }; }
}
/** Deterministic test stub: takes the code pick only when its payoff ratio ≥ 1.5, else skips. */
export class StubMaker implements Maker {
  name = "stub";
  async decide(ctx: SelectCtx): Promise<MakerDecision> {
    const q = ctx.quals.find((x) => x.dir === codePick(ctx));
    const ok = q && q.lossNet < 0 && q.winNet / -q.lossNet >= 1.5;
    return { dir: ok ? q!.dir : null, reasoning: "stub", promptTokens: 400, completionTokens: 40, costUsd: costOf("gemini-3.8-flash", { prompt: 400, completion: 40 }) };
  }
}

export function makerPrompt(ctx: SelectCtx, skill: string, lessons: string[]) {
  const bars = ctx.b15.slice(-16).map((b) => `${new Date(b.t).toISOString().slice(5, 16)} o${b.o} h${b.h} l${b.l} c${b.c}`).join("\n");
  const q = ctx.quals.map((x) => `- ${x.dir}: setup ${x.setup}, score ${x.score}/13, entry ${x.entry}, stop ${x.stop}, net if win $${x.winNet.toFixed(2)}, net if loss $${x.lossNet.toFixed(2)}`).join("\n");
  return `You are the MAKER for a paper-only perps scalper (${ctx.ticker}). Decide on ONE closed 15m bar. You only see past data.
SKILL:\n${skill}\nACTIVE LESSONS (must respect):\n${lessons.map((l) => `- ${l}`).join("\n") || "- none"}
LAST 16 x 15m BARS:\n${bars}\nQUALIFYING CANDIDATES from the code engine:\n${q}
Fees already included. Most candidates historically lose after costs, so skip unless the setup is clearly favourable.
Reply with JSON only: {"dir":"long"|"short"|"skip","why":"<one sentence>"}`;
}

type Ask = (brain: BrainId, c: BrainCall) => Promise<BrainAnswer>;
/** Reuses the existing brain caller (brain.server.ts askBrain) — no second HTTP client, keys never leave the env. */
export class LlmMaker implements Maker {
  name: string;
  private model: string;
  constructor(private o: { brain: BrainId; skill: string; lessons: string[]; guard: LoopGuard; ask?: Ask; maxOutTokens?: number }) { this.model = brainModel(o.brain); this.name = `llm:${this.model}`; }
  static keyPresent(brain: BrainId = "gemini") { return brainReady(brain); }
  async decide(ctx: SelectCtx): Promise<MakerDecision> {
    const prompt = makerPrompt(ctx, this.o.skill, this.o.lessons);
    const estIn = Math.ceil(prompt.length / 3.5), maxOut = this.o.maxOutTokens ?? 600; // worst case incl. hidden thinking
    const worst = costOf(this.model, { prompt: estIn, completion: maxOut });
    if (this.o.guard.check() || !this.o.guard.canSpend(worst, estIn + maxOut)) return { dir: null, reasoning: "budget guard: skipped call", promptTokens: 0, completionTokens: 0, costUsd: 0, error: "budget" };
    try {
      const a = await (this.o.ask ?? askBrain)(this.o.brain, { system: "You are a careful trading maker. Paper only. JSON only.", user: prompt, json: true, maxTokens: maxOut });
      const pt = a.usage?.prompt ?? estIn, ct = a.usage?.completion ?? maxOut; // missing usage → charge the worst case
      const cost = costOf(this.model, { prompt: pt, completion: ct });
      this.o.guard.charge(cost, pt + ct);
      const m = a.text.match(/\{[\s\S]*\}/); const p = m ? (JSON.parse(m[0]) as { dir?: string; why?: string }) : {};
      const dir = p.dir === "long" || p.dir === "short" ? p.dir : null;
      const valid = dir == null || ctx.quals.some((q) => q.dir === dir);
      return { dir: valid ? dir : null, reasoning: String(p.why ?? a.text).slice(0, 300), promptTokens: pt, completionTokens: ct, costUsd: cost, error: valid ? undefined : "chose a non-qualifying direction" };
    } catch (e) {
      // a failed call may still be billed: charge the worst case so the cap stays conservative
      this.o.guard.charge(worst, estIn + maxOut);
      return { dir: null, reasoning: "call failed", promptTokens: estIn, completionTokens: maxOut, costUsd: worst, error: String((e as Error).message).slice(0, 120) };
    }
  }
}

/** Break-even: the extra after-cost P&L per trade the AI must add just to pay for its own calls. */
export function aiBreakEven(o: { callsUsd: number; calls: number; tradesTaken: number; avgNotionalUsd: number | null }) {
  const perCall = o.calls ? o.callsUsd / o.calls : 0, perTrade = o.tradesTaken ? o.callsUsd / o.tradesTaken : null;
  return { perCallUsd: +perCall.toFixed(6), perTradeUsd: perTrade == null ? null : +perTrade.toFixed(6), breakEvenBpsOfNotional: perTrade != null && o.avgNotionalUsd ? +((perTrade / o.avgNotionalUsd) * 1e4).toFixed(3) : null };
}
