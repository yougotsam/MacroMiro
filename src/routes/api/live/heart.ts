import { createFileRoute } from "@tanstack/react-router";
import { clampClip } from "@/lib/envelope/clip";
import { flattenBook, readHeart, setArmed, tickHeart, ensureHeart } from "@/lib/envelope/heart.server";
import { mutationGuard } from "@/lib/desk/http-guard";
import { beginFlagOn, liveExecutionAllowed, liveFlagOn, readKill } from "@/lib/envelope/kill.server";
import { loadHeart } from "@/lib/envelope/store.server";
import type { BookId } from "@/lib/live/types";

export const Route = createFileRoute("/api/live/heart")({
  server: {
    handlers: {
      GET: async () => {
        ensureHeart();
        const state = loadHeart();
        const kill = readKill();
        return Response.json({
          ...state,
          execute: false,
          livePath: liveFlagOn(),
          begun: beginFlagOn(),
          liveExecution: liveExecutionAllowed(),
          dayLoss: kill.dailyLossUsd,
          pauseUntil: kill.pauseUntil,
          losses: kill.consecutiveLosses,
        });
      },
      POST: async ({ request }) => {
        // Display state only: the desk engine (scripts/desk-engine.ts) is the only order process,
        // and kalshi_begin / desk_arm are never written from HTTP.
        const denied = mutationGuard(request);
        if (denied) return denied;
        const body = (await request.json().catch(() => ({}))) as {
          armed?: boolean;
          clipUsd?: number;
          tick?: boolean;
          flatten?: BookId;
        };
        if (body.flatten) return Response.json(await flattenBook(body.flatten));
        if (typeof body.armed === "boolean" && body.tick !== true) {
          setArmed(body.armed, body.clipUsd != null ? clampClip(body.clipUsd) : undefined);
        } else if (body.clipUsd != null && body.tick !== true) {
          setArmed(loadHeart().armed, clampClip(body.clipUsd));
        }
        const state = body.tick ? await tickHeart() : await readHeart();
        const kill = readKill();
        return Response.json({
          ...state,
          execute: false,
          livePath: liveFlagOn(),
          begun: beginFlagOn(),
          liveExecution: liveExecutionAllowed(),
          dayLoss: kill.dailyLossUsd,
          pauseUntil: kill.pauseUntil,
          losses: kill.consecutiveLosses,
        });
      },
    },
  },
});

ensureHeart();
