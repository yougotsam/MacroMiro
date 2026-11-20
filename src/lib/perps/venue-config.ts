/**
 * Predictions and margin use distinct REST hosts. Read-only demo/production boundaries.
 * https://docs.kalshi.com/margin
 */
export const MARGIN_ENDPOINTS = {
  demo: {
    rest: "https://external-api.demo.kalshi.co",
    marketWs: "wss://external-api-margin-ws.demo.kalshi.co",
    userWs: "wss://margin-user-ws.demo.kalshi.co",
  },
  production: {
    rest: "https://external-api.kalshi.com",
    marketWs: "wss://external-api-margin-ws.kalshi.com",
    userWs: "wss://margin-user-ws.kalshi.com",
  },
} as const;
export const MARGIN_REST_PATH = "/trade-api/v2/margin";
export const MARGIN_WS_PATH = "/trade-api/ws/v2/margin";
export function resolveMarginHosts(env: Record<string, string | undefined> = process.env) {
  const mode = env.KALSHI_PERPS_ENV === "demo" ? "demo" : "production";
  if (env.KALSHI_PERPS_ENV && !["demo", "production"].includes(env.KALSHI_PERPS_ENV)) {
    throw new Error("invalid Kalshi margin environment");
  }
  const allowed = MARGIN_ENDPOINTS[mode];
  const rest = env.KALSHI_PERPS_HOST ?? allowed.rest;
  const marketWs = env.KALSHI_PERPS_WS ?? allowed.marketWs;
  const userWs = env.KALSHI_PERPS_USER_WS ?? allowed.userWs;
  if (rest !== allowed.rest || marketWs !== allowed.marketWs || userWs !== allowed.userWs) {
    throw new Error("Kalshi margin host/environment mismatch");
  }
  return { mode, rest, marketWs, userWs } as const;
}
export const MARGIN_HOSTS = resolveMarginHosts();
