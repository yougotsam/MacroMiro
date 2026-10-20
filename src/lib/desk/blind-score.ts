/**
 * Gold, silver, oil, and FX. Structure from complete settlement-index bars.
 * Flow is the unavailable tape unless a proxy has been admitted. Crypto is untouched.
 */
import type { Series } from "./config";
import { unavailableFlow } from "./features";
import { chooseBlind, vetoEvidence } from "./index-bars";
import { RESEARCH_PRODUCT } from "./market-data";
import { admittedFlow } from "./proxy-tape";
import { evaluateSniper, type Evidence } from "./sniper";

export function blindScore(series: Series, macroClear: boolean): { long: Evidence; short: Evidence; flow: ReturnType<typeof unavailableFlow> } | null {
  if (RESEARCH_PRODUCT[series]) return null;
  const choice = chooseBlind(series);
  const flow = admittedFlow(series) ?? unavailableFlow();
  const side = (dir: "long" | "short") => {
    const e = evaluateSniper(choice.m15, choice.h1, dir, macroClear);
    return choice.veto ? vetoEvidence(e, choice.veto) : e;
  };
  return { long: side("long"), short: side("short"), flow };
}
