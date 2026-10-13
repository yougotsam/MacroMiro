import { createServerFn } from "@tanstack/react-start";

/** Read-only: the Intel Grid dashboard file written by `bun scripts/grid/dashboard.ts`. No input, no writes, no orders. */
export const getGridDashboard = createServerFn({ method: "GET" }).handler(async (): Promise<string> => {
  const { readFileSync } = await import("node:fs");
  try {
    return readFileSync(`${process.env.MACROMIRO_DATA_DIR || "/workspace/data"}/research/grid-dashboard.json`, "utf8");
  } catch {
    return "null";
  }
});
