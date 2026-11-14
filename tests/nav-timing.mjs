// nav-timing.mjs - route-change cost uses the shared LoAF observer and normalises paths.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const target = path.resolve(root, "perf-adviser.js");
const browserPath = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
  : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const server = http.createServer((req, res) => {
  if (req.url === "/adviser.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(target)); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><html><body><div id=main></div></body></html>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  const noop = () => {};
  const listeners = [];
  window.Spicetify = {
    Platform: {
      History: {
        listen: (fn) => listeners.push(fn),
        location: { pathname: "/" },
        __fire(p) { this.location.pathname = p; for (const fn of listeners) fn({ pathname: p }); },
      },
      ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} },
    },
    PopupModal: { display: noop, hide: noop },
    Topbar: { Button: function Button(n) { this.name = n; } },
    Menu: { Item: function Item() { this.register = noop; } },
    showNotification: noop,
  };
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ url: `${origin}/adviser.js` });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => window.__perfAdviser.setState({ navTiming: true }));

// Route change with a real main-thread stall, then enough time for finalize.
await page.evaluate(() => {
  Spicetify.Platform.History.__fire("/playlist/abc123");
  const burn = () => { const t = performance.now(); while (performance.now() - t < 140) {} };
  burn();
  return new Promise((r) => requestAnimationFrame(() => { burn(); requestAnimationFrame(r); }));
});
await new Promise((r) => setTimeout(r, 2400));
const first = await page.evaluate(() => {
  window.__perfAdviser.lag.nav.finalize(false);
  return { rows: window.__perfAdviser.lag.nav.rows(), recent: window.__perfAdviser.lag.nav.recent };
});

// A quiet route change should still produce a sample, with cost near zero.
await page.evaluate(() => Spicetify.Platform.History.__fire("/search"));
await new Promise((r) => setTimeout(r, 2300));
const second = await page.evaluate(() => {
  window.__perfAdviser.lag.nav.finalize(false);
  return { rows: window.__perfAdviser.lag.nav.rows(), recent: window.__perfAdviser.lag.nav.recent };
});

console.log(JSON.stringify({ first, second }, null, 2));
await browser.close();
server.close();

const ok =
  first.rows.some((r) => r.route === "/playlist/*" && r.n >= 1) &&
  first.rows.find((r) => r.route === "/playlist/*").median > 0 &&
  second.rows.some((r) => r.route === "/search" && r.n >= 1);
process.exit(ok ? 0 : 1);
