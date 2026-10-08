import WebSocket from "ws";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { kalshiWsHeaders } from "@/lib/scan/kalshi-auth";
import { apply, backoffMs, controlFrame, emptySession, frameIndex, publicStatus, seedBars, type MinuteBar, type RtiSymbol, type Session } from "@/lib/skill/brti-session";
import { DATA_ROOT } from "@/lib/data-root";

const URL = "wss://api.elections.kalshi.com/trade-api/ws/v2";

type Socket = {
  send: (data: string) => void;
  close: () => void;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
};

const g = globalThis as typeof globalThis & {
  __brti?: {
    session: Session;
    eth: Session;
    sol: Session;
    xrp: Session;
    socket: Socket | null;
    timer: ReturnType<typeof setTimeout> | null;
    stall: ReturnType<typeof setInterval> | null;
    attempt: number;
    stopped: boolean;
  };
};

const BAR_FILE = `${DATA_ROOT}/rti-bars.json`;

function savedBars(): { btc: MinuteBar[]; eth: MinuteBar[]; sol: MinuteBar[]; xrp: MinuteBar[] } {
  try {
    const raw = JSON.parse(readFileSync(BAR_FILE, "utf8")) as { btc?: MinuteBar[]; eth?: MinuteBar[]; sol?: MinuteBar[]; xrp?: MinuteBar[] };
    return { btc: raw.btc ?? [], eth: raw.eth ?? [], sol: raw.sol ?? [], xrp: raw.xrp ?? [] };
  } catch {
    return { btc: [], eth: [], sol: [], xrp: [] };
  }
}

let lastBarSave = 0;
function saveBars(box: NonNullable<(typeof g)["__brti"]>) {
  const now = Date.now();
  if (now - lastBarSave < 15_000) return;
  lastBarSave = now;
  try {
    mkdirSync(DATA_ROOT, { recursive: true });
    writeFileSync(BAR_FILE, JSON.stringify({ btc: box.session.bars, eth: box.eth.bars, sol: box.sol.bars, xrp: box.xrp.bars }));
  } catch {
    /* the next print tries again */
  }
}
function slot() {
  if (!g.__brti) {
    const saved = savedBars();
    g.__brti = {
      session: seedBars(emptySession(), saved.btc),
      eth: seedBars(emptySession(), saved.eth),
      sol: seedBars(emptySession(), saved.sol),
      xrp: seedBars(emptySession(), saved.xrp),
      socket: null,
      timer: null,
      stall: null,
      attempt: 0,
      stopped: false,
    };
  }
  if (!g.__brti.eth) g.__brti.eth = emptySession();
  if (!g.__brti.sol) g.__brti.sol = emptySession();
  if (!g.__brti.xrp) g.__brti.xrp = emptySession();
  return g.__brti;
}

function armStall() {
  const box = slot();
  if (box.stall) return;
  box.stall = setInterval(() => {
    box.session = apply(box.session, { type: "tick" }, Date.now());
    box.eth = apply(box.eth, { type: "tick" }, Date.now(), "ETHUSD_RTI");
    box.sol = apply(box.sol, { type: "tick" }, Date.now(), "SOLUSD_RTI");
    box.xrp = apply(box.xrp, { type: "tick" }, Date.now(), "XRPUSD_RTI");
  }, 1_000);
}

export function brtiStatus(now = Date.now()) {
  return publicStatus(slot().session, now, "BRTI");
}

export function ethRtiStatus(now = Date.now()) {
  return publicStatus(slot().eth, now, "ETHUSD_RTI");
}

export function solRtiStatus(now = Date.now()) {
  return publicStatus(slot().sol, now, "SOLUSD_RTI");
}

export function xrpRtiStatus(now = Date.now()) {
  return publicStatus(slot().xrp, now, "XRPUSD_RTI");
}

export function stopBrti() {
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
  const wait = backoffMs(box.attempt);
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
    box.session = apply(box.session, { type: "unauthorized", category: "no-key" }, Date.now());
    return;
  }
  box.session = apply(box.session, { type: "connecting" }, Date.now());
  const ws = new WebSocket(URL, { headers, handshakeTimeout: 8_000 });
  box.socket = ws as unknown as Socket;
  ws.on("open", () => {
    if (box.socket !== (ws as unknown as Socket)) return;
    box.attempt = 0;
    ws.send(
      JSON.stringify({
        id: 1,
        cmd: "subscribe",
        params: { channels: ["cfbenchmarks_value"], index_ids: ["BRTI", "ETHUSD_RTI", "SOLUSD_RTI", "XRPUSD_RTI"] },
      }),
    );
    const now = Date.now();
    box.session = apply(box.session, { type: "subscribed" }, now, "BRTI");
    box.eth = apply(box.eth, { type: "subscribed" }, now, "ETHUSD_RTI");
    box.sol = apply(box.sol, { type: "subscribed" }, now, "SOLUSD_RTI");
    box.xrp = apply(box.xrp, { type: "subscribed" }, now, "XRPUSD_RTI");
    armStall();
  });
  ws.on("message", (buf: unknown) => {
    const text = typeof buf === "string" ? buf : Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
    let raw: unknown = text;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = { bad: true };
    }
    const kind = controlFrame(raw);
    if (kind === "ack" || kind === "other") return;
    if (kind === "error") {
      const code = typeof (raw as { msg?: { code?: string } }).msg?.code === "string" ? (raw as { msg: { code: string } }).msg.code : "feed-error";
      box.session = { ...box.session, lastError: code, status: code.includes("auth") ? "unauthorized" : box.session.status };
      return;
    }
    const index = frameIndex(raw);
    const now = Date.now();
    if (index === "ETHUSD_RTI" || index === "SOLUSD_RTI" || index === "XRPUSD_RTI") {
      const key = index === "ETHUSD_RTI" ? "eth" : index === "SOLUSD_RTI" ? "sol" : "xrp";
      box[key] = apply(box[key], { type: "frame", raw, mode: "live" }, now, index as RtiSymbol);
      saveBars(box);
      return;
    }
    box.session = apply(box.session, { type: "frame", raw, mode: "live" }, now, "BRTI");
    saveBars(box);
  });
  ws.on("close", () => {
    if (box.socket === (ws as unknown as Socket)) box.socket = null;
    box.session = apply(box.session, { type: "closed" }, Date.now(), "BRTI");
    box.eth = apply(box.eth, { type: "closed" }, Date.now(), "ETHUSD_RTI");
    box.sol = apply(box.sol, { type: "closed" }, Date.now(), "SOLUSD_RTI");
    box.xrp = apply(box.xrp, { type: "closed" }, Date.now(), "XRPUSD_RTI");
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

/** Read-only feed. Does not import the order path. */
export function ensureBrti() {
  const box = slot();
  box.stopped = false;
  if (box.session.status === "malformed" && !box.session.seenLive) {
    try {
      box.socket?.close();
    } catch {
      /* already closed */
    }
    box.socket = null;
    if (box.timer) clearTimeout(box.timer);
    box.timer = null;
    box.session = emptySession();
  }
  if (box.socket || box.timer || box.session.status === "live") return brtiStatus();
  open();
  return brtiStatus();
}
