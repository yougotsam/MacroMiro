import { createFileRoute } from "@tanstack/react-router";
import { readRadar, refreshRadar } from "@/lib/live/catalyst.server";
import { readAlexandria, readDeskNews } from "@/lib/live/alexandria";
import { kickSparkIfStale, readSpark, runSparkBrief } from "@/lib/live/spark.server";

export const Route = createFileRoute("/api/firecrawl/radar")({
  server: {
    handlers: {
      GET: async () => {
        kickSparkIfStale();
        const spark = readSpark();
        return Response.json({
          ...readRadar(),
          spark: spark?.status ? `spark ${spark.status}` : readRadar().spark,
          sparkCard: spark?.card ?? null,
          sparkAt: spark?.at ?? null,
          creditsUsed: spark?.creditsUsed ?? null,
          alexandria: readAlexandria(),
          deskNews: readDeskNews(),
        });
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { spark?: boolean };
        if (body.spark) {
          const spark = await runSparkBrief();
          const radar = readRadar();
          return Response.json({ ...radar, spark: spark.status, sparkCard: spark.card, sparkError: spark.error, creditsUsed: spark.creditsUsed });
        }
        return Response.json(await refreshRadar());
      },
    },
  },
});