import WebSocket from "ws";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { kalshiWsHeaders } from "@/lib/scan/kalshi-auth";
import { applyXau, controlPyth, emptyXau, parsePyth, seedXau, xauStatus, XAU_TICKER, type XauMinute, type XauSession } from "@/lib/skill/pyth-session";
import { DATA_ROOT } from "@/lib/data-root";

const URL = "wss://api.elections.kalshi.com/trade-api/ws/v2";

type Socket = {
  send: (data: string) => void;
  close: () => void;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
};

const g = globalThis as typeof globalThis & {
  __xau?: {
    session: XauSession;
    socket: Socket | null;
    timer: ReturnType<typeof setTimeout> | null;
    stall: ReturnType<typeof setInterval> | null;
    attempt: number;
    stopped: boolean;
  };
};

const GOLD_FILE = `${DATA_ROOT}/xau-bars.json`;

function savedGold(): XauMinute[] {
  try {
    const raw = JSON.parse(readFileSync(GOLD_FILE, "utf8")) as { bars?: XauMinute[] };
    return raw.bars ?? [];
  } catch {
    return [];
  }
}

let lastGoldSave = 0;
function saveGold(box: NonNullable<(typeof g)["__xau"]>) {
  const now = Date.now();
  if (now - lastGoldSave < 15_000) return;
  lastGoldSave = now;
  try {
    mkdirSync(DATA_ROOT, { recursive: true });
    writeFileSync(GOLD_FILE, JSON.stringify({ bars: box.session.bars }));
  } catch {
    /* next tick */
  }
}

function slot() {
  if (!g.__xau) {
    g.__xau = { session: seedXau(emptyXau(), savedGold()), socket: null, timer: null, stall: null, attempt: 0, stopped: false };
  }
  return g.__xau;
}

function armStall() {
  const box = slot();
  if (box.stall) return;
  box.stall = setInterval(() => {
    box.session = applyXau(box.session, { type: "clock" }, Date.now());
  }, 1_000);
}

export function pythStatus(now = Date.now()) {
  return xauStatus(slot().session, now);
}

export function stopPyth() {
  const box = slot();
  box.stopped = true;
  if (box.timer) clearTimeout(box.timer);
  if (box.stall) clearInterval(box.stall);
  box.timer = null;
  box.stall = null;
  try {
    box.socket?.close();
  } catch {
    /* already closed */
  }
  box.socket = null;
}

function schedule() {
  const box = slot();
  if (box.stopped || box.timer) return;
  const wait = Math.min(30_000, 500 * 2 ** Math.max(0, box.attempt));
  box.attempt += 1;
  box.timer = setTimeout(() => {
    box.timer = null;
    open();
  }, wait);
}

function open() {
  const box = slot();
  if (box.stopped || box.socket) return;
  let headers: Record<string, string>;
  try {
    headers = kalshiWsHeaders();
  } catch {
    box.session = applyXau(box.session, { type: "unauthorized", category: "no-key" }, Date.now());
    return;
  }
  box.session = applyXau(box.session, { type: "connecting" }, Date.now());
  const ws = new WebSocket(URL, { headers, handshakeTimeout: 8_000 });
  box.socket = ws as unknown as Socket;
  ws.on("open", () => {
    if (box.socket !== (ws as unknown as Socket)) return;
    box.attempt = 0;
    ws.send(
      JSON.stringify({
        id: 1,
        cmd: "subscribe",
        params: { channels: ["pyth_value"], underlying_tickers: [XAU_TICKER] },
      }),
    );
    box.session = applyXau(box.session, { type: "subscribed" }, Date.now());
    armStall();
  });
  ws.on("message", (buf: unknown) => {
    const text = typeof buf === "string" ? buf : Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
    let raw: unknown = text;
    try {
      raw = JSON.parse(text);
    } catch {
      box.session = applyXau(box.session, { type: "bad" }, Date.now());
      return;
    }
    const kind = controlPyth(raw);
    if (kind === "ack") return;
    if (kind === "error") {
      box.session = { ...box.session, lastError: "feed-error" };
      return;
    }
    const parsed = parsePyth(raw);
    if (!parsed.ok) {
      if (parsed.category === "malformed") box.session = applyXau(box.session, { type: "bad" }, Date.now());
      return;
    }
    box.session = applyXau(box.session, { type: "tick", px: parsed.px, ts: parsed.ts }, Date.now());
    saveGold(box);
  });
  ws.on("close", () => {
    if (box.socket === (ws as unknown as Socket)) box.socket = null;
    box.session = applyXau(box.session, { type: "closed" }, Date.now());
    if (!box.stopped) schedule();
  });
  ws.on("error", () => {
    box.session = { ...box.session, lastError: "socket" };
    try {
      ws.close();
    } catch {
      /* close follows */
    }
  });
}

/** Read-only. Same Kalshi key as BTC. Does not import orders. */
export function ensurePyth() {
  const box = slot();
  box.stopped = false;
  if (box.socket || box.timer || box.session.status === "live") return pythStatus();
  open();
  return pythStatus();
}
