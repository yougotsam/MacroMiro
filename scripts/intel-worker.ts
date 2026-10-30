/**
 * Research worker. Runs outside the price loop. When the desk writes data/desk/intel-request.json (a ticket passed
 * the price gate), this starts the Spark brief and a Firecrawl news search, under their existing budget caps.
 * Their results land in spark-latest.json etc., which the pre-trade checklist reads as numbers.
 * Usage: bun scripts/intel-worker.ts [--loop 30]
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { DATA_ROOT } from "../src/lib/data-root";

const file = `${DATA_ROOT}/desk/intel-request.json`;

async function once() {
  if (!existsSync(file)) return;
  let req: { series?: string; query?: string } = {};
  try {
    req = JSON.parse(readFileSync(file, "utf8"));
  } catch { /* malformed: drop it */ }
  renameSync(file, `${file}.done`);
  const spark = await import("../src/lib/live/spark.server");
  console.log("spark", spark.kickSparkOnPass());
  const fc = await import("../src/lib/live/firecrawl.server");
  await fc.searchNews(String(req.query ?? `${req.series ?? "BTC"} macro`).slice(0, 80), 5).catch((e: unknown) => console.log("firecrawl", e instanceof Error ? e.message.slice(0, 120) : e));
}

const i = process.argv.indexOf("--loop");
if (i > 0) {
  const sec = Math.max(10, Number(process.argv[i + 1] ?? 30));
  for (;;) {
    await once().catch((e) => console.log("worker", e instanceof Error ? e.message.slice(0, 160) : e));
    await new Promise((r) => setTimeout(r, sec * 1000));
  }
} else await once();
