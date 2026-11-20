import { expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./fills-vs-51.ts", import.meta.url));
function run(rows: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "miro-pred-ack-"));
  const data = join(dir, "data");
  mkdirSync(join(data, "desk"), { recursive: true });
  writeFileSync(join(data, "desk", "oms-journal.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  execFileSync("bun", [script], { cwd: dir, env: { ...process.env, MACROMIRO_DATA_DIR: data }, encoding: "utf8" });
  return readFileSync(join(dir, "data", "reports", "fills-vs-51.md"), "utf8");
}
it("never invents a fill price from a submitted limit price", () => {
  const report = run([
    { stage: "intent", ts: "2026-10-01", cid: "a", ticker: "KXBTC15M-XX", price: 0.42 },
    { stage: "sent", ts: "2026-10-01", cid: "a", ticker: "KXBTC15M-XX", fill: 0 },
    { stage: "intent", ts: "2026-10-01", cid: "b", ticker: "KXBTC15M-YY", price: 0.21 },
    { stage: "sent", ts: "2026-10-01", cid: "b", ticker: "KXBTC15M-YY", fill: 2 },
  ]);
  expect(report).toContain("2 order-send ACKs; 1 ACKs report some immediate fill");
  expect(report).toContain("Avg requested limit");
  expect(report).toContain("Execution price: UNKNOWN");
  expect(report).not.toContain("Avg price filled");
  expect(report).not.toContain("Avg price actually");
});
it("missing orders do not manufacture a fill rate", () => {
  const report = run([]);
  expect(report).toContain("0 order-send ACKs");
  expect(report).toContain("Execution price: UNKNOWN");
});
