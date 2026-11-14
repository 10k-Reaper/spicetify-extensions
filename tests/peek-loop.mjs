// peek-loop.mjs - regression test for the self-triggering MutationObserver loop.
//
// Bug (1.0.1): updatePeekMirrors(true) called classList.add() unconditionally on
// elements that already had the class. Chromium queues an attribute record even
// for a no-op classList.add, so the body observer woke, queried the document for
// ".track-peek, .perf-adviser-peek-wrap, .perf-adviser-peek-anchor", found one,
// and called updatePeekMirrors(true) again. Callbacks run as microtasks, so the
// loop starved timers and rendering for as long as a .track-peek node existed.
//
// This test reproduces that with the real file and a stub Spicetify global:
//   node tests/peek-loop.mjs                    # current perf-adviser.js
//   node tests/peek-loop.mjs --file tests/fixtures/perf-adviser-1.0.1.js
//
// Exits 0 when the fixed behaviour is observed, 1 otherwise.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const argv = process.argv.slice(2);
const fileArg = argv.indexOf("--file");
const target = path.resolve(root, fileArg >= 0 ? argv[fileArg + 1] : "perf-adviser.js");
const CAP = 5000;
const WINDOW_MS = 300;

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("No Chrome/Edge found. Set CHROME_PATH.");
}

// A real HTTP origin gives us a working localStorage, which the extension uses.
const server = http.createServer((req, res) => {
  if (req.url === "/adviser.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(fs.readFileSync(target));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><html><head><title>peek-loop</title></head><body></body></html>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();

// Count every MutationObserver callback and hard-stop a runaway loop. The cap is
// the safety net: without it, a regression never yields and the test hangs.
await page.evaluateOnNewDocument(() => {
  const Native = window.MutationObserver;
  const stats = { callbacks: 0, capped: false };
  window.__moStats = stats;
  window.MutationObserver = class CountingMutationObserver extends Native {
    constructor(cb) {
      // Cap per observer, not globally: the runaway one must be stopped without
      // disabling the observers this test creates later (the CSSOM probe).
      let local = 0;
      super(function (records, observer) {
        stats.callbacks++;
        local++;
        if (local >= 5000) {
          stats.capped = true;
          try { observer.disconnect(); } catch (e) { /* ignore */ }
          return undefined;
        }
        return cb.call(this, records, observer);
      });
    }
  };

  // Minimal Spicetify surface: only the members perf-adviser.js touches.
  const noop = () => {};
  window.Spicetify = {
    Platform: {
      History: { listen: noop, location: { pathname: "/" } },
      ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} },
    },
    PopupModal: { display: noop, hide: noop },
    Topbar: { Button: function Button(name) { this.name = name; } },
    Menu: { Item: function Item() { this.register = noop; } },
    showNotification: noop,
  };
});

await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ url: `${origin}/adviser.js` });

// Give the extension's startup scan a beat, then reset to count only what the
// peek markup causes.
await new Promise((r) => setTimeout(r, 150));
await page.evaluate(() => { window.__moStats.callbacks = 0; });

// Exactly the shape updatePeekMirrors expects: .track-peek's parent gets the
// wrap class, the [data-testid="player-controls"] parent gets the anchor class.
await page.evaluate(() => {
  const host = document.createElement("div");
  host.id = "anchor";
  host.innerHTML = '<div data-testid="player-controls"><div id="wrap"><div class="track-peek"></div></div></div>';
  document.body.appendChild(host);
});

await new Promise((r) => setTimeout(r, WINDOW_MS));

const during = await page.evaluate(() => ({
  callbacks: window.__moStats.callbacks,
  capped: window.__moStats.capped,
  trackPeek: document.querySelectorAll(".track-peek").length,
  wrap: document.querySelectorAll(".perf-adviser-peek-wrap").length,
  anchor: document.querySelectorAll(".perf-adviser-peek-anchor").length,
  version: window.__perfAdviser ? window.__perfAdviser.version : null,
}));

// Remove the peek and confirm the mirror classes are cleaned up.
await page.evaluate(() => {
  const peek = document.querySelector(".track-peek");
  if (peek) peek.remove();
});
await new Promise((r) => setTimeout(r, WINDOW_MS));

const after = await page.evaluate(() => ({
  callbacks: window.__moStats.callbacks,
  capped: window.__moStats.capped,
  trackPeek: document.querySelectorAll(".track-peek").length,
  wrap: document.querySelectorAll(".perf-adviser-peek-wrap").length,
  anchor: document.querySelectorAll(".perf-adviser-peek-anchor").length,
}));

// CSSOM sanity: changing rule.selectorText must not produce DOM mutation
// records. This is what lets mirrorPeekRules() rewrite :has() selectors without
// waking the body observer.
const cssom = await page.evaluate(async () => {
  const style = document.createElement("style");
  style.textContent = ".cssom-probe { color: red; }";
  document.head.appendChild(style);
  const rule = style.sheet.cssRules[0];
  let records = 0;
  const obs = new MutationObserver((rs) => { records += rs.length; });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true });
  rule.selectorText = ".cssom-probe-changed";
  document.body.setAttribute("data-cssom-probe", "1"); // positive control
  await new Promise((r) => setTimeout(r, 50));
  document.body.removeAttribute("data-cssom-probe");
  obs.disconnect();
  return { records, selector: rule.selectorText };
});

const label = path.relative(root, target);
const pass =
  during.callbacks < 20 &&
  !during.capped &&
  during.wrap === 1 &&
  during.anchor === 1 &&
  after.wrap === 0 &&
  after.anchor === 0 &&
  after.trackPeek === 0 &&
  cssom.records >= 1; // the positive control landed, so 0 from CSSOM is meaningful

console.log(JSON.stringify({
  file: label,
  windowMs: WINDOW_MS,
  cap: CAP,
  during,
  after,
  cssom,
  pass,
}, null, 2));

await browser.close();
server.close();
process.exit(pass ? 0 : 1);
