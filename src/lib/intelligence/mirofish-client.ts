import { readMirofish } from "../intel/mirofish";

export interface MiroFishSimulationRequest {
  ticker: string;
  catalystHeadline: string;
  currentPrice: number;
  timeHorizonMinutes: number;
  personaCount?: number;
}

export interface MiroFishSimulationResult {
  ticker: string;
  bullProbability: number;
  bearProbability: number;
  consensusConfidence: number;
  narrativeSummary: string;
  simulatedVolIndex: number;
  timestamp: string;
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function fromPair(ticker: string, bull: number, summary: string, at: string): MiroFishSimulationResult {
  const bullProbability = clamp01(bull);
  const bearProbability = clamp01(1 - bullProbability);
  return {
    ticker,
    bullProbability,
    bearProbability,
    consensusConfidence: Number((Math.abs(bullProbability - 0.5) * 2).toFixed(4)),
    narrativeSummary: summary,
    simulatedVolIndex: 0,
    timestamp: at,
  };
}

/**
 * The desk's forecast shape.
 * A custom MIROFISH_API_URL may expose /api/v1/simulation/execute.
 * The real MiroFish program does not. It listens on port 5001.
 * If the custom URL is missing or refuses, we read the probability the real client already saved.
 */
export async function fetchMiroFishForecast(
  req: MiroFishSimulationRequest,
  mirofishEndpoint = process.env.MIROFISH_API_URL ?? "",
): Promise<MiroFishSimulationResult> {
  if (mirofishEndpoint) {
    try {
      const response = await fetch(`${mirofishEndpoint.replace(/\/+$/, "")}/api/v1/simulation/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.MIROFISH_API_KEY ? { Authorization: `Bearer ${process.env.MIROFISH_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          market_ticker: req.ticker,
          context_event: req.catalystHeadline,
          spot_reference: req.currentPrice,
          duration_minutes: req.timeHorizonMinutes,
          persona_density: req.personaCount ?? 64,
          enable_zep_memory: true,
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) {
        const data = (await response.json()) as { metrics?: { p_bull?: number; p_bear?: number; consensus_score?: number; volatility_index?: number }; summary?: string };
        const bull = Number(data.metrics?.p_bull);
        if (Number.isFinite(bull)) {
          const row = fromPair(req.ticker, bull, String(data.summary ?? req.catalystHeadline), new Date().toISOString());
          if (Number.isFinite(Number(data.metrics?.consensus_score))) row.consensusConfidence = clamp01(Number(data.metrics?.consensus_score));
          if (Number.isFinite(Number(data.metrics?.volatility_index))) row.simulatedVolIndex = Number(data.metrics?.volatility_index);
          if (Number.isFinite(Number(data.metrics?.p_bear))) row.bearProbability = clamp01(Number(data.metrics?.p_bear));
          return row;
        }
      }
    } catch {
      /* the real process is the fallback */
    }
  }
  const live = readMirofish();
  if (!live || live.probability == null) {
    throw new Error("MiroFish has no probability yet");
  }
  return fromPair(req.ticker, live.probability, live.headline || req.catalystHeadline, new Date(live.at).toISOString());
}
