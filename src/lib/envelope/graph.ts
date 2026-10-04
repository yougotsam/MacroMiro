export const GRAPH_KEY = "envelope.graph.v1";

export type Hypothesis = {
  id: string;
  thesis: string;
  result: "pass" | "fail";
  pnl: number;
  at: string;
  source: "paper" | "walk";
};

export function loadGraph(): Hypothesis[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(GRAPH_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as Hypothesis[];
    return Array.isArray(data) ? data.slice(0, 80) : [];
  } catch {
    return [];
  }
}

export function saveGraph(nodes: Hypothesis[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(GRAPH_KEY, JSON.stringify(nodes.slice(0, 80)));
  } catch {
    /* quota */
  }
}

export function remember(nodes: Hypothesis[], row: Omit<Hypothesis, "id" | "at">): Hypothesis[] {
  const next: Hypothesis = {
    ...row,
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    at: new Date().toISOString(),
  };
  const out = [next, ...nodes].slice(0, 80);
  saveGraph(out);
  return out;
}
