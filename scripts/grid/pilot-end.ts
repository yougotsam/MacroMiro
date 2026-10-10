/** Ends the measured pilot: pauses every pilot monitor (nothing recurring continues without Sameer's approval),
 * then writes the summary. `bun scripts/grid/pilot-end.ts` (scheduled automatically at pilot.endsAt). */
import { readFileSync, writeFileSync } from "node:fs";
import { fc } from "../../src/lib/grid/fc.server";
import { DATA_ROOT } from "../../src/lib/data-root";

const f = `${DATA_ROOT}/research/grid-monitors.json`;
const s = JSON.parse(readFileSync(f, "utf8"));
for (const m of s.monitors.filter((x: { id: string | null; status: string }) => x.id && x.status === "active")) {
  const r = await fc("PATCH", `monitor/${m.id}`, "monitor", { status: "paused" });
  console.log("pause", m.key, r.http, r.error);
  if (r.ok) { m.status = "paused"; m.reason = `pilot ended ${new Date().toISOString()}; resume only with Sameer's approval`; }
  await new Promise((x) => setTimeout(x, 7000));
}
s.pilot = { ...s.pilot, endedAt: new Date().toISOString() };
writeFileSync(f, JSON.stringify(s, null, 1));
await import("./pilot-summary.ts");
