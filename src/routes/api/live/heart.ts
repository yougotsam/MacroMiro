import { createFileRoute } from "@tanstack/react-router";
import { writeFileSync } from "node:fs";
import { clampClip } from "@/lib/envelope/clip";
import { executeHeart, flattenBook, readHeart, setArmed, tickHeart, ensureHeart } from "@/lib/envelope/heart.server";
import { beginFlagOn, liveExecutionAllowed, liveFlagOn } from "@/lib/envelope/kill.server";
import { loadHeart } from "@/lib/envelope/store.server";
import type { BookId } from "@/lib/live/types";

export const Route = createFileRoute("/api/live/heart")({
  server: {
    handlers: {
      GET: async () => {
        ensureHeart();
        const state = loadHeart();
        return Response.json({
          ...state,
          execute: false,
          livePath: liveFlagOn(),
          begun: beginFlagOn(),
          liveExecution: liveExecutionAllowed(),
        });
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          armed?: boolean;
          clipUsd?: number;
          tick?: boolean;
          flatten?: BookId;
          execute?: boolean;
          begin?: boolean;
        };
        if (typeof body.begin === "boolean") {
          writeFileSync("/workspace/.grok/secrets/kalshi_begin", body.begin ? "1\n" : "0\n");
          setArmed(body.begin, 1);
        }
        if (body.flatten) return Response.json(await flattenBook(body.flatten));
        if (typeof body.armed === "boolean" && body.tick !== true) {
          setArmed(body.armed, body.clipUsd != null ? clampClip(body.clipUsd) : undefined);
        } else if (body.clipUsd != null && body.tick !== true) {
          setArmed(loadHeart().armed, clampClip(body.clipUsd));
        }
        if (body.execute) return Response.json(await executeHeart());
        const state = body.tick ? await tickHeart(true) : await readHeart();
        return Response.json({
          ...state,
          execute: false,
          livePath: liveFlagOn(),
          begun: beginFlagOn(),
          liveExecution: liveExecutionAllowed(),
        });
      },
    },
  },
});

ensureHeart();
