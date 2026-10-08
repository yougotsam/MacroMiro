import { bookAlwaysOpen, type DeskPayload, type Tape } from "@/lib/live/types";

export type PlayId = "sit" | "scalp" | "event";

export type Play = {
  id: PlayId;
  score: number;
  title: string;
  why: string;
};

export type Opinion = {
  pick: Play;
  plays: Play[];
  sizeUsd: number;
  /** "local" or the model id that wrote it (grok-4.7, gemini-3.8-flash, ...). Words only. */
  clerk: string;
  brain?: "grok" | "gemini";
  ms?: number;
  note?: string;
};

function catalystWindow(desk: DeskPayload) {
  if (desk.hoursToNext != null && desk.hoursToNext >= 0 && desk.hoursToNext <= 10 / 60) return true;
  return desk.calendar.some((e) => {
    const age = Date.now() - new Date(e.time).getTime();
    return age >= 0 && age < 15 * 60_000;
  });
}

/** Same rule as docs/STRATEGY.md. This does not send an order. */
export function scoreOpinion(desk: DeskPayload, tape: Tape, cash: number): Opinion {
  const live = bookAlwaysOpen(tape.book) || desk.session.globex === "open";
  const shock = catalystWindow(desk);
  const sit: Play = {
    id: "sit",
    score: 40,
    title: "Sit",
    why: "The 30-second move is against the line, or the ticket is outside 4¢–75¢.",
  };
  const scalp: Play = {
    id: "scalp",
    score: live ? 36 : 12,
    title: "15m",
    why: live
      ? `${tape.symbol} is live. Price range: 4¢–75¢. Clock: 5s after open to 30s before close. The last 30 seconds must agree.`
      : "This book is not in a live session.",
  };
  const event: Play = {
    id: "event",
    score: shock ? 72 : 14,
    title: "Catalyst",
    why: shock
      ? `${desk.next?.name ?? "Print"} window. Price range stays 4¢–75¢. The clip stays $5 or less. Still not a direction by itself.`
      : "No CPI, jobs, or Fed window.",
  };
  if (tape.regime === "trend" && live) {
    scalp.score += 8;
    scalp.why = `${tape.symbol} trend is on. The ticket price still has to be 4¢–75¢.`;
  }
  const plays = [sit, scalp, event].sort((a, b) => b.score - a.score);
  const pick = plays[0];
  const sizeUsd = pick.id === "sit" ? 0 : 1;
  return { pick, plays, sizeUsd, clerk: "local" };
}
