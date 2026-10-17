import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardFromEvents } from "./board";
import { bracketCheck, classifySector, domainAgents, geminiPasses, repricing, rungFor, scenarioSeed } from "./flip";
import { applyPreset, emptyLedger, pushShadow, readLedger, writeLedger } from "./ledger";

describe("omni flip", () => {
  it("sorts tech, sports, culture, and macro off the title", () => {
    expect(classifySector("Best AI model this week", "KXAI")).toBe("tech");
    expect(classifySector("Google search share", "KXGOOG")).toBe("tech");
    expect(classifySector("NBA finals", "KXNBA")).toBe("sports");
    expect(classifySector("Box office weekend", "KXBOX")).toBe("culture");
    expect(classifySector("CPI year over year", "KXCPI")).toBe("macro");
    expect(classifySector("Bitcoin 15 minute", "KXBTC15M-1")).toBe("crypto");
    expect(classifySector("Bitcoin perp", "KXBTCPERP")).toBe("perps");
  });

  it("repricing stays inside 8¢ to 30¢ and never invents a win rate", () => {
    expect(repricing(0.07).eligible).toBe(false);
    expect(repricing(0.31).eligible).toBe(false);
    const mid = repricing(0.18);
    expect(mid.target).toBe(0.45);
    expect(mid.multiple).toBe(2.5);
    expect(repricing(0.3).target).toBe(0.6);
  });

  it("a bracket sum under a dollar is a check, and one leg is not", () => {
    expect(bracketCheck([0.2, 0.2, 0.2]).flag).toBe(true);
    expect(bracketCheck([0.4, 0.4, 0.3]).flag).toBe(false);
    expect(bracketCheck([0.2]).flag).toBe(false);
  });

  it("builds a ranked board and leaves probability unknown", () => {
    const rows = boardFromEvents([{
      event_ticker: "KXAIWEEK",
      title: "Best AI this week",
      category: "Tech",
      markets: [
        { ticker: "KXAI-G", event_ticker: "KXAIWEEK", yes_sub_title: "Gemini", status: "open", yes_ask_dollars: "0.22", yes_bid_dollars: "0.20" },
        { ticker: "KXAI-C", event_ticker: "KXAIWEEK", yes_sub_title: "Claude", status: "open", yes_ask_dollars: "0.18", yes_bid_dollars: "0.16" },
      ],
    }]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.winProbability === "UNKNOWN")).toBe(true);
    expect(rows[0].mode).toBe("bracket");
    expect(rows[0].sector).toBe("tech");
  });

  it("the seed names five roles and forbids a settlement probability", () => {
    expect(domainAgents("sports")).toHaveLength(5);
    const seed = scenarioSeed({ question: "Who covers?", ticker: "KXNBA-1", sector: "sports", yesAsk: 0.24 });
    expect(seed).toContain("Wire");
    expect(seed).toContain("not a market chance");
    expect(seed).not.toMatch(/91%/);
    expect(geminiPasses("Best AI this week")).toHaveLength(3);
    expect(geminiPasses("Best AI this week")[2]).toContain("UNKNOWN");
  });

  it("the ladder and the disk ledger do not book a profit", () => {
    expect(rungFor(100).name).toBe("1");
    expect(rungFor(250).name).toBe("2");
    expect(rungFor(10000).finished).toBe(true);
    const prev = process.env.MACROMIRO_DATA_DIR;
    const dir = mkdtempSync(join(tmpdir(), "flip-"));
    process.env.MACROMIRO_DATA_DIR = dir;
    writeLedger(applyPreset(emptyLedger(), 200, null));
    const next = pushShadow(readLedger(), { ticker: "KXAI-G", question: "Best AI", mode: "repricing", side: "YES", entry: 0.22, target: 0.45, multiple: 2.05 });
    writeLedger(next);
    const saved = readLedger();
    expect(saved.trackedCash).toBe(200);
    expect(saved.flips[0].status).toBe("shadow");
    expect(saved.flips[0].outcome).toBeNull();
    if (prev == null) delete process.env.MACROMIRO_DATA_DIR;
    else process.env.MACROMIRO_DATA_DIR = prev;
  });
});
