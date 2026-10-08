/**
 * Which model brains the desk can ask for an opinion. Names only, no network.
 * A brain writes words for Ask and screen notes. It never sizes, gates, or sends an order.
 * The 15-minute order rule is src/lib/scan/edge.ts and nothing here can reach it.
 */

export type BrainId = "grok" | "gemini";
export const BRAINS: readonly BrainId[] = ["grok", "gemini"] as const;

/** Default desk brain. Change with DESK_MODEL, not by editing call sites. */
export const DESK_MODEL_DEFAULT = "grok-4.7";
/** Second brain. Change with GEMINI_MODEL. */
export const GEMINI_MODEL_DEFAULT = "gemini-3.8-flash";

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

function pick(raw: string | undefined, fallback: string) {
  const v = (raw ?? "").trim();
  return MODEL_ID.test(v) ? v : fallback;
}

/** xAI model id for the grok brain and the perp debate line. */
export function deskModel(): string {
  return pick(process.env.DESK_MODEL, DESK_MODEL_DEFAULT);
}

export function geminiModel(): string {
  return pick(process.env.GEMINI_MODEL, GEMINI_MODEL_DEFAULT);
}

export function brainModel(brain: BrainId): string {
  return brain === "gemini" ? geminiModel() : deskModel();
}

/** A brain is ready only when its key is in this process's env. The key itself is never returned. */
export function brainReady(brain: BrainId): boolean {
  const key = brain === "gemini" ? process.env.GEMINI_API_KEY : process.env.XAI_API_KEY;
  return typeof key === "string" && key.trim().length >= 12;
}

/** DESK_BRAIN picks the default for Ask (grok unless set to gemini and the Gemini key is present). */
export function defaultBrain(): BrainId {
  const want = (process.env.DESK_BRAIN ?? "").trim().toLowerCase();
  if (want === "gemini" && brainReady("gemini")) return "gemini";
  return "grok";
}

export function parseBrain(raw: unknown): BrainId | "both" | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "grok" || v === "xai") return "grok";
  if (v === "gemini") return "gemini";
  if (v === "both") return "both";
  return null;
}

export function brainStatus() {
  return BRAINS.map((id) => ({ id, model: brainModel(id), ready: brainReady(id), default: id === defaultBrain() }));
}
