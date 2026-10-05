import type { MiroFishSimulationResult } from "./mirofish-client";

export interface MarketContext {
  ticker: string;
  spotPrice: number;
  bidPrice: number;
  askPrice: number;
  leverageMax: number;
  /** Ceiling from the slider. The debate may go lower. It may not go higher. */
  selectedLeverage: number;
  shortTermMomentum: number;
  mirofish?: MiroFishSimulationResult;
}

export interface DebateVerdict {
  action: "LONG" | "SHORT" | "NO_TRADE";
  convictionScore: number;
  recommendedLeverage: number;
  bullThesis: string;
  bearThesis: string;
  arbitratorReasoning: string;
  stopLossPrice: number;
  takeProfitPrice: number;
}

function clampLev(n: number, max: number) {
  const cap = Math.max(1, max);
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(Math.max(v, 1), cap);
}

/** Used when the model is absent, late, or returns junk. The slider is still the ceiling. */
export function mathVerdict(ctx: MarketContext, action: "LONG" | "SHORT"): DebateVerdict {
  const use = clampLev(ctx.selectedLeverage, ctx.leverageMax);
  const stopPct = 0.1 / use;
  const takePct = 0.2 / use;
  const long = action === "LONG";
  return {
    action,
    convictionScore: Math.round(Math.min(90, 40 + ctx.shortTermMomentum * 15)),
    recommendedLeverage: use,
    bullThesis: long ? "Three finished minutes pushed up and the book is tight." : "Three finished minutes pushed down and the book is tight.",
    bearThesis: "A wide book or a stop inside the spread already failed before this line.",
    arbitratorReasoning: `No model answer. Keeping the slider at ${use.toFixed(1)}x, which is not above the contract maximum.`,
    stopLossPrice: long ? ctx.spotPrice * (1 - stopPct) : ctx.spotPrice * (1 + stopPct),
    takeProfitPrice: long ? ctx.spotPrice * (1 + takePct) : ctx.spotPrice * (1 - takePct),
  };
}

function stopsSane(ctx: MarketContext, action: "LONG" | "SHORT", stop: number, take: number) {
  if (!(stop > 0) || !(take > 0) || !(ctx.spotPrice > 0)) return false;
  if (action === "LONG") return stop < ctx.spotPrice && take > ctx.spotPrice;
  return stop > ctx.spotPrice && take < ctx.spotPrice;
}

export async function callXai(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey || apiKey.length < 12) throw new Error("no model key");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(4000),
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`model ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("model empty");
  return text;
}

export async function runTauricDebate(
  ctx: MarketContext,
  callLlm: (systemPrompt: string, userPrompt: string) => Promise<string> = callXai,
): Promise<DebateVerdict> {
  const lean: "LONG" | "SHORT" = ctx.shortTermMomentum >= 0 ? "LONG" : "SHORT";
  const promptData = JSON.stringify({
    ticker: ctx.ticker,
    spot: ctx.spotPrice,
    spread: (ctx.askPrice - ctx.bidPrice).toFixed(4),
    momentum1m: ctx.shortTermMomentum,
    maxAllowedLeverage: ctx.leverageMax,
    userSelectedLeverage: ctx.selectedLeverage,
    mirofishEmergentProbabilities: ctx.mirofish
      ? {
          bullProb: ctx.mirofish.bullProbability,
          bearProb: ctx.mirofish.bearProbability,
          confidence: ctx.mirofish.consensusConfidence,
          summary: ctx.mirofish.narrativeSummary,
        }
      : "No active catalyst simulation",
  });
  const systemPrompt = `You are the Tauric TradingAgents Decision Engine.
The tape already picked the side. You may agree, stand down, or cut leverage. You may not flip the side.
The slider ceiling is ${ctx.selectedLeverage}x. The contract maximum is ${ctx.leverageMax}x. Never recommend above the slider.
Respond ONLY with valid JSON:
{
  "action": "LONG" | "SHORT" | "NO_TRADE",
  "convictionScore": number,
  "recommendedLeverage": number,
  "bullThesis": string,
  "bearThesis": string,
  "arbitratorReasoning": string,
  "stopLossPrice": number,
  "takeProfitPrice": number
}`;
  try {
    const rawJson = await callLlm(systemPrompt, `Current Market State:\n${promptData}`);
    const cleanJson = rawJson.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson) as Partial<DebateVerdict>;
    const action = parsed.action === "LONG" || parsed.action === "SHORT" || parsed.action === "NO_TRADE" ? parsed.action : "NO_TRADE";
    const fallback = mathVerdict(ctx, action === "SHORT" ? "SHORT" : "LONG");
    const recommendedLeverage = clampLev(Number(parsed.recommendedLeverage), Math.min(ctx.selectedLeverage, ctx.leverageMax));
    const stop = Number(parsed.stopLossPrice);
    const take = Number(parsed.takeProfitPrice);
    const priced = action === "NO_TRADE" ? true : stopsSane(ctx, action, stop, take);
    return {
      action,
      convictionScore: Math.min(100, Math.max(0, Number(parsed.convictionScore) || 0)),
      recommendedLeverage,
      bullThesis: String(parsed.bullThesis || fallback.bullThesis),
      bearThesis: String(parsed.bearThesis || fallback.bearThesis),
      arbitratorReasoning: String(parsed.arbitratorReasoning || fallback.arbitratorReasoning),
      stopLossPrice: priced && action !== "NO_TRADE" ? stop : fallback.stopLossPrice,
      takeProfitPrice: priced && action !== "NO_TRADE" ? take : fallback.takeProfitPrice,
    };
  } catch {
    return mathVerdict(ctx, lean);
  }
}
