/** Explicitly selected, read-only inventory diagnostic; stdout only. See account-read.md. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runAccountRead, USAGE } from "./account-read-core";

export async function main(args: readonly string[]) {
  const report = await runAccountRead(args, {
    loadReads: async () => (await import("../../src/lib/perps/live-transport")).marginSnapshotReads,
    loadRequestEvidence: async (selection, tickers) =>
      (await import("../../src/lib/perps/live-transport")).marginAccountRequestEvidence(selection, tickers),
    readJournal: (path) => readFile(path, "utf8"),
  });
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => {
    // Do not echo connector exceptions, credentials, or journal contents to stderr.
    console.error(`Account diagnostic failed; no approval or writes occurred. Usage: ${USAGE}`);
    process.exitCode = 1;
  });
}
