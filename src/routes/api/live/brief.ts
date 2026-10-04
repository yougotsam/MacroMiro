import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/live/brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { text?: string };
        const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
        if (text.length < 20) return Response.json({ ok: false, error: "nothing to read" }, { status: 400 });
        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) return Response.json({ ok: false, error: "voice is off" }, { status: 503 });
        const res = await fetch("https://api.x.ai/v1/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ text, voice_id: "eve" }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return Response.json({ ok: false, error: `voice ${res.status}` }, { status: 502 });
        const audio = await res.arrayBuffer();
        return new Response(audio, {
          headers: { "Content-Type": res.headers.get("content-type") || "audio/mpeg", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
