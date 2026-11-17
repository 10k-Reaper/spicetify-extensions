// theme-tweaks.mjs - the optional cosmetic tweaks must survive stylesheets
// that Spotify/Marketplace inject after this extension. Marketplace's own
// route CSS declares .marketplace-card--installed { border: 1px solid
// var(--spice-button) } and colors.css re-declares --spice-button-active on
// :root after this extension runs, which is why a plain rule and a plain :root
// block used to lose on the live client.
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
  res.end(`<!doctype html><html><body>
<div class="main-card-card marketplace-card--extension marketplace-card--installed">installed</div>
<div class="main-nowPlayingBar-nowPlayingBar">bar</div>
</body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  const noop = () => {};
  window.Spicetify = {
    Config: { extensions: ["perf-adviser.js"], custom_apps: ["marketplace"] },
    Platform: {
      History: { listen: noop, location: { pathname: "/marketplace" } },
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

const result = await page.evaluate(() => {
  const api = window.__perfAdviser;
  const card = document.querySelector(".marketplace-card--installed");
  const bar = document.querySelector(".main-nowPlayingBar-nowPlayingBar");
  const read = () => ({
    border: getComputedStyle(card).border,
    buttonActive: getComputedStyle(document.documentElement).getPropertyValue("--spice-button-active").trim(),
    barHeight: getComputedStyle(bar).height,
    styleText: (document.getElementById("perf-adviser-fixes") || {}).textContent || "",
  });

  const out = { off: read() };
  api.setState({ themeTweaks: true });
  out.on = read();

  // Marketplace's route CSS, then colors.css: both injected after ours.
  const market = document.createElement("style");
  market.id = "spicetify-routes-marketplace";
  market.textContent = ".marketplace-card--installed { flex: 0 1 0%; border: 1px solid var(--spice-button); }";
  document.head.appendChild(market);
  const colors = document.createElement("style");
  colors.id = "colors";
  colors.textContent = ":root { --spice-button: #1ed760; --spice-button-active: #1ed760; }";
  document.head.appendChild(colors);
  out.competing = read();

  // A theme that also fixes the player bar height must not beat the tweak.
  const theme = document.createElement("style");
  theme.textContent = ".main-nowPlayingBar-nowPlayingBar { height: 96px !important; }";
  document.head.appendChild(theme);
  out.themeBar = read().barHeight;

  api.setState({ themeTweaks: false });
  out.afterOff = read();
  out.styleCount = document.querySelectorAll("#perf-adviser-fixes").length;
  out.marketCount = document.querySelectorAll("#spicetify-routes-marketplace").length;
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();

const ok =
  result.off.border === "0px none rgb(0, 0, 0)" &&
  result.off.styleText.indexOf("814fff") === -1 &&
  result.on.border === "2px solid rgb(129, 79, 255)" &&
  result.on.buttonActive === "#7b3bff" &&
  result.on.barHeight === "72px" &&
  result.on.styleText.indexOf("border: 2px solid #814fff !important") >= 0 &&
  result.on.styleText.indexOf(":root:root { --spice-button-active: #7b3bff; }") >= 0 &&
  result.competing.border === "2px solid rgb(129, 79, 255)" &&
  result.competing.buttonActive === "#7b3bff" &&
  result.competing.barHeight === "72px" &&
  result.themeBar === "72px" &&
  result.afterOff.border === "1px solid rgb(30, 215, 96)" &&
  result.afterOff.buttonActive === "#1ed760" &&
  result.afterOff.barHeight === "96px" &&
  result.afterOff.styleText.indexOf("814fff") === -1 &&
  result.styleCount === 1 && result.marketCount === 1;
process.exit(ok ? 0 : 1);
