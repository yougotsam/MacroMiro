import { createFileRoute } from "@tanstack/react-router";
import { askBrain } from "@/lib/brain/brain.server";
import { brainStatus, defaultBrain, parseBrain, type BrainId } from "@/lib/brain/model";
import { scoreOpinion, type Opinion, type Play } from "@/lib/envelope/opinion";
import { loadHeart } from "@/lib/envelope/store.server";
import { loadDesk } from "@/lib/live/server";
import type { BookId } from "@/lib/live/types";

const PLAYS = ["sit", "scalp", "event"] as const;
/** docs/STRATEGY.md: $1, $2, or $5. Never more than $5 on one ticket. */
const MAX_TICKET_USD = 5;

const CLERK =
  "You are the desk clerk. Repeat docs/STRATEGY.md. Do not invent a second rule. " +
  "The 15-minute order rule is src/lib/scan/edge.ts. Your answer is an opinion on screen. It never sends, sizes, or gates an order. " +
  "A ticket is 4 cents to 75 cents and is held to the clock. Size is $1, $2, or $5, never more than $5 on one ticket. " +
  "CPI, the jobs report, or the Fed does not change the 4 to 75 cent band and does not raise the $5 cap. The day stops at $15 down. " +
  "Perpetuals are a separate Kalshi margin book. Spark is a sentence, not a vote. A headline is not a vote. Do not invent a MiroFish percentage. " +
  "JSON only: plays [{id sit|scalp|event, score 0-100, title, why}], pick, sizeUsd (0 if sit, otherwise 1, 2, or 5).";

/** Snap a model's size to the strategy steps. Display only. */
export function snapSize(raw: unknown, fallback: number): number {
  const n = Number(raw);
  const v = Number.isFinite(n) ? n : fallback;
  if (v >= MAX_TICKET_USD) return MAX_TICKET_USD;
  if (v >= 2) return 2;
  return 1;
}

async function answerWith(brain: BrainId, id: BookId, local: Opinion, payload: string): Promise<Opinion> {
  try {
    const out = await askBrain(brain, { system: CLERK, user: payload, json: true, maxTokens: 1500 });
    const cleaned = out.text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      pick?: string;
      sizeUsd?: number;
      plays?: { id: string; score: number; title: string; why: string }[];
    };
    const plays: Play[] = (parsed.plays ?? [])
      .filter((p) => PLAYS.includes(p.id as (typeof PLAYS)[number]))
      .map((p) => ({ id: p.id as Play["id"], score: Number(p.score) || 0, title: String(p.title || p.id), why: String(p.why || "") }))
      .sort((a, b) => b.score - a.score);
    if (!plays.length) return { ...local, brain, note: `${out.model} gave no plays · local rules shown` };
    const pick = plays.find((p) => p.id === parsed.pick) ?? plays[0];
    const sizeUsd = pick.id === "sit" ? 0 : snapSize(parsed.sizeUsd, local.sizeUsd);
    return { pick, plays, sizeUsd, clerk: out.model, brain, ms: out.ms };
  } catch (e) {
    const why = e instanceof Error ? e.message : "brain failed";
    return { ...local, brain, note: `${brain}: ${why} · local rules shown` };
  }
}

async function answer(book: BookId | undefined, want: BrainId | "both" | null) {
  const desk = await loadDesk();
  const heart = loadHeart();
  const id = book && desk.tapes[book] ? book : "btc";
  const tape = desk.tapes[id];
  const local = scoreOpinion(desk, tape, heart.cash);
  const payload = JSON.stringify({
    book: id,
    session: desk.session,
    next: desk.next,
    hoursToNext: desk.hoursToNext,
    cash: heart.cash,
    tape: { symbol: tape.symbol, last: tape.last, regime: tape.regime, rsi: tape.rsi },
  });
  if (want === "both") {
    const [grok, gemini] = await Promise.all([answerWith("grok", id, local, payload), answerWith("gemini", id, local, payload)]);
    return { ...grok, sendsOrders: false, brains: brainStatus(), opinions: { grok, gemini } };
  }
  const brain = want ?? defaultBrain();
  const one = await answerWith(brain, id, local, payload);
  return { ...one, sendsOrders: false, brains: brainStatus() };
}

export const Route = createFileRoute("/api/live/ask")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return Response.json(await answer((url.searchParams.get("book") as BookId) || undefined, parseBrain(url.searchParams.get("brain"))));
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { book?: BookId; brain?: string };
        return Response.json(await answer(body.book, parseBrain(body.brain)));
      },
    },
  },
});
