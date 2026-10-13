import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Feeds } from "./feeds";

describe("feed print flush keeps records on failure", () => {
  it("a failed append keeps the queue; the next successful flush writes it", () => {
    const root = mkdtempSync(`${tmpdir()}/flush-`);
    const blocker = `${root}/blocked`;
    writeFileSync(blocker, "x"); // a FILE where the data dir should be → mkdir/append fails
    const prev = process.env.DESK_DATA_DIR;
    const f = new Feeds(false) as unknown as { pending: string[]; flush(): void };
    f.pending.push('{"i":"t","t":1,"v":1}');
    process.env.DESK_DATA_DIR = blocker;
    f.flush();
    expect(f.pending.length).toBe(1);
    process.env.DESK_DATA_DIR = `${root}/ok`;
    f.flush();
    expect(f.pending.length).toBe(0);
    const day = readdirSync(`${root}/ok/prints`)[0];
    expect(readFileSync(`${root}/ok/prints/${day}`, "utf8")).toContain('"v":1');
    process.env.DESK_DATA_DIR = prev;
    if (prev === undefined) delete process.env.DESK_DATA_DIR;
  });
});
