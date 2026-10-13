import { createServerFn } from "@tanstack/react-start";

const root = () => process.env.MACROMIRO_DATA_DIR || "/workspace/data";

/** Read-only: the paper research file written by `npm run paper` / `npm run paper:loop`. No orders. */
export const getPaper = createServerFn({ method: "GET" }).handler(async (): Promise<string> => {
  const { readFileSync } = await import("node:fs");
  try {
    return readFileSync(`${root()}/paper/paper-latest.json`, "utf8");
  } catch {
    return "null";
  }
});

/**
 * Research mode switch from the page. Only STANDBY / OBSERVATION / PAPER: none of them can enable live orders
 * (LIVE_TRADING is refused by writeMode) and PAPER approves no paid Firecrawl job.
 */
export const setDeskMode = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const m = (d as { mode?: string })?.mode;
    if (m !== "FULL_STANDBY" && m !== "MARKET_DATA_ONLY" && m !== "RESEARCH_PAPER") throw new Error("mode must be FULL_STANDBY, MARKET_DATA_ONLY or RESEARCH_PAPER");
    return { mode: m as "FULL_STANDBY" | "MARKET_DATA_ONLY" | "RESEARCH_PAPER" };
  })
  .handler(async ({ data }) => {
    const { writeMode } = await import("@/lib/ops/operating-mode");
    return writeMode(data.mode, [], "desk page");
  });
