/**
 * Free, public history the backtests need beyond Coinbase candles. No keys, no paid calls.
 *   bun scripts/signal-fetch-extra.ts [days=180] [gold|funding|tone|all]
 * - gold:    OKX XAU-USDT-SWAP 15m candles (a perp that tracks spot gold) → data/signal/bars/XAU-USD-15m.jsonl
 *            (Pyth's free benchmark history now answers 401/404, so it is not used.)
 * - funding: OKX 8-hourly funding prints for BTC/ETH/SOL/XRP/XAU swaps → data/signal/funding/<ASSET>.jsonl
 *            Kalshi's own funding history answers 403 from this box, so OKX is the stated stand-in.
 * - tone:    (merges into the existing file) GDELT 2.0 DOC "timelinetone" (average headline tone of world news) per asset → data/signal/news/tone-<ASSET>.jsonl
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const days = Number(process.argv[2] ?? 180);
const what = process.argv[3] ?? "all";
const now = Date.now();
const from = now - days * 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(url: string, tries = 6): Promise<any> {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      const t = await r.text();
      if (r.ok && t.trim().startsWith("{")) return JSON.parse(t);
    } catch { /* retry */ }
    await sleep(10000 * (k + 1));
  }
  return null;
}

async function gold() {
  mkdirSync("data/signal/bars", { recursive: true });
  const file = "data/signal/bars/XAU-USD-15m.jsonl";
  const rows = new Map<number, string>();
  // merge with what is already on disk so a short refresh never drops history
  if (existsSync(file)) for (const l of readFileSync(file, "utf8").split("\n")) if (l) rows.set((JSON.parse(l) as { t: number }).t, l);
  let after = "";
  for (;;) {
    const j = await json(`https://www.okx.com/api/v5/market/history-candles?instId=XAU-USDT-SWAP&bar=15m&limit=100${after ? `&after=${after}` : ""}`);
    const d: string[][] = j?.data ?? [];
    if (!d.length) break;
    for (const c of d) if (c[8] === "1") rows.set(Number(c[0]), JSON.stringify({ t: Number(c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[6] }));
    after = d[d.length - 1][0];
    if (Number(after) < from) break;
    await sleep(120);
  }
  const out = [...rows.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  writeFileSync(file, out.join("\n") + "\n");
  console.log("gold bars", out.length);
}

async function funding() {
  mkdirSync("data/signal/funding", { recursive: true });
  for (const [a, inst] of [["BTC", "BTC-USDT-SWAP"], ["ETH", "ETH-USDT-SWAP"], ["SOL", "SOL-USDT-SWAP"], ["XRP", "XRP-USDT-SWAP"], ["GOLD", "XAU-USDT-SWAP"]]) {
    const rows = new Map<number, number>();
    let after = "";
    for (;;) {
      const j = await json(`https://www.okx.com/api/v5/public/funding-rate-history?instId=${inst}&limit=100${after ? `&after=${after}` : ""}`);
      const d: { fundingTime: string; realizedRate: string }[] = j?.data ?? [];
      if (!d.length) break;
      for (const x of d) rows.set(Number(x.fundingTime), Number(x.realizedRate));
      after = d[d.length - 1].fundingTime;
      if (Number(after) < from) break;
      await sleep(250);
    }
    const out = [...rows.entries()].filter(([t]) => t >= from).sort((x, y) => x[0] - y[0]).map(([t, r]) => JSON.stringify({ t, rate: r }));
    writeFileSync(`data/signal/funding/${a}.jsonl`, out.join("\n") + "\n");
    console.log("funding", a, out.length);
  }
}

const TONE_Q: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: '"solana"', XRP: '"xrp" OR ripple', GOLD: '"gold price"', MACRO: '"federal reserve" OR inflation' };
const ymd = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);

async function tone() {
  mkdirSync("data/signal/news", { recursive: true });
  for (const [a, q] of Object.entries(TONE_Q)) {
    const f = `data/signal/news/tone-${a}.jsonl`;
    const rows = new Map<number, number>();
    // merge: a short refresh (e.g. 2 days from cron) keeps the older history
    if (existsSync(f)) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) { const p = JSON.parse(l); rows.set(p.t, p.tone); }
    for (let s = from; s < now; s += 7 * 86_400_000) {
      const e = Math.min(now, s + 7 * 86_400_000);
      const j = await json(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=timelinetone&format=json&startdatetime=${ymd(s)}&enddatetime=${ymd(e)}`);
      for (const p of j?.timeline?.[0]?.data ?? []) {
        const m = String(p.date).match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/);
        if (m) rows.set(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), Number(p.value));
      }
      await sleep(8000);
    }
    const out = [...rows.entries()].sort((x, y) => x[0] - y[0]).map(([t, v]) => JSON.stringify({ t, tone: v }));
    writeFileSync(f, out.join("\n") + "\n");
    console.log("tone", a, out.length);
  }
}

if (what === "gold" || what === "all") await gold();
if (what === "funding" || what === "all") await funding();
if (what === "tone" || what === "all") await tone();
