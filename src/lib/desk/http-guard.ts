import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { SECRETS_DIR } from "./config";

/**
 * /api/live/* mutations need the desk token (secrets/desk_token) in the x-desk-token header.
 * Missing token file = every mutation refused. The web app has no order path either way.
 */
export function mutationGuard(request: Request): Response | null {
  let want = "";
  try {
    want = readFileSync(`${SECRETS_DIR}/desk_token`, "utf8").trim();
  } catch {
    want = "";
  }
  const got = request.headers.get("x-desk-token") ?? "";
  const ok = want.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  return ok ? null : Response.json({ error: "forbidden: desk mutations need x-desk-token" }, { status: 403 });
}
