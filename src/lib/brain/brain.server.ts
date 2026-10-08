import { brainModel, brainReady, type BrainId } from "./model";

/**
 * Text in, text out. Opinions only: Ask and screen notes.
 * Nothing in the order path imports this file (see brain.test.ts).
 */

export type BrainAnswer = { brain: BrainId; model: string; text: string; ms: number };

export type BrainCall = {
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
};

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** grok-4.7 reasons before it answers. Gemini 3.8 Flash has answered in ~45s on this box. */
export const BRAIN_TIMEOUT_MS: Record<BrainId, number> = { grok: 45_000, gemini: 90_000 };

async function callGrok(c: BrainCall, model: string): Promise<string> {
  const key = process.env.XAI_API_KEY ?? "";
  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(c.timeoutMs ?? BRAIN_TIMEOUT_MS.grok),
    body: JSON.stringify({
      model,
      max_tokens: c.maxTokens ?? 1500,
      temperature: 0.2,
      ...(c.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: c.system },
        { role: "user", content: c.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`grok ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("grok empty");
  return text;
}

async function callGemini(c: BrainCall, model: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY ?? "";
  const res = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(c.timeoutMs ?? BRAIN_TIMEOUT_MS.gemini),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: c.system }] },
      contents: [{ role: "user", parts: [{ text: c.user }] }],
      generationConfig: {
        maxOutputTokens: c.maxTokens ?? 1500,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: "low" },
        ...(c.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  if (!text) throw new Error("gemini empty");
  return text;
}

export async function askBrain(brain: BrainId, c: BrainCall): Promise<BrainAnswer> {
  if (!brainReady(brain)) throw new Error(`${brain} key missing`);
  const model = brainModel(brain);
  const t0 = Date.now();
  const text = brain === "gemini" ? await callGemini(c, model) : await callGrok(c, model);
  return { brain, model, text, ms: Date.now() - t0 };
}
