/** Match the bundled backend: its configured .env overrides inherited model settings. No secrets are returned. */
import { readFileSync } from "node:fs";

export function researchModelVersion(promptVersion: string, env: NodeJS.ProcessEnv = process.env) {
  let model = env.LLM_MODEL_NAME?.trim() ?? "";
  try {
    const raw = readFileSync(env.MIROFISH_ENV_FILE || "/workspace/desk/MiroFish/.env", "utf8");
    const m = raw.match(/^\s*(?:export\s+)?LLM_MODEL_NAME\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/m);
    if (m) model = (m[1] ?? m[2] ?? m[3]).trim();
  } catch {
    if (env.MIROFISH_ENV_FILE) throw new Error("configured MiroFish environment file is unreadable");
  }
  return `mirofish@${env.MIROFISH_COMMIT ?? "local"}+${model || "unknown"}+${promptVersion}`;
}
