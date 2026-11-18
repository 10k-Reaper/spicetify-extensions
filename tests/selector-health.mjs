// selector-health.mjs - statuses and version persistence for the selector registry.
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
  res.end(`<!doctype html><html><body>
    <div class="main-topBar-background"></div>
    <div data-testid="home-page">
      <div class="main-home-filterChipsSection"></div>
      <div class="main-card-PlayButtonContainer"></div>
    </div>
    <div class="cover-art"></div>
    <div class="main-nowPlayingBar-nowPlayingBar"></div>
    <div data-testid="player-controls"><div></div></div>
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
      version: "1.3.8.620",
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

const first = await page.evaluate(() => {
  const h = window.__perfAdviser.selectorHealth();
  return {
    version: h.version, source: h.source, migrated: h.migrated, route: h.route,
    byId: Object.fromEntries(h.rows.map((r) => [r.id, r.status])),
    topbarSel: (h.rows.find((r) => r.id === "header-topbar") || {}).sel,
    stored: JSON.parse(localStorage.getItem("perf-adviser:selector-health")),
  };
});

// Current Spotify builds mount .Root__globalNav instead of the legacy
// .main-topBar-background. The row must resolve to the name that exists.
const renamed = await page.evaluate(() => {
  const legacy = document.querySelector(".main-topBar-background");
  if (legacy) legacy.remove();
  const current = document.createElement("div");
  current.className = "Root__globalNav";
  document.body.appendChild(current);
  const h = window.__perfAdviser.selectorHealth();
  const row = h.rows.find((r) => r.id === "header-topbar");
  return { status: row.status, sel: row.sel };
});

// Pretend the previous run was on an older Spotify build and that Home was seen
// then; remove the Home node so its current status must be STALE, not NOT SEEN.
const second = await page.evaluate(() => {
  const home = document.querySelector('[data-testid="home-page"]');
  if (home) home.remove();
  const store = JSON.parse(localStorage.getItem("perf-adviser:selector-health"));
  store.spotifyVersion = "1.3.7.100";
  store.seen["home-page"] = { version: "1.3.7.100", lastSeen: "2026-01-01T00:00:00.000Z", route: "/" };
  localStorage.setItem("perf-adviser:selector-health", JSON.stringify(store));
  const h = window.__perfAdviser.selectorHealth();
  return {
    migrated: h.migrated, previous: h.previous,
    byId: Object.fromEntries(h.rows.map((r) => [r.id, r.status])),
    storedVersion: JSON.parse(localStorage.getItem("perf-adviser:selector-health")).spotifyVersion,
  };
});

// A route where the Home selectors should be reported as N/A, not broken.
const third = await page.evaluate(() => {
  Spicetify.Platform.History.location.pathname = "/search";
  const h = window.__perfAdviser.selectorHealth();
  return { route: h.route, byId: Object.fromEntries(h.rows.map((r) => [r.id, r.status])) };
});

console.log(JSON.stringify({ first, renamed, second, third }, null, 2));
await browser.close();
server.close();

const ok =
  first.byId["home-page"] === "OK" &&
  first.byId["header-topbar"] === "OK" &&
  first.topbarSel === ".main-topBar-background" &&
  renamed.status === "OK" &&
  renamed.sel === ".Root__globalNav" &&
  first.byId["header-search"] === "N/A here" &&
  first.byId["header-tracklist"] === "N/A here" &&
  first.source === "Spicetify.Platform.version" &&
  first.storedVersion === undefined &&
  first.stored.spotifyVersion === "1.3.8.620" &&
  second.migrated === true &&
  second.byId["home-page"] === "STALE" &&
  second.storedVersion === "1.3.8.620" &&
  third.route === "/search" &&
  third.byId["home-page"] === "N/A here";
process.exit(ok ? 0 : 1);
