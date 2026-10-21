/** Append-only Telegram audit. Does not send, retry, or touch an order. */
import { appendFileSync, mkdirSync } from "node:fs";
import { dataDir } from "./config";

export type AlertLog = {
  ts: string;
  subject: string;
  http: number | null;
  id: number | null;
  error?: string;
};

export function logAlert(row: AlertLog) {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(`${dir}/alerts.jsonl`, `${JSON.stringify(row)}\n`);
}
