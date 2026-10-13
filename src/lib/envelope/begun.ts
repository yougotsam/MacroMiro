import { createServerFn } from "@tanstack/react-start";

/**
 * Read-only: is the kalshi_begin switch on (0/1)? Runs on the server only. The kill-switch module
 * (kill.server.ts) is imported inside the handler, so it never ships to the browser and nothing here
 * can write a switch. GET, no input, same access as the public /api/live/heart status read.
 */
export const getBegun = createServerFn({ method: "GET" }).handler(async (): Promise<boolean> => {
  const { beginFlagOn } = await import("./kill.server");
  return beginFlagOn();
});
