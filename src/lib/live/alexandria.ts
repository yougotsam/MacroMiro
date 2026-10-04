import { readFileSync } from "node:fs";

const FILE = "/workspace/data/alexandria-latest.json";

export type AlexTool = { provider: string; capability: string; description: string };

const NEWS = "/workspace/data/desk-news.json";

export function readDeskNews() {
  try {
    return JSON.parse(readFileSync(NEWS, "utf8")) as {
      cost?: { nasdaqHeadlines?: number; fedwatch?: number; calendar?: number };
      fed?: { meeting?: string; range?: string; ease?: number; noChange?: number; hike?: number; asOf?: string };
      calendar?: { thisWeek?: { name?: string; when?: string; actual?: string | null; forecast?: string | null }[]; nextWeek?: { name?: string; when?: string; actual?: string | null; forecast?: string | null }[] };
    };
  } catch {
    return null;
  }
}

export function readAlexandria(): { creditsUsed: number; tools: AlexTool[] } {
  try {
    const row = JSON.parse(readFileSync(FILE, "utf8")) as { creditsUsed?: number; tools?: AlexTool[] };
    return { creditsUsed: row.creditsUsed ?? 0, tools: Array.isArray(row.tools) ? row.tools : [] };
  } catch {
    return { creditsUsed: 0, tools: [] };
  }
}
