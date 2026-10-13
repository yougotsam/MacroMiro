/**
 * Bearer token for the private MiroFish backend. Read from MIROFISH_AUTH_TOKEN, else from the MiroFish .env
 * (chmod 600) — never logged, never returned to a client, never written anywhere else.
 */
import { readFileSync } from "node:fs";

export function mirofishToken(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MIROFISH_AUTH_TOKEN) return env.MIROFISH_AUTH_TOKEN;
  try {
    const raw = readFileSync(env.MIROFISH_ENV_FILE || "/workspace/desk/MiroFish/.env", "utf8");
    return raw.match(/^MIROFISH_AUTH_TOKEN=(.+)$/m)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

export function authHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const t = mirofishToken(env);
  return t ? { Authorization: `Bearer ${t}` } : {};
}
