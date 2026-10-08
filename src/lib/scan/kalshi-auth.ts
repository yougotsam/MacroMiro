import { existsSync, readFileSync } from "node:fs";
import { createPrivateKey, sign, constants } from "node:crypto";

const KEY_ID_FILE = "/workspace/.grok/secrets/kalshi_key_id";
const PEM_FILE = "/workspace/.grok/secrets/kalshi_private.pem";
const LIVE_FILE = "/workspace/.grok/secrets/kalshi_live";
/** external-api.kalshi.com answers 403 from this box; api.elections.kalshi.com serves the same Trade API. */
export const KALSHI_HOST = "https://api.elections.kalshi.com";
const HOSTS = [KALSHI_HOST];

export type KalshiAuthStatus = {
  auth: boolean;
  host: string | null;
  keyIdTail: string | null;
  cashUsd: number | null;
  error: string | null;
  liveOrders: boolean;
  liveFlag: boolean;
  tier: string | null;
  readTps: number | null;
  writeTps: number | null;
  perpsTier: string | null;
  perpsWriteTps: number | null;
  shards?: { index: number; usd: number }[];
};

function keyId() {
  try {
    if (existsSync(KEY_ID_FILE)) return readFileSync(KEY_ID_FILE, "utf8").trim();
  } catch {
    /* */
  }
  return process.env.KALSHI_KEY_ID?.trim() ?? "";
}

function pem() {
  try {
    if (existsSync(PEM_FILE)) return readFileSync(PEM_FILE, "utf8");
  } catch {
    /* */
  }
  return process.env.KALSHI_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "";
}

/** File must contain exactly 1. Do not create this until cash is funded and we say go. */
export function liveFlagOn() {
  try {
    if (!existsSync(LIVE_FILE)) return false;
    return readFileSync(LIVE_FILE, "utf8").trim() === "1";
  } catch {
    return false;
  }
}

export function kalshiWsHeaders(path = "/trade-api/ws/v2") {
  return headers("GET", path);
}

export function signedPath(path: string) {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

/** Kalshi keys are RSA (RSA-PSS SHA-256) or Ed25519 (Kalshi's default). Sign with whichever type the key is. */
export function signKalshi(rawPem: string, msg: string) {
  const key = createPrivateKey(rawPem);
  if (key.asymmetricKeyType === "ed25519") {
    return sign(null, Buffer.from(msg), key).toString("base64");
  }
  return sign("sha256", Buffer.from(msg), {
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

/**
 * Signed headers. There is deliberately NO generic POST/PUT helper in this file: the only code that may
 * send a write to Kalshi is src/lib/desk/oms.ts (orders, behind the risk engine). See desk/static-order-path.test.ts.
 */
export function kalshiSignedHeaders(method: "GET" | "DELETE" | "POST", path: string) {
  return headers(method, path);
}

function headers(method: string, path: string) {
  const id = keyId();
  const raw = pem();
  if (!id || !raw.includes("PRIVATE KEY")) throw new Error("no Kalshi private key on disk");
  const ts = String(Date.now());
  const msg = `${ts}${method.toUpperCase()}${signedPath(path)}`;
  const sig = signKalshi(raw, msg);
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": id,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": sig,
    "User-Agent": "EnvelopeScan/1.0",
  };
}

export async function kalshiGet<T>(path: string): Promise<{ host: string; data: T }> {
  let last = "no host";
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, {
        headers: headers("GET", path),
        signal: AbortSignal.timeout(12_000),
      });
      const text = await res.text();
      if (!res.ok) {
        last = `${host} ${res.status} ${text.slice(0, 180)}`;
        continue;
      }
      return { host, data: JSON.parse(text) as T };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(last);
}

export async function kalshiDelete<T>(path: string): Promise<{ status: number; text: string }> {
  let last = "no host";
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, {
        method: "DELETE",
        headers: headers("DELETE", path),
        signal: AbortSignal.timeout(12_000),
      });
      const text = await res.text();
      if (!res.ok && (res.status === 401 || res.status === 404)) {
        last = `${host} ${res.status} ${text.slice(0, 180)}`;
        continue;
      }
      return { status: res.status, text };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(last);
}

export async function probeKalshi(): Promise<KalshiAuthStatus> {
  const id = keyId();
  const tail = id ? id.slice(-8) : null;
  const flag = liveFlagOn();
  try {
    const [{ host, data }, limits, perpsLimits] = await Promise.all([
      kalshiGet<{
        balance?: number;
        balance_dollars?: string;
        payout?: number;
        balance_breakdown?: Array<{ balance?: string; exchange_index?: number }>;
      }>("/trade-api/v2/portfolio/balance"),
      kalshiGet<{
        usage_tier?: string;
        read?: { refill_rate?: number };
        write?: { refill_rate?: number };
      }>("/trade-api/v2/account/limits").catch(() => ({
        host: null as string | null,
        data: {} as { usage_tier?: string; read?: { refill_rate?: number }; write?: { refill_rate?: number } },
      })),
      kalshiGet<{
        usage_tier?: string;
        write?: { refill_rate?: number };
      }>("/trade-api/v2/account/limits/perps").catch(() => ({
        host: null as string | null,
        data: {} as { usage_tier?: string; write?: { refill_rate?: number } },
      })),
    ]);
    const cash =
      typeof data.balance_dollars === "string"
        ? Number(data.balance_dollars)
        : typeof data.balance === "number"
          ? data.balance / 100
          : null;
    const cashUsd = Number.isFinite(cash) ? Number((cash ?? 0).toFixed(2)) : 0;
    const shards = (data.balance_breakdown ?? []).map((b) => ({
      index: b.exchange_index ?? 0,
      usd: Number(b.balance ?? 0),
    }));
    const shard2 = shards.find((s) => s.index === 2)?.usd ?? 0;
    return {
      auth: true,
      host,
      keyIdTail: tail,
      cashUsd,
      error: null,
      liveOrders: flag && shard2 >= 5,
      liveFlag: flag,
      tier: limits.data.usage_tier ?? "basic",
      readTps: limits.data.read?.refill_rate ?? null,
      writeTps: limits.data.write?.refill_rate ?? null,
      perpsTier: perpsLimits.data.usage_tier ?? null,
      perpsWriteTps: perpsLimits.data.write?.refill_rate ?? null,
      shards,
    };
  } catch (e) {
    return {
      auth: false,
      host: null,
      keyIdTail: tail,
      cashUsd: null,
      error: e instanceof Error ? e.message.slice(0, 240) : "auth failed",
      liveOrders: false,
      liveFlag: flag,
      tier: null,
      readTps: null,
      writeTps: null,
      perpsTier: null,
      perpsWriteTps: null,
    };
  }
}
