/**
 * Firecrawl webhook authentication. Fails CLOSED: no FIRECRAWL_WEBHOOK_SECRET configured → every request is refused.
 * Accepts either a valid HMAC-SHA256 signature of the raw body (X-Firecrawl-Signature: sha256=<hex>) or
 * Authorization: Bearer <secret>. Previously ANY non-empty signature header was accepted and a missing secret
 * left the endpoint open on 0.0.0.0:8080.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyFirecrawlWebhook(rawBody: string, headers: { authorization?: string | null; signature?: string | null }, secret: string | undefined): { ok: boolean; reason: string } {
  if (!secret) return { ok: false, reason: "webhook secret not configured (fail closed)" };
  if (headers.authorization && same(headers.authorization, `Bearer ${secret}`)) return { ok: true, reason: "bearer" };
  const sig = (headers.signature ?? "").trim();
  if (!sig) return { ok: false, reason: "missing signature" };
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const given = sig.startsWith("sha256=") ? sig : `sha256=${sig}`;
  return same(given, expected) ? { ok: true, reason: "hmac" } : { ok: false, reason: "bad signature" };
}
