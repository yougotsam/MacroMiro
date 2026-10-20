import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshWindowBlocks, setWindowBlocks, windowRefusal } from "./window-block";

function row(ticker: string, series: string, tte: number, p: number, ask: number): string {
  return JSON.stringify({
    ts: "2026-10-20T00:00:00Z",
    ticker,
    series,
    tte_s: tte,
    p,
    quotes: { yes_bid: ask - 0.02, yes_ask: ask },
    fee_multiplier: 1,
  });
}

describe("a losing window is refused", () => {
  it("blocks gold's last 90 seconds once 15 contracts lost, and leaves a winner alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "windows-"));
    const decisions: string[] = [];
    const outcomes: string[] = [];
    for (let i = 0; i < 15; i += 1) {
      decisions.push(row(`KXGOLD15M-L${i}`, "KXGOLD15M", 40, 0.7, 0.6));
      outcomes.push(JSON.stringify({ ticker: `KXGOLD15M-L${i}`, result: "no" }));
      decisions.push(row(`KXBTC15M-W${i}`, "KXBTC15M", 40, 0.7, 0.4));
      outcomes.push(JSON.stringify({ ticker: `KXBTC15M-W${i}`, result: "yes" }));
    }
    for (let i = 0; i < 10; i += 1) {
      decisions.push(row(`KXGOLD15M-M${i}`, "KXGOLD15M", 200, 0.7, 0.6));
      outcomes.push(JSON.stringify({ ticker: `KXGOLD15M-M${i}`, result: "no" }));
    }
    writeFileSync(join(dir, "decisions.jsonl"), `${decisions.join("\n")}\n`);
    writeFileSync(join(dir, "outcomes.jsonl"), `${outcomes.join("\n")}\n`);
    try {
      expect(refreshWindowBlocks(dir)).toEqual(["KXGOLD15M|final"]);
      expect(windowRefusal("KXGOLD15M", 40)).toBe("G2_window_KXGOLD15M_final");
      expect(windowRefusal("KXGOLD15M", 90)).toBe("G2_window_KXGOLD15M_final");
      expect(windowRefusal("KXGOLD15M", 200)).toBeNull();
      expect(windowRefusal("KXBTC15M", 40)).toBeNull();
    } finally {
      setWindowBlocks([]);
    }
  });
});
