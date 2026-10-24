import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CALIBRATED_MODEL_APPROVED,
  LOSS_STREAK_PAUSE,
  POST_LOSS_PAUSE_MS,
  PRICE_MAX,
  PRICE_MIN,
} from "./config";
import { PERPS_ORDERS_LOCKED } from "@/lib/perps/order-adapter";
import { emaPullback, fibRetrace } from "./strategies";
import type { Bar } from "./features";

const banned = [
  "18¢",
  "5¢–95¢",
  "5¢ to 95¢",
  "Buy from 5¢",
  "Under 5¢",
  "72¢",
  "Live is disabled",
  "NO LIVE TRADE",
  "bearish brief does not cancel",
  "at most 4 points",
  "PERPS_ORDERS_LOCKED` is true",
  "PERPS_ORDERS_LOCKED is a const `true`",
  "4–72¢",
  "CALIBRATED_MODEL_APPROVED` is false",
];

const files = [
  "README.md",
  "docs/STRATEGY.md",
  "docs/operations/ORDER_PATH.md",
  "docs/operations/RISK_MANDATES.md",
  "docs/operations/INTELLIGENCE_AUDIT.md",
  "docs/operations/PROBABILITY_MATRIX.md",
  "docs/strategies/EVIDENCE_GATE.md",
  "src/lib/kb/content.ts",
  "src/lib/envelope/opinion.ts",
  "src/lib/scan/updown.ts",
  "src/lib/desk/calibration.ts",
  "src/lib/perps/oms.ts",
];

describe("one rule set", () => {
  it("the constants the order path reads", () => {
    expect(PRICE_MIN).toBe(0.36);
    expect(PRICE_MAX).toBe(0.95);
    expect(LOSS_STREAK_PAUSE).toBe(3);
    expect(POST_LOSS_PAUSE_MS).toBe(20 * 60_000);
    expect(CALIBRATED_MODEL_APPROVED).toBe(true);
    expect(PERPS_ORDERS_LOCKED).toBe(false);
  });

  it("the pages that operators read do not still describe the old band or the old news rule", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const phrase of banned) {
        if (text.includes(phrase)) hits.push(`${f}: ${phrase}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("fib and the average pullback do not emit the dead chase prefix", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 60; i += 1) {
      const c = 100 + Math.sin(i / 5) * 2;
      bars.push({ t: i * 60_000, o: c - 0.2, h: c + 0.4, l: c - 0.4, c });
    }
    for (const call of [fibRetrace(bars), emaPullback(bars)]) {
      if (!call) continue;
      expect(call.why.startsWith("20-EMA")).toBe(false);
    }
  });
});
