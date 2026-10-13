import { createServerFn } from "@tanstack/react-start";

export type Dashboard = {
  generatedAt: string;
  scenarios: { label: string; jobs: Array<Record<string, unknown>>; archive: { items: number; matches: number; incremental: Record<string, unknown> } };
  calibratedProbabilities: { label: string; milestone: unknown; collector: unknown; calendar: unknown };
} | null;

/** Read-only: the dashboard file written by `research-pipeline.ts dashboard`. No input, no writes, no orders. */
export const getResearchDashboard = createServerFn({ method: "GET" }).handler(async (): Promise<string> => {
  const { readFileSync } = await import("node:fs");
  try {
    return readFileSync(`${process.env.RESEARCH_DIR || "/workspace/data/research"}/dashboard.json`, "utf8");
  } catch {
    return "null";
  }
});
