import { createFileRoute } from "@tanstack/react-router";
import { readNews } from "@/lib/skill/news-read";
import { estimateProb } from "@/lib/skill/prob";
import { scoreBook } from "@/lib/skill/pipeline";
import { loadMicro } from "@/lib/scan/kalshi-shadow";
import { loadKalshiBooks } from "@/lib/scan/kalshi";
import { macroNewsKill } from "@/lib/scan/news-kill";
import { brtiStatus, ensureBrti } from "@/lib/skill/brti-socket.server";
import { ensurePyth, pythStatus } from "@/lib/skill/pyth-socket.server";

export const Route = createFileRoute("/api/live/skill")({
  server: {
    handlers: {
      GET: async () => {
        ensureBrti();
        ensurePyth();
        const rounds = await loadKalshiBooks(true);
        const news = await macroNewsKill();
        const newsRead = readNews(
          news.name
            ? { name: news.name, time: new Date(news.at).toISOString(), actual: null, forecast: null, previous: null, sourceUrl: "https://www.forexfactory.com/calendar" }
            : null,
          news.ok,
        );
        const brti = brtiStatus();
        const pyth = pythStatus();
        const rows = [];
        for (const book of ["btc", "gold"] as const) {
          const round = rounds.find((r) => r.book === book);
          const series = book === "gold" ? "KXGOLD15M" : "KXBTC15M";
          const micro = round?.ticker ? await loadMicro(series, round.ticker) : null;
          const spot = book === "btc" ? brti.trailing60 : pyth.candleClose;
          const volBps = book === "btc" ? brti.volBps : pyth.volBps;
          const feedOk = book === "btc" ? brti.healthy && spot != null : pyth.healthy && spot != null;
          const skill = scoreBook({
            book,
            bars: (micro?.bars ?? []).filter((b) => b.t > 0).map((b) => ({ ...b, closed: true })),
            nowSec: Math.floor(Date.now() / 1000),
            yesBids: micro?.yesBids,
            noBids: micro?.noBids,
            feed: feedOk
              ? { ok: true, source: book === "btc" ? "cf-brti-60s" : "pyth-gold-1m", mode: "live", value: spot ?? 0, at: Date.now(), ageMs: 0 }
              : { ok: false, source: book === "btc" ? "cf-brti-60s" : "pyth-gold-1m", missing: book === "btc" ? "BRTI not live" : "XAU candle not closed", stale: true },
            beat: round?.beat || null,
            volBps,
            leftSec: round?.leftSec ?? null,
            newsBlocked: news.kill,
            newsKnown: news.ok,
          });
          const prob = estimateProb({
            book,
            regime: skill.thesis,
            spot,
            beat: round?.beat || null,
            volBps,
            leftSec: round?.leftSec ?? null,
            yesAsk: round?.up ?? null,
            yesBid: micro?.yesBid ?? null,
            noAsk: round?.down ?? null,
            feedOk,
            calibrated: false,
            bullish: skill.confirms,
            bearish: skill.veto ? [skill.veto] : [],
          });
          const action = !feedOk || prob.modelPYes == null ? "WAITING" : prob.netEdge != null && prob.netEdge >= 0.03 ? "SHADOW" : "NO TRADE";
          rows.push({
            ...skill,
            ticker: round?.ticker ?? "",
            leftSec: round?.leftSec ?? null,
            strike: round?.beat ?? null,
            up: round?.up ?? null,
            down: round?.down ?? null,
            settlement: book === "btc" ? "60-tick BRTI average at the quarter close" : "Pyth XAU 1-minute close at the window",
            prob,
            action,
            why: prob.noTrade[0] ?? prob.uncertainty,
          });
        }
        return Response.json({
          live: false,
          cadenceSec: 30,
          books: ["btc", "gold"],
          note: "Bitcoin and gold show a formula here. Ether and solana are on the same heart scan, on their own CF index.",
          news: newsRead,
          brti: { status: brti.status, trailing: brti.trailing60, settlement: brti.settlement },
          xau: { status: pyth.status, spot: pyth.spot, candleClose: pyth.candleClose, settlement: pyth.settlement },
          rows,
        });
      },
    },
  },
});
