/** Independent process. No venue writes unless explicitly run against a dedicated demo account. */
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { PerpsSubmissionBarrier, pagePerpsStop, perpsWatchdogTick, reportPerpsIncident } from "../../src/lib/perps/emergency-control";
import { MARGIN_HOSTS } from "../../src/lib/perps/venue-config";

const journal = process.env.MACROMIRO_PERPS_JOURNAL;
if (!journal || !existsSync(journal)) throw new Error("select an existing persistent MACROMIRO_PERPS_JOURNAL");
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !["--kill", "--once", "--flatten-demo"].includes(arg))) throw new Error("unknown watchdog argument");
if (args.has("--flatten-demo") && MARGIN_HOSTS.mode !== "demo") throw new Error("emergency dispatch requires the demo environment");

if (args.has("--kill")) {
  new PerpsSubmissionBarrier(journal).latch("OPERATOR_HALT");
  reportPerpsIncident(journal, "OPERATOR_HALT");
}
for (;;) {
  const state = perpsWatchdogTick(journal);
  if (!state.ok) {
    const webhook = process.env.MACROMIRO_PERPS_ALERT_WEBHOOK;
    const page = webhook ? pagePerpsStop(journal, webhook).catch(() => {
      console.error("SEV1: operator page delivery failed; alert remains on disk for retry");
    }) : Promise.resolve();
    try {
      if (args.has("--flatten-demo")) {
        const { PerpsOms } = await import("../../src/lib/perps/oms");
        const { liveMarginTransport } = await import("../../src/lib/perps/live-transport");
        const { perpsReader } = await import("../../src/lib/perps/kalshi-perps-read");
        const token = process.env.PERPS_KILL_TOKEN;
        const tokenFile = process.env.PERPS_KILL_TOKEN_FILE;
        if (!token || !tokenFile) throw new Error("demo flatten requires the operator token and its private verifier file");
        const oms = new PerpsOms(liveMarginTransport, journal, true);
        const result = await oms.killAndFlatten(token, readFileSync(tokenFile, "utf8").trim(), ticker => perpsReader().book(ticker), "watchdog");
        console.error(JSON.stringify(result));
      }
    } finally { await page; }
    // Alert supervisor even if the demo venue confirms flat. Never auto-rearm.
    process.exitCode = 2;
    break;
  }
  if (args.has("--once")) break;
  await sleep(1_000);
}
