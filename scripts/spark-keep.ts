/**
 * Keeps the Spark clock alive. Importing the Spark module arms a 30-minute check.
 * A new Firecrawl brief is attempted at most every 6 hours, and only if research spend is allowed.
 * This process does not send orders.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = "/workspace/data/loop";
const pidFile = `${dir}/spark-keep.pid`;
mkdirSync(dir, { recursive: true });
if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (pid && pid !== process.pid) {
    try {
      process.kill(pid, 0);
      process.exit(0);
    } catch {
      /* the old clock is dead */
    }
  }
}
writeFileSync(pidFile, String(process.pid));
await import("../src/lib/live/spark.server.ts");
setInterval(() => undefined, 3_600_000);
