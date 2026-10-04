import { loadUsContracts, usToPoly } from "./pmus.server";
import type { PolyMarket } from "./graph";

export async function loadPolyUs(): Promise<PolyMarket[]> {
  return usToPoly(await loadUsContracts());
}
