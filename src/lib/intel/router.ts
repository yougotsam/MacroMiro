export type IntelTool = "scrape" | "agent" | "monitor" | "crawl" | "search" | "parse" | "github";

export function routeIntel(input: {
  knownUrl?: boolean;
  recurring?: boolean;
  wholeSite?: boolean;
  pdf?: boolean;
  code?: boolean;
  webScale?: boolean;
}): IntelTool {
  if (input.code) return "github";
  if (input.pdf) return "parse";
  if (input.wholeSite) return "crawl";
  if (input.recurring && input.knownUrl) return "monitor";
  if (input.webScale) return "search";
  if (input.knownUrl) return "scrape";
  return "agent";
}
