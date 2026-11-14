// author-check.mjs - the opt-in registration inventory and the author check.
// Two fixture "extensions": one registers a broad observer, a 20 ms interval and
// a hot listener; the other registers one scoped observer with a filter.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const target = path.resolve(root, "perf-adviser.js");
const fixtures = path.resolve(here, "fixtures");
const browserPath = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
  : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const rows = Array.from({ length: 120 }, (_, i) => `<div class="shelf" data-i="${i}" style="height:40px">shelf ${i}</div>`).join("");

const server = http.createServer((req, res) => {
  if (req.url === "/perf-adviser.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(target)); return; }
  if (req.url === "/author-bad.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(fixtures, "author-bad.js"))); return; }
  if (req.url === "/author-good.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(fixtures, "author-good.js"))); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><html><body>
    <div id="scoped" data-x="1"></div>
    <div id="scroller" style="overflow-y:auto;height:300px">${rows}</div>
  </body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  const noop = () => {};
  try { localStorage.setItem("perf-adviser:state", JSON.stringify({ authorMode: true })); } catch (e) { /* ignore */ }
  window.Spicetify = {
    Platform: {
      History: { listen: noop, location: { pathname: "/" } },
      ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} },
    },
    PopupModal: { display: noop, hide: noop },
    Topbar: { Button: function Button(n) { this.name = n; } },
    Menu: { Item: function Item() { this.register = noop; } },
    showNotification: noop,
  };
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ url: `${origin}/perf-adviser.js` });
await new Promise((r) => setTimeout(r, 400));
await page.addScriptTag({ url: `${origin}/author-bad.js` });
await page.addScriptTag({ url: `${origin}/author-good.js` });
await new Promise((r) => setTimeout(r, 100));

const inventory = await page.evaluate(() => {
  const a = window.__perfAdviser.author;
  return {
    mode: a.mode,
    saved: a.saved,
    stats: a.stats,
    thresholds: a.thresholds,
    sources: a.inventory().map((i) => ({
      source: i.source,
      intervals: i.intervals,
      observers: i.observers,
      listeners: i.listeners,
    })),
  };
});

const synthetic = await page.evaluate(() => {
  const a = window.__perfAdviser.author;
  const good = a.evaluate("author-good.js", {
    recordedMs: 6000,
    sources: [{ source: "author-good.js", totalMs: 12, forcedCount: 0, forcedMs: 0, intervalCalls: 0 }],
  }, { fps: 60, scrollable: true });
  const bad = a.evaluate("author-bad.js", {
    recordedMs: 6000,
    sources: [{
      source: "author-bad.js", totalMs: 1200, forcedCount: 2, forcedMs: 5.5,
      forcedBy: "scrollTop x2", intervalCalls: 300,
    }],
  }, { fps: 40, scrollable: true });
  return {
    good: { overall: good.overall, checks: good.checks.map((c) => [c.id, c.result]) },
    bad: { overall: bad.overall, checks: bad.checks.map((c) => [c.id, c.result]) },
  };
});

// The real timed test: 6 s synthetic scroll + 3 s idle, then PASS/WARN/FAIL.
const real = await page.evaluate(async () => {
  const r = await window.__perfAdviser.author.run("author-bad.js");
  return {
    source: r.source,
    overall: r.overall,
    checks: r.checks.map((c) => ({ id: c.id, result: c.result, evidence: c.evidence })),
    profile: r.profile && {
      recordedMs: r.profile.recordedMs,
      source: r.profile.source && {
        source: r.profile.source.source,
        totalMs: r.profile.source.totalMs,
        intervalCalls: r.profile.source.intervalCalls,
      },
    },
    authorTimings: r.authorTimings,
    api: !!window.__perfAdviser.author.result,
    scrollable: r.scroll && r.scroll.scrollable,
  };
});

console.log(JSON.stringify({ inventory, synthetic, real }, null, 2));

// A recording must restore the Author mode wrappers, not the natives it
// captured at load, or the inventory would go blind after the first check.
const afterRun = await page.evaluate(() => {
  const before = window.__perfAdviser.author.stats.registrations;
  window.setInterval(() => {}, 1000);
  return { before, after: window.__perfAdviser.author.stats.registrations };
});

await browser.close();
server.close();

const badInv = inventory.sources.find((s) => s.source === "author-bad.js");
const goodInv = inventory.sources.find((s) => s.source === "author-good.js");
const byId = (r) => Object.fromEntries(r.checks.map((c) => [c[0], c[1]]));
const realChecks = Object.fromEntries(real.checks.map((c) => [c.id, c.result]));

const ok =
  inventory.mode === true && inventory.saved === true &&
  inventory.stats.registrations >= 4 && inventory.stats.loadMs >= 0 &&
  inventory.thresholds.forcedMs === 2 &&
  !!badInv && badInv.observers.some((o) => o.broad && o.target === "body" && o.attrNoFilter) &&
  badInv.intervals.some((i) => i.ms === 20) &&
  badInv.listeners.some((l) => l.type === "scroll") &&
  !!goodInv && goodInv.observers.length === 1 && !goodInv.observers[0].broad &&
  goodInv.observers[0].filter[0] === "data-x" &&
  synthetic.good.overall === "pass" &&
  byId(synthetic.good).observers === "PASS" &&
  synthetic.bad.overall === "fail" &&
  byId(synthetic.bad).observers === "FAIL" &&
  byId(synthetic.bad).forced === "FAIL" &&
  byId(synthetic.bad).callback === "FAIL" &&
  byId(synthetic.bad).intervals === "FAIL" &&
  real.overall === "fail" &&
  realChecks.observers === "FAIL" &&
  realChecks.intervals === "FAIL" &&
  real.profile && real.profile.recordedMs >= 8000 &&
  real.authorTimings && real.authorTimings.kinds.interval &&
  real.authorTimings.kinds.interval.calls > 300 &&
  real.authorTimings.ms > 500 &&
  real.api === true && real.scrollable === true &&
  afterRun.after === afterRun.before + 1;
process.exit(ok ? 0 : 1);

