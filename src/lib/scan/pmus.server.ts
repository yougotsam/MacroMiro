import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";
import { PolymarketUS } from "polymarket-us";
import type { PolyMarket } from "./graph";
import type { PmusStatus, UsContract } from "./pmus-types";

export type { PmusStatus, UsContract } from "./pmus-types";

const KEY_FILE = "/workspace/.grok/secrets/pm_us_key_id";
const SECRET_FILE = "/workspace/.grok/secrets/pm_us_secret";
const LIVE_FILE = "/workspace/.grok/secrets/pm_us_live";
const API = "https://api.polymarket.us";
const GATEWAY = "https://gateway.polymarket.us";

function readDisk(path: string) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function keyId() {
  const disk = readDisk(KEY_FILE);
  if (disk) {
    process.env.POLYMARKET_KEY_ID = disk;
    return disk;
  }
  return (process.env.POLYMARKET_KEY_ID ?? "").trim();
}

function secretKey() {
  const disk = readDisk(SECRET_FILE);
  if (disk) {
    process.env.POLYMARKET_SECRET_KEY = disk;
    return disk;
  }
  return (process.env.POLYMARKET_SECRET_KEY ?? "").trim();
}

function liveFlag() {
  const env = (process.env.POLYMARKET_US_LIVE ?? "").trim();
  if (env === "1") return true;
  return readDisk(LIVE_FILE) === "1";
}

function pkcs8(secret: string) {
  const raw = Buffer.from(secret, "base64");
  const seed = raw.length >= 64 ? raw.subarray(0, 32) : raw;
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({ key: Buffer.concat([prefix, seed]), format: "der", type: "pkcs8" });
}

export function pmusReady() {
  return Boolean(keyId() && secretKey());
}

export async function signPmus(method: string, path: string) {
  const id = keyId();
  const secret = secretKey();
  if (!id || !secret) throw new Error("no pmus keys");
  const ts = Date.now().toString();
  const sig = sign(null, Buffer.from(`${ts}${method}${path}`), pkcs8(secret)).toString("base64");
  return {
    "X-PM-Access-Key": id,
    "X-PM-Timestamp": ts,
    "X-PM-Signature": sig,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

type Side = {
  description?: string;
  price?: string | number | null;
  quote?: { value?: string };
  long?: boolean;
};
type UsMarket = {
  question?: string;
  slug?: string;
  title?: string;
  titleShort?: string;
  endDate?: string;
  category?: string;
  closed?: boolean;
  active?: boolean;
  marketSides?: Side[];
};
type UsEvent = {
  title?: string;
  slug?: string;
  category?: string;
  closed?: boolean;
  markets?: UsMarket[];
};

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function contract(ev: UsEvent, m: UsMarket): UsContract | null {
  const sides = m.marketSides ?? [];
  const yesSide = sides.find((s) => s.long === true || /yes/i.test(s.description || "")) ?? sides[0];
  const noSide = sides.find((s) => s.long === false || /no/i.test(s.description || "")) ?? sides[1];
  const yes = num(yesSide?.quote?.value ?? yesSide?.price);
  const no = num(noSide?.quote?.value ?? noSide?.price);
  if (!yes && !no) return null;
  const strike = (m.titleShort || m.title || "").replace(/_{2,}/g, "").trim();
  const base = (ev.title || m.question || "").replace(/_{2,}/g, " ").replace(/\s+/g, " ").trim();
  const q = strike && !base.includes(strike) ? `${base} ${strike}` : base;
  const slug = m.slug || ev.slug || "";
  if (!q || !slug) return null;
  return {
    slug,
    title: (ev.title || q).slice(0, 88),
    question: q.slice(0, 110),
    yes,
    no,
    bid: yes || null,
    ask: yes && no ? Number((1 - no).toFixed(4)) || yes : yes || null,
    end: m.endDate ?? null,
    url: `https://polymarket.us/event/${ev.slug || slug}`,
    category: m.category || ev.category || "",
  };
}

async function grabGateway<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${GATEWAY}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "EnvelopeScan/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadUsContracts(): Promise<UsContract[]> {
  const qs = ["bitcoin", "fed", "CPI", "FOMC"];
  const packs = await Promise.all(
    qs.map((q) => grabGateway<{ events?: UsEvent[] }>(`/v1/search?query=${encodeURIComponent(q)}`)),
  );
  const out: UsContract[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const ev of pack?.events ?? []) {
      if (ev.closed) continue;
      const cat = ev.category || "";
      if (cat !== "crypto" && cat !== "macro") continue;
      for (const m of ev.markets ?? []) {
        if (m.closed || m.active === false) continue;
        const row = contract(ev, m);
        if (!row || seen.has(row.slug)) continue;
        seen.add(row.slug);
        out.push(row);
      }
    }
  }
  return out.slice(0, 24);
}

