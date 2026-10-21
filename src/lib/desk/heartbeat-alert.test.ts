import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { noteHeartbeat } from "./heartbeat-alert";

describe("stale heartbeat alert", () => {
  it("alerts once, then stays quiet, and a fresh heartbeat clears the latch", () => {
    const dir = mkdtempSync(`${tmpdir()}/mm-alert-`);
    const beat = `${dir}/beat.json`;
    const prevData = process.env.DESK_DATA_DIR;
    const prevBeat = process.env.DESK_WATCHDOG_HEARTBEAT;
    const prevTok = process.env.TELEGRAM_BOT_TOKEN;
    const prevChat = process.env.TELEGRAM_CHAT_ID;
    process.env.DESK_DATA_DIR = dir;
    process.env.DESK_WATCHDOG_HEARTBEAT = beat;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    try {
      const now = Date.parse("2026-10-21T09:00:00Z");
      const first = noteHeartbeat(now, {});
      expect(first.alerted).toBe(true);
      expect(first.why).toContain("missing");
      const second = noteHeartbeat(now + 60_000, {});
      expect(second.alerted).toBe(false);
      const lines = readFileSync(`${dir}/alerts.jsonl`, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain("TELEGRAM");
      const row = JSON.parse(lines[0]) as { subject: string; http: number | null; id: number | null };
      expect(row.subject).toContain("watchdog stale");
      expect(row.http).toBeNull();
      expect(row.id).toBeNull();
      writeFileSync(beat, JSON.stringify({ pid: 1, at: new Date(now).toISOString(), seq: 1, mode: "paper", ddLimitPct: 50, ddLimitStatus: "PENDING_OWNER_DECISION", last: null }));
      const fresh = noteHeartbeat(now + 1_000, {});
      expect(fresh.alerted).toBe(false);
      expect(fresh.why).toBe("watchdog fresh");
      unlinkSync(beat);
      const again = noteHeartbeat(now + 2_000, {});
      expect(again.alerted).toBe(true);
    } finally {
      if (prevData == null) delete process.env.DESK_DATA_DIR;
      else process.env.DESK_DATA_DIR = prevData;
      if (prevBeat == null) delete process.env.DESK_WATCHDOG_HEARTBEAT;
      else process.env.DESK_WATCHDOG_HEARTBEAT = prevBeat;
      if (prevTok == null) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = prevTok;
      if (prevChat == null) delete process.env.TELEGRAM_CHAT_ID;
      else process.env.TELEGRAM_CHAT_ID = prevChat;
    }
  });
});
