// scroll-scope.mjs - the Home card-play-button class follows Home only.
// Scrolling Now Playing lyrics (or any other pane) must not hide it, and the
// class must never be put on <html>.
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

const tall = Array.from({ length: 60 }, (_, i) => `<div style="height:40px">row ${i}</div>`).join("");
const server = http.createServer((req, res) => {
  if (req.url === "/adviser.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(target)); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><html><body>
    <div id="home" data-testid="home-page" style="overflow-y:auto;height:200px">
      <div class="main-card-PlayButtonContainer" id="play">play</div>${tall}
    </div>
    <div id="lyrics" style="overflow-y:auto;height:200px">${tall}</div>
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
await new Promise((r) => setTimeout(r, 400));

const state = () => page.evaluate(() => {
  const home = document.getElementById("home");
  const play = document.getElementById("play");
  return {
    homeClass: home.classList.contains("perf-adviser-scrolling"),
    htmlClass: document.documentElement.classList.contains("perf-adviser-scrolling"),
    playDisplay: getComputedStyle(play).display,
    style: !!document.getElementById("perf-adviser-fixes"),
  };
});

// Scroll the lyrics pane: the class must not appear anywhere.
await page.evaluate(() => {
  const el = document.getElementById("lyrics");
  el.scrollTop = 200;
  el.dispatchEvent(new Event("scroll"));
});
await new Promise((r) => setTimeout(r, 60));
const lyrics = await state();

// Scroll Home: class on the Home root, play button hidden while scrolling.
await page.evaluate(() => {
  const el = document.getElementById("home");
  el.scrollTop = 200;
  el.dispatchEvent(new Event("scroll"));
});
await new Promise((r) => setTimeout(r, 60));
const homeScrolling = await state();

// After the 180 ms window the class and the hidden button are gone.
await new Promise((r) => setTimeout(r, 300));
const homeAtRest = await state();

// Master pause must remove the injected CSS as well as the runtime patches.
await page.evaluate(() => window.__perfAdviser.setState({ cardPlayFix: true, cssOff: true }));
await new Promise((r) => setTimeout(r, 80));
const paused = await page.evaluate(() => ({
  style: !!document.getElementById("perf-adviser-fixes"),
  homeClass: document.getElementById("home").classList.contains("perf-adviser-scrolling"),
}));

// Resuming puts the injected style back from the saved choices.
await page.evaluate(() => window.__perfAdviser.setState({ cssOff: false }));
await new Promise((r) => setTimeout(r, 80));
const resumed = await state();

console.log(JSON.stringify({ lyrics, homeScrolling, homeAtRest, paused, resumed }, null, 2));
await browser.close();
server.close();

const ok =
  !lyrics.homeClass && !lyrics.htmlClass && lyrics.playDisplay !== "none" &&
  homeScrolling.homeClass && !homeScrolling.htmlClass && homeScrolling.playDisplay === "none" &&
  !homeAtRest.homeClass && homeAtRest.playDisplay !== "none" &&
  !paused.style && paused.homeClass === false &&
  resumed.style && resumed.playDisplay !== "none";
process.exit(ok ? 0 : 1);