export function usToPoly(rows: UsContract[]): PolyMarket[] {
  return rows.map((r) => ({
    question: r.question,
    yes: r.yes || 1 - r.no,
    spread: Math.max(0, (r.ask ?? r.yes) - (r.bid ?? r.yes)),
    bid: r.bid,
    ask: r.ask,
    end: r.end,
    source: "us",
    url: r.url,
  }));
}

async function authProbe(): Promise<{
  auth: boolean;
  error: string | null;
  cashUsd: number | null;
  buyingPower: number | null;
  positions: number;
}> {
  const id = keyId();
  const secret = secretKey();
  if (!id || !secret) {
    return { auth: false, error: "no keys on disk", cashUsd: null, buyingPower: null, positions: 0 };
  }
  try {
    const client = new PolymarketUS({ keyId: id, secretKey: secret, timeout: 15_000 });
    const bal = (await client.account.balances()) as {
      balances?: { currentBalance?: number; buyingPower?: number; currency?: string }[];
    };
    const usd = bal.balances?.find((b) => (b.currency || "USD") === "USD") ?? bal.balances?.[0];
    let positions = 0;
    try {
      const pos = (await client.portfolio.positions()) as unknown as { positions?: unknown[] | Record<string, unknown> };
      positions = Array.isArray(pos.positions) ? pos.positions.length : pos.positions ? Object.keys(pos.positions).length : 0;
    } catch {
      /* balances was enough */
    }
    return {
      auth: true,
      error: null,
      cashUsd: usd?.currentBalance ?? 0,
      buyingPower: usd?.buyingPower ?? 0,
      positions,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "auth failed";
    return { auth: false, error: msg, cashUsd: null, buyingPower: null, positions: 0 };
  }
}

let cache: { at: number; data: PmusStatus } | null = null;

export async function loadPmus(force = false): Promise<PmusStatus> {
  if (!cache || force || Date.now() - cache.at > 45_000) {
    const [contracts, probe] = await Promise.all([loadUsContracts(), authProbe()]);
    const five = contracts.some((c) => /\b5\s*-?\s*m(in)?\b/i.test(c.question) || /up or down/i.test(c.question));
    const liveOrders = liveFlag() && probe.auth;
    const note = !pmusReady()
      ? "US keys missing."
      : !probe.auth
        ? `US key on disk. Signature rejected (${probe.error}). Paste the secret as text — screenshot OCR is likely wrong. LIVE orders stay off.`
        : five
          ? "US book authed. 5m Up/Down is listed. HEART still papers until you fund and flip LIVE."
          : "US book authed. Cash is empty until you fund polymarket.us. No 5-minute BTC on this venue — year ladders + Fed/CPI only. HEART still papers Global 5m. LIVE orders off.";
    cache = {
      at: Date.now(),
      data: {
        keysOnDisk: pmusReady(),
        auth: probe.auth,
        authError: probe.error,
        liveOrders,
        host: API,
        cashUsd: probe.cashUsd,
        buyingPower: probe.buyingPower,
        positions: probe.positions,
        fiveMin: five,
        note,
        contracts,
      },
    };
  }
  return cache.data;
}

/** Hard lock. ARM must not call this until liveFlag and auth are both true. */
export async function placeUsOrder(): Promise<never> {
  throw new Error("US live orders are locked. HEART papers Global 5m only.");
}
