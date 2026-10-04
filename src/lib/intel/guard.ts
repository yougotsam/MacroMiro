const HOSTILE = /ignore (all |any )?(previous|prior) instructions|you are now|place (an )?order|system prompt/i;

export function hostile(text: string) {
  return HOSTILE.test(text);
}

export function orderTrace<T extends { producerSequence?: number; agent?: { id?: string }; eventId?: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const agent = (a.agent?.id || "").localeCompare(b.agent?.id || "");
    if (agent) return agent;
    return (a.producerSequence ?? 0) - (b.producerSequence ?? 0);
  });
}

export function shadowUse(input: { delta: number | null; contradiction: number; primary: number; marketFresh: boolean; hostileText: boolean }) {
  if (input.hostileText) return { apply: false, delta: null, reason: "page text was an instruction" };
  if (!input.marketFresh) return { apply: false, delta: null, reason: "direct market data is not fresh" };
  if (input.contradiction >= 0.6) return { apply: false, delta: null, reason: "contradiction unresolved" };
  if (input.primary < 1) return { apply: false, delta: null, reason: "no primary source" };
  if (input.delta == null) return { apply: false, delta: null, reason: "missing news is unknown" };
  return { apply: true, delta: input.delta, reason: "shadow only" };
}
