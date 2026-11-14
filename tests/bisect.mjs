// bisect.mjs - decision steps for the guided bisect, with supplied FPS values
// so the halving and noise logic can be tested without six reloads.
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
  if (req.url === "/perf-adviser.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(target)); return; }
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
    Config: { extensions: ["perf-adviser.js", "alpha.js", "beta.js"] },
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

const result = await page.evaluate(() => {
  const api = window.__perfAdviser.bisect;
  const out = { candidates: api.candidates() };

  // One real culprit in a four-extension set: a and b are toggled off, the
  // metric improves, then only a is turned back on and nothing changes, then b
  // is turned back on and the metric collapses again.
  api.begin(["a", "b", "c", "d"]);
  out.baseline = api.apply(60, 1);
  out.calibrated = api.apply(60, 1);
  out.firstInstruction = api.instruction();
  out.round1 = api.apply(40, 1);
  out.round2a = api.apply(41, 1);
  out.round2b = api.apply(42, 1);
  out.round3 = api.apply(60, 1);
  out.report = api.report();

  // Two extensions that only hurt together: toggling either one alone is
  // inside the noise band both times, so the run must not name a winner.
  api.begin(["x", "y"]);
  out.comboBaseline = api.apply(50, 1);
  out.comboCalibrated = api.apply(50, 1);
  out.comboToggleX = api.apply(51, 1);
  out.comboToggleX2 = api.apply(50, 1);
  out.comboToggleY = api.apply(51, 1);
  out.comboToggleY2 = api.apply(50, 1);
  return out;
});

console.log(JSON.stringify({
  candidates: result.candidates,
  noiseFloor: result.calibrated.noiseFloor,
  instruction: result.firstInstruction,
  round1: result.round1.rounds[0],
  round2Noise: result.round2b.rounds[1],
  found: result.round3.found,
  status: result.round3.status,
  comboStatus: result.comboToggleY2.status,
  comboNote: result.comboToggleY2.note,
  report: result.report,
}, null, 2));
await browser.close();
server.close();

const ok =
  result.candidates.join(",") === "alpha,beta" &&
  result.calibrated.noiseFloor === 2 &&
  /Turn OFF these 2 extension\(s\).*a, b/.test(result.firstInstruction) &&
  result.round1.phase === "running" &&
  result.round1.candidates.join(",") === "a,b" &&
  result.round1.pending.toggled.join(",") === "a" &&
  result.round1.pending.action === "enable" &&
  result.round2b.rounds.length === 2 &&
  result.round2b.rounds[1].outcome.indexOf("within noise twice") === 0 &&
  result.round2b.candidates.join(",") === "b" &&
  result.round3.found.join(",") === "b" &&
  result.round3.status === "found" &&
  result.round3.rounds.length === 3 &&
  /culprit b/.test(result.report) &&
  result.comboToggleY2.status === "inconclusive" &&
  /combination/.test(result.comboToggleY2.note);
process.exit(ok ? 0 : 1);
