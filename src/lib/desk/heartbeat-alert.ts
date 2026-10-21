/**
 * One alert when the watchdog heartbeat is stale, then silence for 30 minutes.
 * A fresh heartbeat clears the latch. This file does not send an order.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dataDir } from "./config";
import { readHeartbeat, watchdogFresh } from "../loop/watchdog";

const GAP_MS = 30 * 60 * 1000;

function latchPath() {
  return `${dataDir()}/heartbeat-alert.json`;
}

export function noteHeartbeat(now = Date.now(), env: NodeJS.ProcessEnv = process.env): { alerted: boolean; why: string } {
  const fresh = watchdogFresh(now);
  if (fresh.ok) {
    try {
      if (existsSync(latchPath())) unlinkSync(latchPath());
    } catch {
      /* the next stale check will try again */
    }
    return { alerted: false, why: fresh.why };
  }
  let last = 0;
  try {
    last = Number(JSON.parse(readFileSync(latchPath(), "utf8")).at ?? 0);
  } catch {
    last = 0;
  }
  if (Number.isFinite(last) && now - last < GAP_MS) return { alerted: false, why: "alert already sent" };
  const row = { ts: new Date(now).toISOString(), why: fresh.why, heartbeat: readHeartbeat()?.at ?? null };
  mkdirSync(dataDir(), { recursive: true });
  appendFileSync(`${dataDir()}/alerts.jsonl`, `${JSON.stringify(row)}\n`);
  writeFileSync(latchPath(), JSON.stringify({ at: now }));
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  const chat = env.TELEGRAM_CHAT_ID ?? "";
  if (token && chat) {
    void fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `MacroMiro watchdog stale: ${fresh.why}` }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => undefined);
  }
  return { alerted: true, why: fresh.why };
}
