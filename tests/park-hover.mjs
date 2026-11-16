// park-hover.mjs - the runtime patcher must not park selectors that depend on
// hover/focus/active. Parking those stalls or replays Spotify hover effects
// (Library "Collapse Your Library", "Go back") because a hover cannot wait for
// the next scan. A purely idle :has() rule must still be parked.
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
  res.end(`<!doctype html><html><head><style id="fixture">
    .hover-rule:has(.row:hover) .label { color: red; }
    .focus-rule:has(.row:focus-visible) .label { color: blue; }
    .idle-rule:has(.never-present) { color: green; }
  </style></head><body>
    <div class="hover-rule" id="h"><div class="row"><span class="label">label</span></div></div>
    <div class="focus-rule" id="f"><div class="row"><span class="label">label</span></div></div>
    <div class="idle-rule" id="i">idle</div>
  </body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  const noop = () => {};
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
await page.addScriptTag({ url: `${origin}/adviser.js` });
await new Promise((r) => setTimeout(r, 1200));

const out = await page.evaluate(() => {
  const rules = [...document.getElementById("fixture").sheet.cssRules].map((r) => r.selectorText);
  const info = window.__perfAdviser.patchInfo();
  return {
    rules,
    hoverRuleParked: rules.find((s) => s.includes("hover-rule")) || "",
    focusRuleParked: rules.find((s) => s.includes("focus-rule")) || "",
    idleRule: rules[2] || "",
    parked: info.parked,
    active: info.active,
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();

const ok =
  out.active === true &&
  out.hoverRuleParked.includes(":hover") &&
  out.focusRuleParked.includes(":focus-visible") &&
  out.idleRule.startsWith("perf-adviser-parked-") &&
  out.parked >= 1;
process.exit(ok ? 0 : 1);
