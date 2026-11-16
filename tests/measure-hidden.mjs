// measure-hidden.mjs - Measure must not hang when the Spotify window is hidden.
// A hidden page gets no requestAnimationFrame callbacks, so the FPS loop would
// never settle and the panel would stay closed. The watchdog must reopen the
// panel, keep the previous result, and say why nothing was measured.
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
  window.__notes = [];
  window.Spicetify = {
    Config: { extensions: ["perf-adviser.js", "alpha.js", "beta.js"] },
    Platform: {
      History: { listen: noop, location: { pathname: "/" } },
      ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} },
    },
    PopupModal: {
      display: ({ content }) => {
        window.__displayCount = (window.__displayCount || 0) + 1;
        const host = document.getElementById("host");
        host.textContent = "";
        host.appendChild(content);
      },
      hide: () => { const host = document.getElementById("host"); if (host) host.textContent = ""; },
    },
    Topbar: { Button: function Button(n) { this.name = n; } },
    Menu: { Item: function Item() { this.register = noop; } },
    showNotification: (msg) => window.__notes.push(String(msg)),
  };
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ url: `${origin}/perf-adviser.js` });
await page.evaluate(() => window.__perfAdviser.open());
await page.waitForFunction(() => !!document.querySelector(".perf-adviser-root"), { timeout: 30000 });

// A hidden window receives no animation frames at all.
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

const started = Date.now();
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Measure");
  if (!b) return false;
  b.click();
  return true;
});
const reopened = await page.waitForFunction(() => (window.__displayCount || 0) >= 2 && !!document.querySelector(".perf-adviser-root"), { timeout: 20000, polling: 100 })
  .then(() => true).catch(() => false);
const seconds = (Date.now() - started) / 1000;

const after = await page.evaluate(() => {
  const root = document.querySelector(".perf-adviser-root");
  const text = root ? root.textContent : "";
  return {
    root: !!root,
    unmeasured: /Nothing has been measured yet/.test(text),
    hasMeasure: [...(root ? root.querySelectorAll("button") : [])].some((b) => b.textContent.trim() === "Measure"),
    notes: window.__notes.slice(),
    displays: window.__displayCount || 0,
  };
});

console.log(JSON.stringify({ clicked, reopened, seconds: +seconds.toFixed(1), after }, null, 2));
await browser.close();
server.close();

const told = after.notes.some((n) => /window was hidden/i.test(n));
const ok = clicked && reopened && seconds < 15 && after.root && after.unmeasured && after.hasMeasure && told && after.displays === 2;
process.exit(ok ? 0 : 1);
