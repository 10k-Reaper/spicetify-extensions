// paused-state.mjs - a saved state must never stop the extension from loading.
//
// Regression: pressing "Pause all fixes" saves cssOff:true. On reload the
// module-scope restore called clearScrollClass() before scrollHost (a `let`)
// was initialized, which threw a ReferenceError and aborted the IIFE, so
// install() never ran and the top-bar icon was missing. These cases load each
// saved shape and check that the icon, the menu item and the panel are still
// created, and that pause only turns effects off.
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
  if (req.url === "/perf-adviser.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(fs.readFileSync(target));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><html><head></head><body><div id=main></div></body></html>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const DEFAULTS = {
  headerFix: true,
  cardPlayFix: true,
  coverPause: false,
  themeTweaks: false,
  offscreen: false,
  runtimePatch: true,
  cssOff: false,
  lagRecorder: false,
  navTiming: false,
  authorMode: false,
};

const CASES = [
  {
    name: "paused",
    raw: JSON.stringify({ cssOff: true, headerFix: true, cardPlayFix: true }),
    expect: { cssOff: true, headerFix: true, cardPlayFix: true },
    pausedPanel: true,
  },
  {
    name: "all-options-off",
    raw: JSON.stringify({
      headerFix: false, cardPlayFix: false, coverPause: false, themeTweaks: false,
      offscreen: false, runtimePatch: false, cssOff: false,
      lagRecorder: false, navTiming: false, authorMode: false,
    }),
    expect: { cssOff: false, headerFix: false, cardPlayFix: false, runtimePatch: false, offscreen: false },
    noEffects: true,
  },
  { name: "empty-object", raw: "{}", expect: { cssOff: false, headerFix: true, cardPlayFix: true } },
  { name: "corrupted-json", raw: "{not json", expect: { cssOff: false, headerFix: true, cardPlayFix: true } },
  {
    name: "unknown-field",
    raw: JSON.stringify({ cssOff: true, headerFix: true, cardPlayFix: true, futureOption: 123 }),
    expect: { cssOff: true, headerFix: true, cardPlayFix: true },
    pausedPanel: true,
  },
  {
    name: "invalid-types",
    raw: JSON.stringify({ cssOff: "yes", headerFix: 0, cardPlayFix: null, runtimePatch: "on" }),
    expect: { cssOff: false, headerFix: true, cardPlayFix: true, runtimePatch: true },
  },
];

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

const failures = [];
const note = (ok, label, detail) => {
  if (!ok) failures.push(label + (detail ? " - " + detail : ""));
  console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  [" + detail + "]" : ""));
};

for (const testCase of CASES) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e)));
  await page.evaluateOnNewDocument((raw) => {
    localStorage.setItem("perf-adviser:state", raw);
    const noop = () => {};
    window.__topbarIcons = [];
    window.__menuItems = [];
    window.__modals = [];
    window.__hideCalls = 0;
    window.Spicetify = {
      Config: { extensions: ["perf-adviser.js", "alpha.js", "beta.js"] },
      Platform: {
        version: "1.3.9.2055",
        History: { listen: noop, location: { pathname: "/" } },
        ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} },
      },
      PopupModal: {
        display(opts) {
          window.__modals.push(opts && opts.title);
          const content = opts && opts.content;
          if (content && content.nodeType === 1) document.body.appendChild(content);
        },
        hide() { window.__hideCalls++; },
      },
      Topbar: {
        Button: function Button(name, icon, onClick) {
          window.__topbarIcons.push({ name, icon, onClick });
        },
      },
      Menu: {
        Item: function Item(name) {
          const item = { name, register: noop };
          window.__menuItems.push(item);
          return item;
        },
      },
      showNotification: noop,
    };
  }, testCase.raw);

  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: `${origin}/perf-adviser.js` });
  await new Promise((r) => setTimeout(r, 600));

  const out = await page.evaluate(async () => {
    const api = window.__perfAdviser;
    if (!api) {
      return { api: false, icons: window.__topbarIcons, menus: window.__menuItems, errorsSoFar: true };
    }
    const state = api.getState();
    // Opening the panel must work in every saved shape, including paused.
    await api.open();
    const text = document.body.textContent || "";
    return {
      api: true,
      icons: window.__topbarIcons,
      menus: window.__menuItems,
      modals: window.__modals,
      state,
      hasPausedBanner: text.includes("Paused:") && text.includes("Resume all fixes"),
      fixStyle: !!document.getElementById("perf-adviser-fixes"),
      offscreenStyle: !!document.getElementById("perf-adviser-offscreen"),
      scrollClass: !!document.querySelector(".perf-adviser-scrolling"),
    };
  });

  const label = "[" + testCase.name + "]";
  note(errors.length === 0, label + " loads without throwing", errors.join("; "));
  note(out.api === true, label + " exposes the API");
  note(out.icons && out.icons.length === 1 && out.icons[0].name === "Perf Adviser", label + " creates exactly one top-bar icon",
    out.icons ? String(out.icons.length) : "none");
  note(out.modals && out.modals.length >= 1, label + " opens the panel", out.modals ? out.modals.join(",") : "none");

  for (const [key, expected] of Object.entries(testCase.expect)) {
    note(out.state && out.state[key] === expected, label + " state." + key + " === " + String(expected),
      out.state ? String(out.state[key]) : "no state");
  }
  if (testCase.expect && !("futureOption" in testCase.expect)) {
    note(!out.state || !("futureOption" in out.state), label + " ignores unknown fields");
  }
  const effectsOff = testCase.noEffects || testCase.expect.cssOff === true;
  note(!effectsOff || !out.fixStyle, label + " injects no CSS while paused/off", String(out.fixStyle));
  note(!effectsOff || !out.offscreenStyle, label + " creates no offscreen style while paused/off", String(out.offscreenStyle));
  note(!effectsOff || !out.scrollClass, label + " leaves no scroll class while paused/off", String(out.scrollClass));
  if (testCase.pausedPanel) {
    note(out.hasPausedBanner === true, label + " shows the Paused banner with Resume");
  }
  if (testCase.noEffects) {
    note(out.state && out.state.runtimePatch === false, label + " runtime patches are off");
  }

  await page.close();
}

