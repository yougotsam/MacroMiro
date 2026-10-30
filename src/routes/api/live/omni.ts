import { createFileRoute } from "@tanstack/react-router";
import { CALIBRATED_MODEL_APPROVED } from "@/lib/desk/config";
import { mutationGuard } from "@/lib/desk/http-guard";
import { PERPS_ORDERS_LOCKED } from "@/lib/perps/order-adapter";
import { loadOmniBoard } from "@/lib/omni/board";
import { scenarioSeed, geminiPasses } from "@/lib/omni/flip";
import type { BankPreset } from "@/lib/omni/flip";
import { applyPreset, ledgerView, pushShadow, readLedger, writeLedger } from "@/lib/omni/ledger";
import { probeKalshi, kalshiGet } from "@/lib/scan/kalshi-auth";

async function liveBook(): Promise<{ cash: number | null; positions: number | null }> {
  try {
    const [p, pos] = await Promise.all([
      probeKalshi(),
      kalshiGet<{ market_positions?: unknown[] }>("/trade-api/v2/portfolio/positions").catch(() => null),
    ]);
    return {
      cash: p.auth ? p.cashUsd : null,
      positions: pos ? (pos.data.market_positions?.length ?? 0) : null,
    };
  } catch {
    return { cash: null, positions: null };
  }
}

const PRESETS = new Set([100, 200, 500, 2500, "live"]);

export const Route = createFileRoute("/api/live/omni")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const [board, book] = await Promise.all([loadOmniBoard(), liveBook()]);
        const ledger = ledgerView(readLedger(), book.cash);
        const ticker = url.searchParams.get("ticker");
        const row = ticker ? board.rows.find((r) => r.ticker === ticker) : board.rows[0];
        const seed = row ? scenarioSeed({ question: row.question, ticker: row.ticker, sector: row.sector, yesAsk: row.yesAsk }) : null;
        return Response.json({
          ok: true,
          sendsOrders: false,
          locks: { predictions: CALIBRATED_MODEL_APPROVED === false, perps: Boolean(PERPS_ORDERS_LOCKED) },
          error: board.error,
          rows: board.rows,
          ledger,
          positions: book.positions,
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
        const book = await liveBook();
        if (body.kind === "preset" && body.preset != null && PRESETS.has(body.preset)) {
          const next = applyPreset(readLedger(), body.preset, book.cash);
          writeLedger(next);
          return Response.json({ ok: true, sendsOrders: false, ledger: ledgerView(next, book.cash) });
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
          return Response.json({ ok: true, sendsOrders: false, ledger: ledgerView(next, book.cash) });
        }
        return Response.json({ ok: false, sendsOrders: false, error: "preset or shadow required" }, { status: 400 });
      },
    },
  },
});
