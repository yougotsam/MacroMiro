import type { CalEvent } from "./types";

export function eiaStreet(cal: CalEvent[]) {
  return cal.find((e) => /EIA Crude/i.test(e.name));
}

export function cpiStreet(cal: CalEvent[]) {
  return cal.find((e) => /CPI/i.test(e.name) && e.country === "US");
}

export function printed(cal: CalEvent[]) {
  return cal.find((e) => e.actual != null && Number.isFinite(Number(e.actual)));
}

export function seriesFor(name: string) {
  if (/CPI/i.test(name)) return "cpi_mm";
  if (/Payroll|NFP|Nonfarm/i.test(name)) return "nfp";
  if (/EIA Crude/i.test(name)) return "eia_crude_stocks";
  return null;
}