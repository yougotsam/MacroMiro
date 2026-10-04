import { createFileRoute } from "@tanstack/react-router";
import { scoreOpinion, type Opinion, type Play } from "@/lib/envelope/opinion";
import { loadHeart } from "@/lib/envelope/store.server";
import { loadDesk } from "@/lib/live/server";
import type { BookId } from "@/lib/live/types";

const PLAYS = ["sit", "scalp", "event"] as const;

const CLERK =
  "You are the desk clerk. Repeat docs/STRATEGY.md. Do not invent a second rule. " +
  "A normal ticket is 25 cents to 45 cents and is held to the clock. " +
  "During CPI, the jobs report, or the Fed, the band is 20 cents to 40 cents and the size is four times. " +
  "Perpetuals are a separate Kalshi margin book. Spark is a sentence, not a vote. " +
  "JSON only: plays [{id sit|scalp|event, score 0-100, title, why}], pick, sizeUsd (0 if sit, otherwise 1 to 20).";

async function answer(book: BookId | undefined): Promise<Opinion> {
  const desk = await loadDesk();
  const heart = loadHeart();
  const id = book && desk.tapes[book] ? book : "btc";
  const tape = desk.tapes[id];
  const local = scoreOpinion(desk, tape, heart.cash);
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return local;
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 500,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLERK },
          {
            role: "user",
            content: JSON.stringify({
              book: id,
              session: desk.session,
              next: desk.next,
              hoursToNext: desk.hoursToNext,
              cash: heart.cash,
              tape: { symbol: tape.symbol, last: tape.last, regime: tape.regime, rsi: tape.rsi },
            }),
          },
        ],
      }),
    });
    if (!res.ok) return { ...local, clerk: "local" };
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "") as {
      pick?: string;
      sizeUsd?: number;
      plays?: { id: string; score: number; title: string; why: string }[];
    };
    const plays: Play[] = (parsed.plays ?? [])
      .filter((p) => PLAYS.includes(p.id as (typeof PLAYS)[number]))
      .map((p) => ({ id: p.id as Play["id"], score: Number(p.score) || 0, title: String(p.title || p.id), why: String(p.why || "") }))
      .sort((a, b) => b.score - a.score);
    if (!plays.length) return local;
    const pick = plays.find((p) => p.id === parsed.pick) ?? plays[0];
    const sizeUsd = pick.id === "sit" ? 0 : Math.max(1, Math.min(20, Math.round(Number(parsed.sizeUsd) || local.sizeUsd)));
    return { pick, plays, sizeUsd, clerk: "grok-4.5" };
  } catch {
    return local;
  }
}

export const Route = createFileRoute("/api/live/ask")({
  server: {
    handlers: {
      GET: async () => Response.json(await answer(undefined)),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { book?: BookId };
        return Response.json(await answer(body.book));
      },
    },
  },
});
