// bisect-open.mjs - the Bisect round can send the user to Marketplace ->
// Installed and mark only the cards named in that round. Navigation, marking,
// banner wording, the enable direction and cleanup are all checked here; no
// extension is ever toggled by the test or the extension.
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

const CARD_TITLES = ["adblockify", "Volume Percentage", "Quick Queue", "Modern ScrollBar"];
const cards = CARD_TITLES.map((t) =>
  '<div class="main-card-card marketplace-card--extension marketplace-card--installed">' +
  '<div class="main-card-cardMetadata"><a class="main-cardHeader-link" title="' + t + '">' +
  '<div class="main-cardHeader-text">' + t + "</div></a></div></div>"
).join("");
const html = `<!doctype html><html><body>
<div id="host"></div>
<div id="marketplace">
  <nav class="marketplace-tabBar">
    <a href="##" class="marketplace-tabBar-headerItemLink marketplace-tabBar-active" id="tab-ext">Extensions</a>
    <a href="##" class="marketplace-tabBar-headerItemLink" id="tab-installed">Installed</a>
  </nav>
  <div id="cards"></div>
</div>
<script>
  // Cards only mount after the Installed tab is clicked, like the real app.
  document.getElementById("tab-installed").addEventListener("click", () => {
    for (const el of document.querySelectorAll(".marketplace-tabBar-headerItemLink")) {
      el.classList.remove("marketplace-tabBar-active");
    }
    document.getElementById("tab-installed").classList.add("marketplace-tabBar-active");
    const box = document.getElementById("cards");
    if (box.dataset.built) return;
    box.dataset.built = "1";
    box.innerHTML = ${JSON.stringify(cards)};
  });
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/perf-adviser.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(target)); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 800 });
await page.evaluateOnNewDocument(() => {
  const noop = () => {};
  const listeners = [];
  const loc = { pathname: "/" };
  // A navigation helper the test can call to simulate leaving Marketplace.
  window.__route = (p) => {
    loc.pathname = p;
    for (const fn of listeners.slice()) fn();
  };
  window.Spicetify = {
    Config: { extensions: ["perf-adviser.js", "alpha.js"], custom_apps: ["marketplace"] },
    Platform: {
      History: {
        listen: (fn) => { listeners.push(fn); return () => {}; },
        location: loc,
        push: (p) => window.__route(p),
      },
      ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} },
    },
    PopupModal: {
      display: ({ content }) => { const host = document.getElementById("host"); host.textContent = ""; host.appendChild(content); },
      hide: () => { const host = document.getElementById("host"); if (host) host.textContent = ""; },
    },
    Topbar: { Button: function Button(n) { this.name = n; } },
    Menu: { Item: function Item() { this.register = noop; } },
    showNotification: noop,
  };
});
await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
await page.addScriptTag({ url: `${origin}/perf-adviser.js` });
await new Promise((r) => setTimeout(r, 300));

await page.evaluate(() => window.__perfAdviser.open());
await page.waitForFunction(() => !!document.querySelector(".perf-adviser-root"), { timeout: 30000 });

const result = await page.evaluate(async () => {
  const api = window.__perfAdviser.bisect;
  const out = { marketplace: api.marketplaceInstalled() };

  // A real disable round, then rebuild the panel on the Bisect tab.
  api.begin(["Quick Queue", "Volume Percentage", "adblockify"]);
  api.apply(60, 1);
  api.apply(60, 1);
  out.pendingDisable = api.state.pending;

  const clickText = (t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t);
    if (b) b.click();
    return !!b;
  };
  clickText("Bisect");
  await new Promise((r) => setTimeout(r, 50));
  out.panelButton = [...document.querySelectorAll("button")]
    .some((b) => b.textContent.trim() === "Open Marketplace -> Installed");
  out.panelInstruction = (document.querySelector(".perf-adviser-root") || {}).textContent || "";

  out.disabled = await api.openTargets(["Quick Queue", "Volume Percentage", "adblockify", "Ghost Extension"]);
  out.dom = {
    route: Spicetify.Platform.History.location.pathname,
    installedTabActive: document.getElementById("tab-installed").classList.contains("marketplace-tabBar-active"),
    hits: [...document.querySelectorAll(".perf-adviser-bisect-hit")]
      .map((c) => c.querySelector(".main-cardHeader-text").textContent),
    badges: [...document.querySelectorAll(".perf-adviser-bisect-badge")].map((b) => b.textContent),
    banner: (() => {
      const b = document.getElementById("perf-adviser-bisect-banner");
      return b ? { text: b.textContent, names: b.dataset.names, action: b.dataset.action, role: b.getAttribute("role") } : null;
    })(),
    popupClosed: !document.querySelector(".perf-adviser-root"),
  };
  out.marks = api.marks;

  // Dismiss removes every mark and the banner.
  const dismiss = document.querySelector("#perf-adviser-bisect-banner button");
  if (dismiss) dismiss.click();
  out.dismissed = {
    hits: document.querySelectorAll(".perf-adviser-bisect-hit").length,
    badges: document.querySelectorAll(".perf-adviser-bisect-badge").length,
    banner: !!document.getElementById("perf-adviser-bisect-banner"),
    marks: api.marks,
  };

  // Marking again, then leaving Marketplace, must clean up by itself.
  await api.openTargets(["Quick Queue"]);
  out.beforeLeave = document.querySelectorAll(".perf-adviser-bisect-hit").length;
  window.__route("/");
  out.afterLeave = {
    hits: document.querySelectorAll(".perf-adviser-bisect-hit").length,
    banner: !!document.getElementById("perf-adviser-bisect-banner"),
    marks: api.marks,
  };

  // A round that turns extensions back on uses the matching wording.
  api.apply(40, 1);
  out.pendingEnable = api.state.pending;
  out.enable = await api.openTargets();
  out.enableBadges = [...document.querySelectorAll(".perf-adviser-bisect-badge")].map((b) => b.textContent);
  out.enableBanner = (document.getElementById("perf-adviser-bisect-banner") || {}).textContent || "";
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();

const sorted = (a) => [...a].sort().join("|");
const ok =
  result.marketplace === true &&
  result.pendingDisable.action === "disable" &&
  result.pendingDisable.toggled.join(",") === "Quick Queue,Volume Percentage" &&
  result.panelButton === true &&
  result.panelInstruction.includes("Marketplace -> Installed") &&
  result.disabled.ok === true &&
  result.disabled.reason === "marked" &&
  sorted(result.disabled.highlighted) === sorted(["adblockify", "Quick Queue", "Volume Percentage"]) &&
  result.disabled.missing.join(",") === "Ghost Extension" &&
  result.dom.route === "/marketplace" &&
  result.dom.installedTabActive === true &&
  sorted(result.dom.hits) === sorted(["adblockify", "Quick Queue", "Volume Percentage"]) &&
  result.dom.badges.length === 3 &&
  result.dom.badges.every((t) => t === "Remove for this round") &&
  result.dom.banner && result.dom.banner.action === "disable" &&
  result.dom.banner.role === "status" &&
  result.dom.banner.names.split("|").length === 4 &&
  result.dom.banner.text.includes("Turn these extensions OFF") &&
  result.dom.banner.text.includes("1 not found on this page: Ghost Extension") &&
  result.dom.popupClosed === true &&
  result.marks.highlighted.length === 3 &&
  result.dismissed.hits === 0 && result.dismissed.badges === 0 && result.dismissed.banner === false &&
  result.dismissed.marks.highlighted.length === 0 &&
  result.beforeLeave === 1 &&
  result.afterLeave.hits === 0 && result.afterLeave.banner === false && result.afterLeave.marks.names.length === 0 &&
  result.pendingEnable.action === "enable" &&
  result.enable.ok === true &&
  result.enableBadges.join(",") === "Turn back ON for this round" &&
  result.enableBanner.includes("Turn these extensions back ON") &&
  result.enableBanner.includes("Marketplace -> Installed");
process.exit(ok ? 0 : 1);
