import WebSocket from "ws";
import { kalshiWsHeaders } from "@/lib/scan/kalshi-auth";
import { PERP_TICKERS, notePerpPrice } from "@/lib/scan/perp-desk";

const URL = "wss://external-api-margin-ws.kalshi.com/trade-api/ws/v2/margin";
const PATH = "/trade-api/ws/v2/margin";

/** Mark prices for the margin book. The order still needs the REST quote. */
export function ensurePerpSocket() {
  const g = globalThis as typeof globalThis & { __perpSock?: boolean };
  if (g.__perpSock) return;
  g.__perpSock = true;
  let ws: WebSocket | null = null;
  const open = () => {
    try {
      ws = new WebSocket(URL, { headers: kalshiWsHeaders(PATH), handshakeTimeout: 8_000 });
    } catch {
      g.__perpSock = false;
      return;
    }
    ws.on("open", () => {
      ws?.send(JSON.stringify({ id: 1, cmd: "subscribe", params: { channels: ["ticker"], market_tickers: [...PERP_TICKERS], send_initial_snapshot: true } }));
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { msg?: { market_ticker?: string; price?: number; mark_price?: string }; market_ticker?: string };
        const ticker = msg.msg?.market_ticker ?? msg.market_ticker;
        const price = Number(msg.msg?.mark_price ?? msg.msg?.price ?? 0);
        if (ticker && price > 0) notePerpPrice(ticker, price);
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => {
      ws = null;
      setTimeout(open, 5_000);
    });
    ws.on("error", () => ws?.close());
  };
  open();
}
