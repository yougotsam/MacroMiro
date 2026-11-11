import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";

/**
 * This route previously took balance, drawdown, loss streak, and position inputs
 * directly from the HTTP caller and bypassed the OMS watchdog. Until a separate
 * reviewed change supplies authoritative server-derived account state, venue
 * position inventory, and an aggregate-risk decision, DO NOT dispatch orders.
 *
 * This is deliberately a hard compile-time stop, not an environment flag that
 * could be switched on without implementing the missing checks.
 */
const LIVE_PERPS_BLOCK_REASON =
  "Perpetual orders are disabled pending server-owned margin risk, position reconciliation, and protective-exit validation.";

export const Route = createFileRoute("/api/live/perp-fire")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          book: "perp",
          locked: true,
          sendsOrders: false,
          why: LIVE_PERPS_BLOCK_REASON,
        }),
      POST: async () => {
        // Authenticate the account-level operator, not merely a UI 'clicked' bit.
        const operatorId = process.env.PERPS_OPERATOR_USER_ID?.trim();
        const user = await getSessionUser().catch(() => null);
        if (!operatorId || !user || user.id !== operatorId) {
          return Response.json({ ok: false, why: "operator authorization required" }, { status: 403 });
        }
        return Response.json({ ok: false, why: LIVE_PERPS_BLOCK_REASON }, { status: 503 });
      },
    },
  },
});
