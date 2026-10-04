import { readFileSync } from "node:fs";
import type { ScanPayload, ScanRow } from "./types";

const TOKEN_FILE = "/workspace/.grok/secrets/tg_token";
const CHAT_FILE = "/workspace/.grok/secrets/tg_chat";

function token() {
  const env = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (env.includes(":")) return env;
  try {
    const disk = readFileSync(TOKEN_FILE, "utf8").trim();
    if (disk.includes(":")) {
      process.env.TELEGRAM_BOT_TOKEN = disk;
      return disk;
    }
  } catch {
    /* missing */
  }
  return "";
}

function chatId() {
  const env = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
  if (env) return env;
  try {
    const disk = readFileSync(CHAT_FILE, "utf8").trim();
    if (disk) {
      process.env.TELEGRAM_CHAT_ID = disk;
      return disk;
    }
  } catch {
    /* missing */
  }
  return "";
}

export function telegramReady() {
  return Boolean(token() && chatId());
}

type SendOk = { ok: true; id: number };
type SendErr = { ok: false; error: string };

export async function sendTelegram(text: string): Promise<SendOk | SendErr> {
  const t = token();
  const chat = chatId();
  if (!t || !chat) return { ok: false, error: "no telegram secret" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: text.slice(0, 3500),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!json.ok) return { ok: false, error: json.description || `http ${res.status}` };
    return { ok: true, id: json.result?.message_id ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

function etNow() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });
}

function lastOf(rows: ScanRow[], venue: ScanRow["venue"], re: RegExp) {
  return rows.find((r) => r.venue === venue && re.test(r.market) && r.price != null)?.price ?? null;
}

function parseAbove(q: string): { strike: number; day: string } | null {
  const m = q.match(/above\s+\$([0-9,]+)[^\d]{0,40}?(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/i);
  if (!m) return null;
  const mon = m[2].slice(0, 3);
  return { strike: Number(m[1].replace(/,/g, "")), day: `${mon} ${m[3]}` };
}

function polyLadder(rows: ScanRow[]) {
  const hits: { day: string; strike: number; px: number }[] = [];
  for (const r of rows) {
    if (r.venue !== "polymarket" && r.venue !== "polyus") continue;
    if (r.price == null) continue;
    const p = parseAbove(r.market);
    if (!p) continue;
    hits.push({ day: p.day, strike: p.strike, px: r.price });
  }
  const byDay = new Map<string, { strike: number; px: number }[]>();
  for (const h of hits) {
    const list = byDay.get(h.day) ?? [];
    list.push({ strike: h.strike, px: h.px });
    byDay.set(h.day, list);
  }
  const lines: string[] = [];
  for (const [day, list] of [...byDay.entries()].sort()) {
    const cells = list
      .sort((a, b) => a.strike - b.strike)
      .slice(0, 4)
      .map((x) => `$${x.strike.toLocaleString("en-US")} ${x.px.toFixed(3)}`)
      .join("  ");
    lines.push(`${day}  ${cells}`);
  }
  return lines;
}

/** Manual Ping Zeebs only. Kalshi 15m books this account can actually trade. */
export function formatScanPing(data: ScanPayload) {
  const lines = [`${etNow()} ET`, "Kalshi 15m paper"];
  const books = data.rows.filter((r) => r.venue === "kalshi").slice(0, 8);
  if (!books.length) {
    lines.push("no Kalshi books");
    return lines.join("\n");
  }
  for (const r of books) {
    const px = r.price == null ? "—" : r.price.toFixed(3);
    lines.push(`${r.market.slice(0, 42)}  ${px}  ${r.note.slice(0, 48)}`);
  }
  lines.push("Ping is a snapshot. HEART papers fills on ARM.");
  return lines.join("\n");
}

/** Auto pings are off. Only Ping Zeebs (force) sends. */
export async function pingScan(data: ScanPayload, force = false) {
  if (!telegramReady()) return { sent: false, reason: "down" as const };
  if (!force) return { sent: false, reason: "idle" as const };
  const res = await sendTelegram(formatScanPing(data));
  if (!res.ok) return { sent: false, reason: "error" as const, error: res.error };
  return { sent: true, reason: "ok" as const, id: res.id };
}
