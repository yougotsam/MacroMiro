import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probabilityFromReport } from "./mirofish.ts";

describe("mirofish report", () => {
  it("reads a percent and a decimal, and refuses a missing number", () => {
    assert.equal(probabilityFromReport("crowd continues in 80% of runs"), 0.8);
    assert.equal(probabilityFromReport("p = 0.42 after the print"), 0.42);
    assert.equal(probabilityFromReport("no figure in this note"), null);
  });
});
