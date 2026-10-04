import type { UpDownLeg } from "@/lib/scan/updown";
import { liveReadyNow, placeEventOrder } from "@/lib/scan/kalshi-order";
import { liveExecutionAllowed } from "@/lib/envelope/kill.server";

export type BinaryIntent = {
  venue: "kalshi15m";
  ticker: string;
  leg: UpDownLeg;
  sizeUsd: number;
  yes: number;
  beat: number;
  slotEnd: number;
  chip: string;
  cross?: boolean;
};

export type BinaryFill = {
  mode: "paper" | "live";
  id: string;
  yes: number;
  ticker: string;
  count?: number;
};

/** Paper only until both switches are on. Once they are, a failed broker check throws. It does not invent a paper fill. */
export async function submitBinary(intent: BinaryIntent): Promise<BinaryFill> {
  if (!intent.ticker || intent.yes < 0.2 || intent.yes > 0.45) {
    throw new Error("no market");
  }
  if (!liveExecutionAllowed()) {
    return {
      mode: "paper",
      id: `paper-${intent.ticker}-${Date.now()}`,
      yes: intent.yes,
      ticker: intent.ticker,
    };
  }
  const live = await liveReadyNow();
  if (!live.ok) throw new Error(live.why);
  const fill = await placeEventOrder({
    ticker: intent.ticker,
    leg: intent.leg,
    yes: intent.yes,
    sizeUsd: intent.sizeUsd,
    cross: intent.cross,
  });
  return {
    mode: "live",
    id: fill.orderId,
    yes: fill.yesPaid,
    ticker: intent.ticker,
    count: fill.fillCount,
  };
}
