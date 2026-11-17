// offscreen-anims.mjs - the opt-in fix pauses endless CSS animations only
// while their element is outside the viewport, resumes them on the way in,
// picks up widgets that mount a little later, and leaves nothing behind when
// switched off (or when the master pause is used).
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
  res.end(`<!doctype html><html><head><style>
    @keyframes pulse { 0% { opacity: 1 } 50% { opacity: .4 } 100% { opacity: 1 } }
    .box { position: absolute; width: 80px; height: 80px; background: #333; animation: pulse 2s linear infinite; }
    #visible { top: 40px; left: 40px; }
    #far { top: 3000px; left: 40px; }
  </style></head><body>
    <div class="box" id="visible"></div>
    <div class="box" id="far"></div>
    <div style="height:4000px"></div>
  </body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 700 });
await page.evaluateOnNewDocument(() => {
  const noop = () => {};
  window.Spicetify = {
    Config: { extensions: ["perf-adviser.js"], custom_apps: [] },
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
await new Promise((r) => setTimeout(r, 300));

const result = await page.evaluate(async () => {
  const api = window.__perfAdviser;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const far = document.getElementById("far");
  const vis = document.getElementById("visible");
  const snap = () => ({
    farClass: far.classList.contains("perf-adviser-offscreen-anim"),
    visClass: vis.classList.contains("perf-adviser-offscreen-anim"),
    farPlay: getComputedStyle(far).animationPlayState,
    visPlay: getComputedStyle(vis).animationPlayState,
    styles: document.querySelectorAll("#perf-adviser-offscreen").length,
    info: api.offscreenInfo(),
  });
  const out = { before: snap() };

  api.setState({ offscreen: true });
  await wait(500);
  out.on = snap();

  api.setState({ offscreen: true }); // idempotent: never a second style/observer
  await wait(150);
  out.again = snap();

  // A widget added after enabling is caught by the 1.5 s late collection.
  const late = document.createElement("div");
  late.className = "box";
  late.style.top = "3600px";
  late.style.left = "40px";
  document.body.appendChild(late);
  await wait(2000);
  out.late = {
    classed: late.classList.contains("perf-adviser-offscreen-anim"),
    play: getComputedStyle(late).animationPlayState,
  };

  // Scrolling it into view resumes it (IntersectionObserver with 80 px margin).
  far.scrollIntoView();
  await wait(400);
  out.scrolledIn = {
    farClass: far.classList.contains("perf-adviser-offscreen-anim"),
    farPlay: getComputedStyle(far).animationPlayState,
  };
  window.scrollTo(0, 0);
  await wait(300);

  // Master pause removes the observer, the class and the style.
  api.setState({ cssOff: true });
  await wait(150);
  out.pausedAll = snap();

  api.setState({ cssOff: false, offscreen: false });
  await wait(150);
  out.off = snap();
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();

const ok =
  result.before.farClass === false && result.before.visClass === false && result.before.styles === 0 &&
  result.before.farPlay === "running" && result.before.info.observer === false &&
  result.on.farClass === true && result.on.farPlay === "paused" &&
  result.on.visClass === false && result.on.visPlay === "running" &&
  result.on.styles === 1 && result.on.info.on === true && result.on.info.observer === true &&
  result.on.info.paused === 1 && result.on.info.watched === 2 &&
  result.again.styles === 1 && result.again.info.watched === 2 &&
  result.late.classed === true && result.late.play === "paused" &&
  result.scrolledIn.farClass === false && result.scrolledIn.farPlay === "running" &&
  result.pausedAll.farClass === false && result.pausedAll.farPlay === "running" &&
  result.pausedAll.styles === 0 && result.pausedAll.info.on === false && result.pausedAll.info.observer === false &&
  result.off.farClass === false && result.off.styles === 0 && result.off.info.watched === 0;
process.exit(ok ? 0 : 1);
