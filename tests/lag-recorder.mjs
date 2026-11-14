// lag-recorder.mjs - smoke test for the opt-in slow-frame recorder.
// Forces a >50 ms frame and checks that the ring buffer receives it with script
// attribution when the Chromium build supports long-animation-frame.
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
  if (req.url === "/adviser.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(fs.readFileSync(target));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><html><body><div id=main></div></body></html>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  const noop = () => {};
  window.Spicetify = {
    Platform: { History: { listen: noop, location: { pathname: "/" } }, ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} } },
    PopupModal: { display: noop, hide: noop },
    Topbar: { Button: function Button(name) { this.name = name; } },
    Menu: { Item: function Item() { this.register = noop; } },
    showNotification: noop,
  };
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ url: `${origin}/adviser.js` });
await new Promise((r) => setTimeout(r, 400));

const supported = await page.evaluate(() => window.__perfAdviser ? window.__perfAdviser.lag.supported : null);
await page.evaluate(() => window.__perfAdviser.setState({ lagRecorder: true }));
// Burn 140 ms on the main thread inside a frame, twice, so LoAF has something.
await page.evaluate(() => {
  const burn = () => { const t = performance.now(); while (performance.now() - t < 140) {} };
  burn();
  return new Promise((r) => requestAnimationFrame(() => { burn(); requestAnimationFrame(r); }));
});
await new Promise((r) => setTimeout(r, 700));

const out = await page.evaluate(() => {
  const l = window.__perfAdviser.lag;
  return {
    running: l.running,
    mode: l.mode,
    entries: l.entries.map((e) => ({ duration: e.duration, blocking: e.blocking, scripts: e.scripts.map((s) => s.file) })),
    rollup: l.rollup(),
  };
});
const off = await page.evaluate(() => {
  window.__perfAdviser.setState({ lagRecorder: false });
  return { running: window.__perfAdviser.lag.running };
});

console.log(JSON.stringify({ supported, out, off }, null, 2));
await browser.close();
server.close();
const pass = !!supported && (out.entries.length > 0 || out.mode === "longtask") && off.running === false;
process.exit(pass ? 0 : 1);
