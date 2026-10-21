import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blindScore } from "./blind-score";
import { clearIndexSnaps, higherBars, indexVeto, minuteCandles, refreshIndexBars, type PrintLine } from "./index-bars";
import { validateBars } from "./market-data";
import { sniperCanEnter } from "./sniper";

const GOLD = "Metal.Index.1OZGOLD/USD";

function prints(index: string, minutes: number[]): PrintLine[] {
  return minutes.map((m) => ({ i: index, t: m * 60_000 + 500, v: 2000 + m * 0.05 + (m % 5) * 0.4 }));
}

describe("index bars", () => {
  it("does not fill a gap, and one print is enough for a minute", () => {
    const now = 45 * 60_000;
    const have = [...Array(45).keys()].filter((m) => m !== 7);
    const lines = prints(GOLD, have);
    expect(minuteCandles(lines, now)).toHaveLength(44);
    const built = refreshIndexBars({ lines, now });
    const gold = built.find((s) => s.series === "KXGOLD15M");
    expect(gold?.m15.map((b) => b.t)).toEqual([15 * 60_000, 30 * 60_000]);
    expect(gold?.m15.every((b) => b.v == null && b.delta == null)).toBe(true);
    expect(gold?.gaps15).toBeGreaterThan(0);
    const hole = higherBars(minuteCandles(prints(GOLD, [...Array(15).keys()].filter((m) => m !== 3)), now), 15, now);
    expect(hole.bars).toHaveLength(0);
    expect(hole.gaps).toBe(1);
    clearIndexSnaps();
  });

  it("sixty complete bars score, and the tape stays unavailable", () => {
    clearIndexSnaps();
    const n = 60 * 15;
    const now = (n + 1) * 60_000;
    refreshIndexBars({ lines: prints(GOLD, [...Array(n).keys()]), now });
    const scored = blindScore("KXGOLD15M", true);
    expect(scored).not.toBeNull();
    expect(scored!.long.score).toBeGreaterThan(0);
    expect(scored!.long.points.momentum + scored!.long.points.structure + scored!.long.points.regime).toBeGreaterThan(0);
    expect(scored!.long.points.flow).toBe(0);
    expect(scored!.long.missing).toContain("real exchange volume");
    expect(scored!.long.missing).toContain("signed trade flow");
    expect(scored!.long.eligible).toBe(false);
    expect(scored!.flow.why).toBe("unavailable: no venue tape");
    expect(scored!.flow.rvol).toBeNull();
    expect(scored!.flow.cvd).toBeNull();
    expect(scored!.flow.vwap).toBeNull();
    expect(blindScore("KXBTC15M", true)).toBeNull();
    clearIndexSnaps();
  });

  it("a short history does not open a ticket", () => {
    clearIndexSnaps();
    const n = 40 * 15;
    const now = (n + 1) * 60_000;
    refreshIndexBars({ lines: prints(GOLD, [...Array(n).keys()]), now });
    const scored = blindScore("KXGOLD15M", true)!;
    expect(scored.long.setup).toBe("NONE");
    expect(scored.long.score).toBe(0);
    expect(scored.long.missing).toEqual([indexVeto(40)]);
    expect(scored.long.eligible).toBe(false);
    expect(sniperCanEnter(scored.long)).toBe(false);
    expect(sniperCanEnter(scored.short)).toBe(false);
    clearIndexSnaps();
  });

  it("writes price bars without volume, which the exchange validator would drop", () => {
    clearIndexSnaps();
    const now = 16 * 60_000;
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    refreshIndexBars({ lines: prints(GOLD, [...Array(15).keys()]), now, outDir: dir });
    const text = readFileSync(join(dir, "KXGOLD15M-15m.jsonl"), "utf8");
    expect(text).not.toContain('"v"');
    const rows = text.trim().split("\n").map((l) => JSON.parse(l) as { t: number; o: number; h: number; l: number; c: number });
    expect(rows).toHaveLength(1);
    expect(validateBars(rows, 15, now).bars).toHaveLength(0);
    clearIndexSnaps();
  });
});
