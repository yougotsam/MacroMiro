import { createFileRoute } from "@tanstack/react-router";
import { CALIBRATED_MODEL_APPROVED } from "@/lib/desk/config";
import { mutationGuard } from "@/lib/desk/http-guard";
import { PERPS_ORDERS_LOCKED } from "@/lib/perps/order-adapter";
import { loadOmniBoard } from "@/lib/omni/board";
import { scenarioSeed, geminiPasses } from "@/lib/omni/flip";
import type { BankPreset } from "@/lib/omni/flip";
import { applyPreset, ledgerView, pushShadow, readLedger, writeLedger } from "@/lib/omni/ledger";
import { probeKalshi } from "@/lib/scan/kalshi-auth";

async function liveCash(): Promise<number | null> {
  try {
    const p = await probeKalshi();
    return p.auth ? p.cashUsd : null;
  } catch {
    return null;
  }
}

const PRESETS = new Set([100, 200, 500, 2500, "live"]);

export const Route = createFileRoute("/api/live/omni")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const [board, cash] = await Promise.all([loadOmniBoard(), liveCash()]);
        const ledger = ledgerView(readLedger(), cash);
        const ticker = url.searchParams.get("ticker");
        const row = ticker ? board.rows.find((r) => r.ticker === ticker) : board.rows[0];
        const seed = row ? scenarioSeed({ question: row.question, ticker: row.ticker, sector: row.sector, yesAsk: row.yesAsk }) : null;
        return Response.json({
          ok: true,
          sendsOrders: false,
          locks: { predictions: CALIBRATED_MODEL_APPROVED === false, perps: PERPS_ORDERS_LOCKED === true },
          error: board.error,
          rows: board.rows,
          ledger,
          seed,
          geminiPasses: row ? geminiPasses(row.question) : [],
          note: "Win probability is UNKNOWN. A shadow row is not a Kalshi order. The 15-minute risk limits are unchanged.",
        });
      },
      POST: async ({ request }) => {
        const denied = mutationGuard(request);
        if (denied) return denied;
        const body = (await request.json().catch(() => ({}))) as {
          kind?: string;
          preset?: BankPreset;
          ticker?: string;
          question?: string;
          mode?: string;
          side?: "YES" | "NO";
          entry?: number | null;
          target?: number | null;
          multiple?: number | null;
        };
        const cash = await liveCash();
        if (body.kind === "preset" && body.preset != null && PRESETS.has(body.preset)) {
          const next = applyPreset(readLedger(), body.preset, cash);
          writeLedger(next);
          return Response.json({ ok: true, sendsOrders: false, ledger: ledgerView(next, cash) });
        }
        if (body.kind === "shadow" && body.ticker && body.question && body.mode) {
          const next = pushShadow(readLedger(), {
            ticker: body.ticker,
            question: body.question,
            mode: body.mode,
            side: body.side === "NO" ? "NO" : "YES",
            entry: typeof body.entry === "number" ? body.entry : null,
            target: typeof body.target === "number" ? body.target : null,
            multiple: typeof body.multiple === "number" ? body.multiple : null,
          });
          writeLedger(next);
          return Response.json({ ok: true, sendsOrders: false, ledger: ledgerView(next, cash) });
        }
        return Response.json({ ok: false, sendsOrders: false, error: "preset or shadow required" }, { status: 400 });
      },
    },
  },
});
