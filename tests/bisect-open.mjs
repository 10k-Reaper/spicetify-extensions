// bisect-open.mjs - the Bisect round can send the user to Marketplace and mark
// only the cards named in that round. A disable round marks Installed cards; an
// enable round has to follow the card to the Extensions tab, because Marketplace
// moves a disabled extension there and gives it an Install button. Navigation,
// marking, banner wording and cleanup are checked here. No extension is ever
// toggled by the test or by the extension.
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
const card = (t, installed) =>
  '<div class="main-card-card marketplace-card--extension' + (installed ? " marketplace-card--installed" : "") + '">' +
  '<div class="main-card-cardMetadata"><a class="main-cardHeader-link" title="' + t + '">' +
  '<div class="main-cardHeader-text">' + t + "</div></a>" +
  '<div class="main-card-cardMetadata"></div></div></div>';

const html = `<!doctype html><html><body>
<style>
  .Dropdown-root { display: none; }
  body.dropdown-mode .Dropdown-root { display: block; }
</style>
<div id="host"></div>
<div id="marketplace">
  <nav class="marketplace-tabBar">
    <a href="##" class="marketplace-tabBar-headerItemLink" id="tab-ext">Extensions</a>
    <a href="##" class="marketplace-tabBar-headerItemLink marketplace-tabBar-active" id="tab-installed">Installed</a>
    <div class="Dropdown-root"><div class="Dropdown-control" id="more">More</div>
      <div class="Dropdown-menu" id="more-menu" style="display:none">
        <div class="Dropdown-option" data-tab="Extensions">Extensions</div>
        <div class="Dropdown-option" data-tab="Installed">Installed</div>
      </div>
    </div>
  </nav>
  <div id="cards">${CARD_TITLES.map((t) => card(t, true)).join("")}</div>
  <div id="browse"></div>
</div>
<script>
  const renderBrowse = () => {
    document.getElementById("browse").innerHTML = ${JSON.stringify(CARD_TITLES.map((t) => card(t, false)).join(""))};
  };
  const setActive = (id) => {
    for (const el of document.querySelectorAll("#tab-ext, #tab-installed")) el.classList.remove("marketplace-tabBar-active");
    document.getElementById(id).classList.add("marketplace-tabBar-active");
    window.__activeTab = id === "tab-ext" ? "Extensions" : "Installed";
  };
  document.getElementById("tab-ext").addEventListener("click", () => { setActive("tab-ext"); renderBrowse(); });
  document.getElementById("tab-installed").addEventListener("click", () => setActive("tab-installed"));
  // Marketplace collapses every tab into a "More" dropdown when its width
  // measurement comes back zero. In that state the links are absent and only
  // the dropdown can switch tabs.
  document.getElementById("more").addEventListener("mousedown", () => {
    if (!document.body.classList.contains("dropdown-mode")) return;
    const menu = document.getElementById("more-menu");
    menu.style.display = menu.style.display === "none" ? "" : "none";
  });
  for (const opt of document.querySelectorAll(".Dropdown-option")) {
    opt.addEventListener("click", () => {
      document.getElementById("more-menu").style.display = "none";
      const ext = opt.dataset.tab === "Extensions";
      setActive(ext ? "tab-ext" : "tab-installed");
      if (ext) renderBrowse();
    });
  }
  window.__dropdownMode = (on) => {
    document.body.classList.toggle("dropdown-mode", !!on);
    for (const id of ["tab-ext", "tab-installed"]) {
      document.getElementById(id).classList.toggle("marketplace-tabBar-headerItemLink", !on);
    }
    document.getElementById("more-menu").style.display = "none";
  };
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
    const b = [...document.querySelectorAll(".perf-adviser-root button")].find((x) => x.textContent.trim() === t);
    if (b) b.click();
    return !!b;
  };
  clickText("Bisect");
  await new Promise((r) => setTimeout(r, 50));
  out.panelButton = [...document.querySelectorAll(".perf-adviser-root button")]
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
      return b ? { text: b.textContent, names: b.dataset.names, action: b.dataset.action, role: b.getAttribute("role"), browse: b.dataset.browse } : null;
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

  // A round that turns extensions back on. Marketplace has moved the disabled
  // cards to the Extensions tab by now, so the Installed list no longer has
  // them; the round must follow them there and use the Install badge/wording.
  api.apply(40, 1);
  out.pendingEnable = api.state.pending;
  for (const c of [...document.querySelectorAll(".marketplace-card--installed")]) {
    const title = (c.querySelector(".main-cardHeader-text") || {}).textContent || "";
    if (out.pendingEnable.toggled.some((t) => t.toLowerCase() === title.trim().toLowerCase())) c.remove();
  }
  clickText("Report");
  clickText("Bisect");
  // The panel is closed after the last openTargets call; reopen it to check
  // the enable round's button, then let openTargets hide it again.
  window.__perfAdviser.open();
  for (let i = 0; i < 100 && !document.querySelector(".perf-adviser-root"); i++) await new Promise((r) => setTimeout(r, 50));
  clickText("Report");
  clickText("Bisect");
  await new Promise((r) => setTimeout(r, 80));
  out.enableButton = [...document.querySelectorAll(".perf-adviser-root button")]
    .some((b) => b.textContent.trim() === "Open Marketplace -> Extensions");
  out.enable = await api.openTargets();
  out.enableBadges = [...document.querySelectorAll(".perf-adviser-bisect-badge")].map((b) => b.textContent.trim());
  out.enableBanner = (document.getElementById("perf-adviser-bisect-banner") || {}).textContent || "";
  out.enableTab = (document.querySelector(".marketplace-tabBar-active") || {}).textContent || "";
  out.enableHits = [...document.querySelectorAll(".perf-adviser-bisect-hit")]
    .map((c) => c.querySelector(".main-cardHeader-text").textContent.trim());

  // Same enable round, but Marketplace has collapsed its tabs into the "More"
  // dropdown (a zero-width measurement at mount does this). The links are
  // gone, so the round must switch tabs through the dropdown instead.
  window.__dropdownMode(true);
  out.dropdownMode = {
    links: document.querySelectorAll(".marketplace-tabBar-headerItemLink").length,
    control: !!document.querySelector(".marketplace-tabBar .Dropdown-control"),
  };
  out.dropdown = await api.openTargets();
  out.dropdownBadges = [...document.querySelectorAll(".perf-adviser-bisect-badge")].map((b) => b.textContent.trim());
  out.dropdownBanner = (document.getElementById("perf-adviser-bisect-banner") || {}).textContent || "";
  out.dropdownActive = window.__activeTab;
  out.dropdownHits = [...document.querySelectorAll(".perf-adviser-bisect-hit")]
    .map((c) => c.querySelector(".main-cardHeader-text").textContent.trim());
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
  result.disabled.browse === 0 &&
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
  result.dom.banner.browse === "0" &&
  result.dom.banner.text.includes("Turn these extensions OFF") &&
  result.dom.banner.text.includes("in Marketplace -> Installed") &&
  result.dom.banner.text.includes("1 not found on this page: Ghost Extension") &&
  result.dom.popupClosed === true &&
  result.marks.highlighted.length === 3 &&
  result.dismissed.hits === 0 && result.dismissed.badges === 0 && result.dismissed.banner === false &&
  result.dismissed.marks.highlighted.length === 0 &&
  result.beforeLeave === 1 &&
  result.afterLeave.hits === 0 && result.afterLeave.banner === false && result.afterLeave.marks.names.length === 0 &&
  result.pendingEnable.action === "enable" &&
  result.enableButton === true &&
  result.enable.ok === true &&
  result.enable.browse === result.pendingEnable.toggled.length &&
  result.enableHits.length === result.pendingEnable.toggled.length &&
  result.enableBadges.length === result.pendingEnable.toggled.length &&
  result.enableBadges.every((t) => t === "Install again for this round") &&
  result.enableTab.trim() === "Extensions" &&
  result.enableBanner.includes("Turn these extensions back ON") &&
  result.enableBanner.includes("in Marketplace -> Extensions (Install)") &&
  result.enableBanner.includes("Extensions tab") &&
  result.enableBanner.includes("press Install to turn it back on") &&
  result.dropdownMode.links === 0 &&
  result.dropdownMode.control === true &&
  result.dropdown.ok === true &&
  result.dropdown.reason === "marked" &&
  result.dropdown.browse === result.pendingEnable.toggled.length &&
  result.dropdownBadges.length === result.pendingEnable.toggled.length &&
  result.dropdownBadges.every((t) => t === "Install again for this round") &&
  result.dropdownActive === "Extensions" &&
  result.dropdownBanner.includes("in Marketplace -> Extensions (Install)") &&
  result.dropdownBanner.includes("Extensions tab");
process.exit(ok ? 0 : 1);
