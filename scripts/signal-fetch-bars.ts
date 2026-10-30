/**
 * Pull public 15-minute candles from Coinbase Exchange (no key, no cost) into data/signal/bars/<PRODUCT>-15m.jsonl.
 * PAXG-USD stands in for gold (a token backed by one ounce). Re-running appends only new bars.
 * Usage: bun scripts/signal-fetch-bars.ts [days=120]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "PAXG-USD"];
const GRAN = 900;
const days = Number(process.argv[2] ?? 120);
const dir = "data/signal/bars";
mkdirSync(dir, { recursive: true });

type Row = { t: number; o: number; h: number; l: number; c: number; v: number };

async function page(product: string, startS: number, endS: number): Promise<Row[]> {
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${GRAN}&start=${new Date(startS * 1000).toISOString()}&end=${new Date(endS * 1000).toISOString()}`;
  for (let tries = 0; tries < 4; tries++) {
    const r = await fetch(url, { headers: { "user-agent": "macromiro-signal" } });
    if (r.ok) {
      const a = (await r.json()) as number[][];
      return a.map(([t, l, h, o, c, v]) => ({ t: t * 1000, o, h, l, c, v }));
    }
    await new Promise((s) => setTimeout(s, 1500 * (tries + 1)));
  }
  throw new Error(`${product} ${url} failed`);
}

for (const p of PRODUCTS) {
  const file = `${dir}/${p}-15m.jsonl`;
  const have = new Map<number, Row>();
  if (existsSync(file)) for (const line of readFileSync(file, "utf8").split("\n")) if (line) { const r = JSON.parse(line) as Row; have.set(r.t, r); }
  const now = Math.floor(Date.now() / 1000 / GRAN) * GRAN;
  const from = now - days * 86400;
  for (let s = from; s < now; s += 300 * GRAN) {
    const rows = await page(p, s, Math.min(now, s + 300 * GRAN));
    for (const r of rows) if (r.t < now * 1000) have.set(r.t, r); // drop the bar still forming
    await new Promise((x) => setTimeout(x, 350));
  }
  const out = [...have.values()].sort((a, b) => a.t - b.t);
  writeFileSync(file, out.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(p, out.length, "bars");
}
