/**
 * Report helper: sizing table for $250/$500/$1000 × risk configs (real venue specs), two candidate→exit traces from the
 * latest causal-replay sim, and an in-memory reconciliation demo (FakeExchange; nothing is sent anywhere).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { signedGet } from "../../src/lib/perps/kalshi-perps-read";
import { aggressiveProfile, sizePosition, RISK_CONFIGS } from "../../src/lib/perps/mandate";
import { PerpsOms, FakeExchange, type Intent } from "../../src/lib/perps/oms";
import { pickCurrentReplay, emptyTradeReport } from "../../src/lib/perps/replay-report";
import { DATA_ROOT } from "../../src/lib/data-root";

const risk: any = await signedGet("/risk_parameters"); const fees: any = await signedGet("/fee_tiers");
const out: Record<string, unknown> = {};
const dir = `${DATA_ROOT}/perps`;
const names = readdirSync(dir).filter((f) => /^sim-\d+\.json$/.test(f)).sort();
const loaded = names.map((name) => { const sim = JSON.parse(readFileSync(`${dir}/${name}`, "utf8")); return { name, label: sim.label as string | undefined, sim }; });
const picked = pickCurrentReplay(loaded);
out.quarantined = picked.quarantined;
if (!picked.file) {
  out.note = "no current replay. Legacy sim-*.json files are quarantined and are not P&L.";
  const f = `${dir}/report-${Date.now()}.json`; writeFileSync(f, JSON.stringify(out, null, 1));
  console.log(f); console.log(out.note); process.exit(0);
}
const sim = loaded.find((x) => x.name === picked.file)!.sim;
const simF = picked.file;
const rows: string[] = [];
for (const t of ["KXGOLDPERP", "KXBTCPERP"]) {
  const m: any = (await signedGet(`/markets/${t}`) as any).market;
  const spec = { leverage: m.leverage_estimates, initialMultiplier: Number(risk.initial_margin_multiplier[t] ?? 1.3), liqThreshold: Number(risk.liquidation_margin_ratio_threshold) };
  const found = sim.results.find((r: any) => r.market === t && r.cfg === "aggr7/maker/15%");
  const pack = emptyTradeReport(found?.trades);
  const stopPct = pack.stopMedian ?? 0.02;
  const entry = Number(m.price);
  for (const eq of [250, 500, 1000]) for (const rp of RISK_CONFIGS) for (const [label, sp] of [["median scalp stop", stopPct], ["wide 1h-swing stop (2%)", 0.02]] as const) {
    const s = sizePosition({ profile: aggressiveProfile(rp), equityUsd: eq, spec, ticker: t, group: t === "KXGOLDPERP" ? "metals" : "crypto", dir: "long", entry, stop: entry * (1 - sp), feeRateIn: fees.maker_fee_rates[t], feeRateOut: fees.taker_fee_rates[t], slipPerContract: 2 * Number(m.tick_size), fundingPctOverHold: 0 });
    rows.push(`${t} | $${eq} | ${rp * 100}% | ${label} ${(sp * 100).toFixed(2)}% | ${s.qty} | $${s.notionalUsd} | ${s.leverage}x | $${s.initialMarginUsd} | $${s.riskUsd} (${s.riskPctOfEquity}%) | liq ${s.liq?.liquidationPrice ?? "-"} (${s.liq?.distanceToLiqPct ?? "-"}% away) | binds: ${s.binding}`);
  }
  out[`trace_${t}`] = pack.trace ? { simFile: simF, cfg: "aggr7/maker/15%", label: sim.label, ...pack.trace, at: pack.at, makerFee: fees.maker_fee_rates[t], takerFee: fees.taker_fee_rates[t] } : { simFile: simF, cfg: "aggr7/maker/15%", label: sim.label, trades: 0, note: pack.note };
}
out.sizing = rows;
// reconciliation demo
const x = new FakeExchange(); const oms = new PerpsOms(x, null, true);
const i: Intent = { kind: "entry", ticker: "KXGOLDPERP", dir: "long", qty: 20, price: 4.2, maker: false, decisionId: "demo-1" };
const log: string[] = [];
x.failNextCreateAfterAccept = true; log.push(`1 submit (venue accepts, reply lost): ${(await oms.submit(i)).status}`);
log.push(`2 retry same intent: ${(await oms.submit(i)).status}; venue orders=${x.orders.length}`);
log.push(`3 reconcile: ${JSON.stringify(await oms.reconcile(0))}`);
await x.createOrder({ ticker: "KXBTCPERP", client_order_id: "web-ui-1", side: "bid", count: "1", price: "8.3", time_in_force: "immediate_or_cancel", self_trade_prevention_type: "taker_at_cross" });
log.push(`4 order placed outside the bot appears → reconcile: ${JSON.stringify(await oms.reconcile(0))}; blocked=${oms.blocked}`);
log.push(`5 new entry while blocked: ${(await oms.submit({ ...i, decisionId: "demo-2" })).status}`);
const o2 = new PerpsOms(x, null, true); log.push(`6 restart (empty journal) → recover: ${JSON.stringify(await o2.recover(0))}`);
out.reconciliation = log;
const f = `${DATA_ROOT}/perps/report-${Date.now()}.json`; writeFileSync(f, JSON.stringify(out, null, 1)); console.log(f);
console.log(rows.join("\n")); console.log(JSON.stringify(out.trace_KXGOLDPERP, null, 1)); console.log(JSON.stringify(out.trace_KXBTCPERP, null, 1)); console.log(log.join("\n"));
