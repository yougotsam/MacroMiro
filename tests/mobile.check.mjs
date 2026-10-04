#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const VIEWPORTS = [
  { name: "iPhone-SE", width: 375, height: 667 },
  { name: "iPhone-14", width: 390, height: 844 },
  { name: "iPad-Mini", width: 768, height: 1024 },
];
const TABS = ["Floor", "Scan", "Gate", "Watch", "Analogs", "Broker"];

mkdirSync("/tmp/mobile", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const report = [];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1800);
  for (const tab of TABS) {
    const btn = page.getByRole("button", { name: tab, exact: true });
    if (await btn.count()) await btn.first().click();
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const small = await page.$$eval("a, button, [role=button], select", (els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
        })
        .map((e) => (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 40)),
    );
    report.push({ vp: vp.name, tab, overflow, small: small.length, samples: small.slice(0, 6) });
    await page.screenshot({ path: `/tmp/mobile/${vp.name}-${tab.replace(/\W/g, "_")}.png` });
  }
  await page.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.overflow > 1 || r.small > 0);
if (bad.length) {
  console.error("FAIL", bad.length);
  process.exit(1);
}
console.log("PASS");
