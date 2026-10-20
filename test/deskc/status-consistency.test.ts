import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  APPROVAL_POLICY_ENFORCED,
  CALIBRATED_MODEL_APPROVED,
  DAILY_STOP_USD,
  MODEL_VERSION,
} from "../../src/lib/desk/config";
import { renderStatusSnapshot } from "../../scripts/deskc/status-snapshot";

const read = (p: string) => readFileSync(p, "utf8");

describe("desk status docs match config.ts", () => {
  const readme = read("README.md");
  const strategy = read("docs/STRATEGY.md");
  const agents = read("AGENTS.md");
  const status = `${readme}\n${strategy}\n${agents}`;

  it("the live switch in the docs is the live switch in the code", () => {
    expect(CALIBRATED_MODEL_APPROVED).toBe(true);
    expect(readme).toContain("CALIBRATED_MODEL_APPROVED");
    expect(readme).toContain("LIVE 15-minute tickets");
    expect(readme).not.toContain("RESEARCH / SHADOW ONLY");
    expect(strategy).toContain("CALIBRATED_MODEL_APPROVED=true");
    expect(agents).toContain("CALIBRATED_MODEL_APPROVED=true");
    expect(agents).not.toContain("paper only");
  });

  it("the approval policy is named as not enforced, not described as the live path", () => {
    expect(APPROVAL_POLICY_ENFORCED).toBe(false);
    expect(strategy).toContain("APPROVAL_POLICY_ENFORCED=false");
    expect(strategy).toContain("NOT ENFORCED");
    expect(strategy).toContain("pre-round-3 gate path is the ACTIVE path");
  });

  it("the day stop in the status lines is the code day stop, not the old -5", () => {
    expect(DAILY_STOP_USD).toBe(-15);
    expect(strategy).toContain("DAILY_STOP_USD=-15");
    expect(strategy).not.toContain("-$5 daily");
    expect(status).toContain(MODEL_VERSION);
  });

  it("the retired edge file is marked dead", () => {
    expect(strategy).toContain("RETIRED: src/lib/scan/edge.ts does not exist");
  });

  it("the generated snapshot matches the constants", () => {
    expect(read("docs/status/SNAPSHOT.md")).toBe(renderStatusSnapshot());
  });
});
