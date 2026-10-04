/**
 * Mobile layout checks. Run:
 *   node tests/mobile.check.mjs
 * (Playwright Chromium is already in this workspace.)
 */
export const MOBILE_VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "iPad Mini", width: 768, height: 1024 },
] as const;

export const MOBILE_TABS = ["Floor", "Scan", "Gate", "Watch", "Analogs", "Broker"] as const;