// Bisect must never include Perf Adviser itself, whether the name comes from a
// Marketplace title ("Performance Adviser") or a saved round.
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("perf-adviser:state", JSON.stringify({ cssOff: true }));
    const saved = {
      startedAt: new Date().toISOString(), phase: "running", status: "running",
      candidates: ["Performance Adviser", "alpha", "beta"],
      disabled: ["Performance Adviser"],
      found: [],
      rounds: [],
      noiseFloor: 3, calibration: null, baseline: null, last: null,
      pending: { toggled: ["alpha", "Performance Adviser"], action: "disable", samples: [] },
      awaiting: true, note: "",
    };
    localStorage.setItem("perf-adviser:bisect", JSON.stringify(saved));
    const noop = () => {};
    window.__topbarIcons = [];
    window.__hideCalls = 0;
    window.Spicetify = {
      Config: { extensions: ["perf-adviser.js", "alpha.js", "beta.js"] },
      Platform: {
        version: "1.3.9.2055",
        History: { listen: noop, location: { pathname: "/" } },
        ZoomAPI: { getZoomLevel: async () => 0, setZoomLevel: async () => {} },
      },
      PopupModal: {
        display: ({ content }) => { if (content) document.body.appendChild(content); },
        hide() { window.__hideCalls++; },
      },
      Topbar: { Button: function Button(n) { window.__topbarIcons.push(n); } },
      Menu: { Item: function Item(n) { this.name = n; this.register = noop; } },
      showNotification: noop,
    };
  });
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: `${origin}/perf-adviser.js` });
  await new Promise((r) => setTimeout(r, 600));
  const out = await page.evaluate(async () => {
    const api = window.__perfAdviser;
    const state = api ? api.bisect.state : null;
    await api.open(); // Perf Adviser's own panel is now the visible modal
    const modal = document.createElement("div");
    modal.id = "marketplace-reload-container";
    // With the panel open, the guard must show the note but must not close it.
    document.body.appendChild(modal);
    await new Promise((r) => setTimeout(r, 50));
    const hideWithPanelOpen = window.__hideCalls;
    const root = document.querySelector(".perf-adviser-root");
    if (root) root.remove();
    modal.remove();
    // With no panel open, Marketplace's reload modal is hidden.
    document.body.appendChild(modal);
    await new Promise((r) => setTimeout(r, 50));
    const hideCallsBeforeReset = window.__hideCalls;
    const hintWhileWaiting = !!document.getElementById("perf-adviser-bisect-reload-hint");
    // Cancelling the bisect must disconnect the observer: a later reload modal
    // is no longer this extension's business.
    api.bisect.reset();
    modal.remove();
    document.body.appendChild(modal);
    await new Promise((r) => setTimeout(r, 50));
    return {
      icons: window.__topbarIcons,
      state,
      hideWithPanelOpen,
      hideCalls: hideCallsBeforeReset,
      hideAfterReset: window.__hideCalls,
      hint: hintWhileWaiting,
      hintAfterReset: !!document.getElementById("perf-adviser-bisect-reload-hint"),
    };
  });
  note(errors.length === 0, "[bisect] loads without throwing", errors.join("; "));
  note(out.icons && out.icons.length === 1, "[bisect] still creates the icon");
  note(!!out.state, "[bisect] restores the saved round");
  if (out.state) {
    note(!out.state.candidates.some((n) => /perf(ormance)? ?adviser/i.test(n)), "[bisect] candidates exclude Perf Adviser",
      out.state.candidates.join(", "));
    note(!out.state.pending || !out.state.pending.toggled.some((n) => /perf(ormance)? ?adviser/i.test(n)),
      "[bisect] pending round excludes Perf Adviser", out.state.pending ? out.state.pending.toggled.join(", ") : "none");
    note(!out.state.disabled.some((n) => /perf(ormance)? ?adviser/i.test(n)), "[bisect] disabled list excludes Perf Adviser");
  }
  note(out.hideWithPanelOpen === 0, "[bisect] never closes Perf Adviser's own panel", String(out.hideWithPanelOpen));
  note(out.hideCalls >= 1, "[bisect] hides Marketplace's reload prompt", String(out.hideCalls));
  note(out.hideAfterReset === out.hideCalls, "[bisect] stops hiding after the round is cancelled",
    String(out.hideAfterReset) + " vs " + String(out.hideCalls));
  note(out.hint === true, "[bisect] shows its own reload note");
  note(out.hintAfterReset === false, "[bisect] removes its note when the round is cancelled");
  await page.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error("\n" + failures.length + " failure(s):");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\nAll paused-state and bisect checks passed.");
