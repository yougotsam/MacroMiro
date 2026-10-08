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
 * Reads the probability the real MiroFish client already saved.
 * There is no second API. A blank file means the town has not answered.
 */
export async function fetchMiroFishForecast(req: MiroFishSimulationRequest): Promise<MiroFishSimulationResult> {
  const live = readMirofish();
  if (!live || live.probability == null) {
    throw new Error("MiroFish has no probability yet");
  }
  return fromPair(req.ticker, live.probability, live.headline || req.catalystHeadline, new Date(live.at).toISOString());
}
