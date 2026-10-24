import { createServerFn } from "@tanstack/react-start";

/** Read-only. The snapshot is optional. The approved jobs always come from the live mode file. */
export const getGridDashboard = createServerFn({ method: "GET" }).handler(async (): Promise<string> => {
  const { readFileSync } = await import("node:fs");
  const { readMode } = await import("@/lib/ops/operating-mode");
  const live = readMode();
  const path = `${process.env.MACROMIRO_DATA_DIR || "/workspace/data"}/research/grid-dashboard.json`;
  try {
    const snap = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    snap.operatingMode = live;
    return JSON.stringify(snap);
  } catch {
    return JSON.stringify({
      generatedAt: null,
      label: "No research snapshot on disk. The approved jobs are the live mode file.",
      monitors: [],
      pilot: null,
      lastRefresh: null,
      materialChanges: [],
      spark: [],
      alexandria: { providers: null, data: [] },
      mirofish: [],
      errors: [],
      stale: [],
      creditsByCategory: {},
      budget: {},
      medianPublicationToDetectionMin: null,
      features: [],
      featureEvaluation: "snapshot missing",
      modelPerformanceEffect: "unknown",
      operatingMode: live,
    });
  }
});
