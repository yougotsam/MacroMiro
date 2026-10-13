/**
 * Builds a READ-ONLY static snapshot of the desk dashboards (paper, perps, opportunity) from local data files.
 * No keys, no server functions, no order paths: plain HTML for sharing in a protected preview.
 *   bun scripts/ui/snapshot-site.ts [outDir=/workspace/ui-site]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const D = process.env.MACROMIRO_DATA_DIR || "/workspace/data";
const out = process.argv[2] || "/workspace/ui-site"; mkdirSync(out, { recursive: true });
const J = (f: string) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const latest = (re: RegExp) => { const f = readdirSync(`${D}/perps`).filter((x) => re.test(x)).sort().at(-1); return f ? J(`${D}/perps/${f}`) : null; };
const esc = (x: unknown) => String(x ?? "–").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const usd = (x: number | null | undefined) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`);
const table = (head: string[], rows: unknown[][]) => `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const built = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT";
const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · MacroMiro</title><style>
body{background:#0b0f14;color:#e5e7eb;font:14px/1.45 system-ui,sans-serif;margin:0}main{max-width:1200px;margin:0 auto;padding:16px}nav a{color:#7dd3fc;margin-right:14px;text-decoration:none;font-weight:600}
.banner{background:#3b2f06;color:#fde68a;padding:8px 12px;border-radius:8px;margin:10px 0}h1{font-size:22px}h2{font-size:16px;margin-top:26px;color:#93c5fd}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace}th{text-align:left;color:#9ca3af;font-weight:500;padding:4px 8px;border-bottom:1px solid #374151}td{padding:4px 8px;border-top:1px solid #1f2937;vertical-align:top}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.card{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px}.big{font-size:20px;font-weight:700}.neg{color:#fca5a5}.pos{color:#86efac}.muted{color:#9ca3af}
</style></head><body><main><nav><a href="index.html">Overview</a><a href="paper.html">Kalshi 15m paper</a><a href="perps.html">Perps</a><a href="opportunity.html">Opportunity ranking</a></nav>
<div class="banner">READ-ONLY SNAPSHOT built ${esc(built)}. Paper/research only. Orders are LOCKED, and this page holds no keys and no order buttons. Numbers are frozen at build time.</div><h1>${title}</h1>${body}</main></body></html>`;

const paper = J(`${D}/paper/paper-latest.json`);
const col = J(`${D}/perps/collector-status.json`);
const sim = latest(/^sim-\d+\.json$/); const rep = latest(/^report-\d+\.json$/); const intel = latest(/^intel-trace-\d+\.json$/);
const pairs = (() => { try { return readFileSync(`${D}/perps/pair-scan-latest.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } })();

// ---- paper
const cfgs = (paper?.configs ?? []) as any[];
const paperBody = paper ? `<p class="muted">Paper file generated ${esc(paper.generatedAt)} · mode ${esc(paper.mode?.mode)}</p>
<h2>Paper configs (Kalshi 15m YES/NO)</h2>${table(["Config", "Entries", "Settled", "Wins", "Net $", "Fees $", "95% CI", "Portfolio net", "Open exposure"], cfgs.map((c) => [c.label ?? c.id, c.entries, c.settled, c.wins, usd(c.netUsd), c.feesUsd?.toFixed?.(2), c.ci95Usd ? c.ci95Usd.map((x: number) => x.toFixed(2)).join(" … ") : "–", usd(c.portfolio?.netUsd), c.portfolio?.openExposureUsd]))}
<h2>Live feed at snapshot</h2>${table(["Series", "Ticker", "YES ask", "NO ask", "Spot", "Gate", "Stale"], Object.entries(paper.feed ?? {}).map(([k, f]: [string, any]) => [k, f.ticker, f.yesAsk, f.noAsk, f.spot, f.gate, f.stale]))}
<h2>Top ranked candidates (experimental)</h2>${table(["Market", "Side", "Entry", "Qty", "13-pt", "Model P (exp.)", "Kalshi implied", "EV $", "Decision"], ((paper.ranked ?? []) as any[]).slice(0, 15).map((c) => [c.ticker, c.side, c.entryPrice, c.qty, c.confluence == null ? c.confluenceState : `${c.confluence}/13`, (c.modelProbExperimental * 100).toFixed(1) + "%", (c.kalshiImplied * 100).toFixed(1) + "%", usd(c.evUsd), c.outcome ?? c.reason ?? c.deskGate]))}` : "<p>No paper file.</p>";

// ---- perps
const res = (sim?.results ?? []) as any[];
const simRows = res.filter((r) => r.trades.length).map((r) => [r.market.replace("KX", "").replace("PERP", ""), r.cfg, r.signals, r.makerMisses, r.trades.length, usd(r.netUsd), r.maxDdPct + "%", r.winRate == null ? "–" : (r.winRate * 100).toFixed(0) + "%", usd(r.avgWin), usd(r.avgLoss), r.exposurePct + "%", r.avgLev + "x"]);
const tr = (t: any) => t ? table(["When (UTC)", "Dir", "Setup", "Score", "Entry", "Stop", "Contracts", "Notional", "Leverage", "Exits", "Gross", "Fees", "Funding", "Net", "Hold"], [[t.at, t.dir, t.setup, t.score, t.entry, t.stop, t.qty, "$" + t.notional, t.lev + "x", t.exits, usd(t.gross), "$" + t.fees, usd(t.funding), usd(t.net), t.holdMin + "m"]]) : "";
const perpsBody = `<h2>Collector (read-only WebSocket)</h2><div class="cards">${col ? [["Markets", col.tickers?.length], ["Messages", col.msgs], ["Trades", col.trades], ["Seq gaps", col.gaps], ["Reconnects", col.reconnects], ["Status at", col.now]].map(([k, v]) => `<div class="card"><div class="muted">${k}</div><div class="big">${esc(v)}</div></div>`).join("") : "no status"}</div>
${col ? table(["Market", "Best bid", "Best ask", "Stale", "Book age ms"], Object.entries(col.books ?? {}).map(([k, b]: [string, any]) => [k, b.bestBid, b.bestAsk, b.stale, b.ageMs])) : ""}
<p class="muted">Margin balance at snapshot: ${esc(JSON.stringify(col?.rest?.balance ?? "n/a"))} · exchange ${esc(JSON.stringify(col?.rest?.status ?? ""))}</p>
<h2>Simulator: ${esc(sim?.label)} · ${esc(sim?.days)} days · $500 start</h2><p class="muted">Configs that never traded (the strict 9/13 gate fired 0 times) are hidden. Risk configs 10/15/20/25% sized the same because the margin cap binds first on tight stops.</p>
${table(["Market", "Config", "Signals", "Maker misses", "Trades", "Net", "Max DD", "Win %", "Avg win", "Avg loss", "Exposure", "Avg lev"], simRows)}
<h2>GOLD scalp: candidate → exit (causal replay)</h2>${tr(rep?.trace_KXGOLDPERP)}<h2>BTC scalp: candidate → exit (causal replay)</h2>${tr(rep?.trace_KXBTCPERP)}
<h2>Sizing (AGGRESSIVE_EXPERIMENTAL v1, proposed)</h2>${table(["Market | equity | risk cfg | stop | contracts | notional | lev | init margin | $ risk | liq | binds"], (rep?.sizing ?? []).map((s: string) => [s]))}
<h2>Reconciliation demo (in-memory exchange)</h2>${table(["Step"], (rep?.reconciliation ?? []).map((s: string) => [s]))}`;

// ---- opportunity / intel
const dec = ((intel ?? []) as any[]).filter((x) => !x.intelRows);
const rowsI = ((intel ?? []) as any[]).filter((x) => x.intelRows).flatMap((x) => x.intelRows.map((r: any) => [x.ticker, r.usable, r.source, r.event, r.publishedAt, r.availableAt, r.relevance, r.score, r.note]));
const oppBody = `<h2>Cross-market perps ranking with intel ON vs OFF</h2>${table(["Market", "Dir", "Score OFF", "Score ON", "Passes ≥7 OFF→ON", "Rank OFF", "Rank ON", "Decision"], dec.map((d) => [d.ticker, d.dir, `${d.intelOff.score} ${d.intelOff.setup}`, `${d.intelOn.score} ${d.intelOn.setup}`, `${d.intelOff.aggr7} → ${d.intelOn.aggr7}`, d.intelOff.rank, d.intelOn.rank, d.intelOn.decision]))}
<h2>Intel trace: SOURCE → EVENT → TIMESTAMP → RELEVANCE → SCORE</h2>${table(["Market", "Usable", "Source", "Event", "Published", "Available", "Rel.", "Score", "Note"], rowsI)}
<h2>Kalshi YES+NO pair scanner (read-only)</h2>${table(["Series", "Ticker", "YES ask", "NO ask", "Pair cost incl. fees", "Status", "At"], pairs.map((p: any) => [p.series, p.ticker, p.yesAsk, p.noAsk, p.cost, p.status, p.at]))}`;

const best = res.filter((r) => r.trades.length).sort((a, b) => b.netUsd - a.netUsd)[0];
const ov = `<div class="cards">${[["Perps orders", "LOCKED"], ["Kalshi live", "LOCKED (model not approved)"], ["Best perps sim config", best ? `${best.market} ${best.cfg} ${usd(best.netUsd)}` : "–"], ["Configs with edge", "none yet"], ["Perps margin balance", "$0.00"]].map(([k, v]) => `<div class="card"><div class="muted">${k}</div><div class="big">${esc(v)}</div></div>`).join("")}</div>
<h2>Pages</h2><ul><li><a href="paper.html">Kalshi 15m paper desk</a>: configs, feed, ranked candidates</li><li><a href="perps.html">Perps</a>: collector, simulator table, GOLD and BTC traces, sizing, reconciliation</li><li><a href="opportunity.html">Opportunity ranking</a>: intel trace, decision changes, pair scanner</li></ul>`;
writeFileSync(`${out}/index.html`, page("MacroMiro desk: overview", ov));
writeFileSync(`${out}/paper.html`, page("Kalshi 15m paper desk", paperBody));
writeFileSync(`${out}/perps.html`, page("Kalshi perps (paper)", perpsBody));
writeFileSync(`${out}/opportunity.html`, page("Opportunity ranking and intelligence", oppBody));
console.log(out, readdirSync(out));
