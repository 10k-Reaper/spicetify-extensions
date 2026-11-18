// panel-scroll.mjs - the panel keeps its scroll position across rebuilds:
// tab switches, a refresh, and a measurement that closes and reopens the modal.
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

const rows = Array.from({ length: 160 }, (_, i) => `<div style="height:40px">row ${i}</div>`).join("");
const server = http.createServer((req, res) => {
  if (req.url === "/perf-adviser.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(target)); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><html><body><div id="host"></div><div id="scroller" style="overflow-y:auto;height:300px">${rows}</div></body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 700 });
await page.evaluateOnNewDocument(() => {
  const noop = () => {};
  window.Spicetify = {
    Config: { extensions: ["perf-adviser.js", "alpha.js", "beta.js", "gamma.js"] },
    Platform: {
      History: { listen: noop, location: { pathname: "/" } },
      ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} },
    },
    PopupModal: {
      display: ({ content }) => { window.__displayCount = (window.__displayCount || 0) + 1; const host = document.getElementById("host"); host.textContent = ""; host.appendChild(content); },
      hide: () => { const host = document.getElementById("host"); if (host) host.textContent = ""; },
    },
    Topbar: { Button: function Button(n) { this.name = n; } },
    Menu: { Item: function Item() { this.register = noop; } },
    showNotification: noop,
  };
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ url: `${origin}/perf-adviser.js` });
await page.evaluate(() => window.__perfAdviser.open());
await page.waitForFunction(() => !!document.querySelector(".perf-adviser-root"), { timeout: 30000 });

const clickText = (text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t);
  if (!b) return false;
  b.click();
  return true;
}, text);

// Scroll the report, switch to Bisect, and come back.
await page.evaluate(() => { document.querySelector(".perf-adviser-root").scrollTop = 500; });
await new Promise((r) => setTimeout(r, 120));
const scrolled = await page.evaluate(() => document.querySelector(".perf-adviser-root").scrollTop);
const firstOpen = await page.evaluate(() => ({
  displays: window.__displayCount || 0,
  unmeasured: document.querySelector(".perf-adviser-root").textContent.includes("Press Measure to run a 5-second scroll test"),
}));
// Each tab keeps its own offset. Park Other at 300, then switch away.
await clickText("Other");
await new Promise((r) => setTimeout(r, 120));
await page.evaluate(() => { document.querySelector(".perf-adviser-root").scrollTop = 300; });
await new Promise((r) => setTimeout(r, 120));
const otherScrolled = await page.evaluate(() => document.querySelector(".perf-adviser-root").scrollTop);
await clickText("Bisect");
await new Promise((r) => setTimeout(r, 120));
const bisectView = await page.evaluate(() => {
  const root = document.querySelector(".perf-adviser-root");
  const report = [...root.children].find((c) => c.style.display === "none");
  return {
    rootScroll: root.scrollTop,
    hiddenChildren: [...root.children].filter((c) => c.style.display === "none").length,
    hasBisect: root.textContent.includes("Guided bisect"),
    reportHidden: !!report,
    displays: window.__displayCount || 0,
  };
});
await clickText("Report");
await new Promise((r) => setTimeout(r, 120));
const backToReport = await page.evaluate(() => ({
  scroll: document.querySelector(".perf-adviser-root").scrollTop,
  view: document.querySelector(".perf-adviser-root").dataset.view,
  displays: window.__displayCount || 0,
}));
await clickText("Other");
await new Promise((r) => setTimeout(r, 120));
const backToOther = await page.evaluate(() => ({
  scroll: document.querySelector(".perf-adviser-root").scrollTop,
  view: document.querySelector(".perf-adviser-root").dataset.view,
}));
await clickText("Report");
await new Promise((r) => setTimeout(r, 120));

// "Measure" hides the modal, benchmarks, then reopens the panel.
const clicked = await clickText("Measure");
await page.waitForFunction(() => {
  const root = document.querySelector(".perf-adviser-root");
  return !!root && root.dataset.view === "report" && !window.__busyMarker;
}, { timeout: 40000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 500));
const afterMeasure = await page.evaluate(() => {
  const root = document.querySelector(".perf-adviser-root");
  return { exists: !!root, scroll: root ? root.scrollTop : null, view: root ? root.dataset.view : null, displays: window.__displayCount || 0 };
});

console.log(JSON.stringify({ scrolled, otherScrolled, firstOpen, bisectView, backToReport, backToOther, clicked, afterMeasure }, null, 2));
await browser.close();
server.close();

const ok =
  scrolled === 500 &&
  otherScrolled > 0 &&
  firstOpen.displays === 1 && firstOpen.unmeasured &&
  bisectView.hasBisect && bisectView.reportHidden && bisectView.hiddenChildren === 2 &&
  bisectView.rootScroll === 0 && bisectView.displays === 1 &&
  backToReport.scroll === 500 && backToReport.view === "report" && backToReport.displays === 1 &&
  backToOther.scroll === otherScrolled && backToOther.view === "other" &&
  clicked === true &&
  afterMeasure.exists && afterMeasure.view === "report" && afterMeasure.displays === 2 &&
  Math.abs(afterMeasure.scroll - 500) <= 2;
process.exit(ok ? 0 : 1);
