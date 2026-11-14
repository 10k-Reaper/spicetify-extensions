// perf-adviser.js - in-app performance adviser for this Spotify + Spicetify setup.
//
// What it does
//   - injects two measured, individually switchable fixes (the recommended set):
//       1. removes the sticky-header backdrop blur (opaque theme background)
//       2. hides the Home card play button only while scrolling (its tooltip
//          is repositioned on every scroll frame)
//   - one opt-in override for a rotating .cover-art animation. The rotation is
//     normally added by a snippet/theme the user installed, so the panel first
//     names that source and suggests disabling it; pausing it here is only a
//     fallback for people who want to keep the effect.
//   - one optional cosmetic bundle (marketplace card border, active-button
//     colour, 72 px player bar) - not a performance fix, off by default
//   - runtime CSS patches: Chromium treats every live :has() rule as a
//     document-wide invalidation source, so a hover can restyle more of the
//     page than the control under the cursor. The patch engine mirrors the two
//     global :has() anchors installed by track-peek and parks :has() rules that
//     currently match nothing, restoring each one as soon as its target appears.
//     It narrows that work but cannot remove Spotify's own card re-render.
//   - scans the live environment generically: installed Marketplace
//     extensions/snippets/theme, every CSS source (rule counts, :has(), blur,
//     infinite animations), running animations and their source, header blur,
//     page zoom and CSS-editor leftovers. No name has to be on a list.
//   - runs the same scroll FPS test used by the offline harness, inside Spotify
//   - includes the profiler that used to live in spx-perf.js: start recording,
//     scroll, stop, and see cost attributed by extension/script; the biggest
//     non-Spotify sources then become findings automatically
//
// What it never does
//   - it does not disable, uninstall or update any extension/snippet/theme
//   - it makes no network requests
//   - it does not touch Spotify's own files
//   - it does not poll on a timer; the patch engine wakes on DOM mutations and
//     only re-checks rules whose precondition was touched. The one timed retry is
//     a short re-park loop that runs only while a revived rule is still live
//
// Kill switch: "Disable all fixes" in the panel (or "Remove applied fixes")
// stops every injected rule. Fix state is stored in
// localStorage["perf-adviser:state"].
//
// Uninstall:
//   spicetify config extensions perf-adviser.js-
//   spicetify apply -n
// (or delete %APPDATA%\spicetify\Extensions\perf-adviser.js and remove it from
//  the `extensions` line in config)
(function PerfAdviser() {
  "use strict";
  if (window.__perfAdviser) return;

  const VERSION = "1.0.1";
  const STATE_KEY = "perf-adviser:state";
  const FIX_ID = "perf-adviser-fixes";
  const SCROLL_CLASS = "perf-adviser-scrolling";
  const PANEL_ID = "perf-adviser-panel-style";
  const PANEL_MODAL = "perf-adviser-modal";

  // The panel uses Spotify's PopupModal, whose surface is translucent
  // (rgba(...,.7) plus a backdrop blur in Lucid). While our panel is open we
  // give both modal layers an opaque version of that same theme colour, so text
  // stays readable over any page behind it. Scoped to our own modal only.
  const PANEL_CSS = `
.${PANEL_MODAL} {
  background-color: var(--perf-adviser-surface, #121212) !important;
  backdrop-filter: none !important;
}
`;

  // ---------------------------------------------------------------- CSS blocks
  // Each fix is a separate block so it can be measured and disabled on its own.
  // Every rule is scoped to Spotify's own class names and is reversible.

  // 1. Sticky header surfaces: drop the per-frame backdrop blur and use an opaque,
  //    theme-coloured background so scrolling content does not show through.
  //    Measured +5.8 fps on Home on top of the card fix;
  //    on its own the gain is within noise (+1.5 fps).
  const HEADER_CSS = [
    "/* Perf Adviser fix 1: remove the sticky-header backdrop blur. */",
    ":root { --header-filters: none !important; }",
    ".main-topBar-background:not(#a):not(#b),",
    ".search-searchCategory-SearchCategory:not(#a):not(#b),",
    ".main-home-filterChipsSection:not(#a):not(#b),",
    ".main-trackList-trackListHeader:not(#a):not(#b),",
    ".main-trackList-trackListHeaderStuck:not(#a):not(#b) {",
    "  background-color: var(--clr-surface-1, var(--background-base, #121212)) !important;",
    "}",
  ].join("\n");

  const HEADER_SELECTORS = [
    ".main-topBar-background",
    ".search-searchCategory-SearchCategory",
    ".main-home-filterChipsSection",
    ".main-trackList-trackListHeader",
    ".main-trackList-trackListHeaderStuck",
  ];

  // 2. Spotify mounts a tippy tooltip on the card's hover play button and
  //    repositions it on every scroll event. Hiding the button only while
  //    scrolling keeps it usable at rest and scoped to Home (Marketplace
  //    install/uninstall buttons use the same class and must not be touched).
  //    Measured +38.5 fps median (3 paired 8 s runs, pointer on a card
  //    play button so its tooltip is mounted).
  const CARDPLAY_CSS = [
    "/* Perf Adviser fix 2: hide the Home card play button only while scrolling. */",
    "html." + SCROLL_CLASS + " [data-testid=\"home-page\"] .main-card-PlayButtonContainer { display: none !important; }",
  ].join("\n");

  // 3. OPT-IN override. Many themes/snippets put a slow full rotation on
  //    .cover-art. That element also carries clip-path and border-radius, so
  //    Chromium cannot composite the transform and runs it on the main thread
  //    every frame. The rotation is decorative; removing the snippet/theme that
  //    adds it is the clean fix, so this only runs when the user turns it on.
  //    Pausing it keeps the circular crop; measured +37.1 fps median on
  //    Home (3 paired 8 s runs) when the rotation was active.
  const COVER_CSS = [
    "/* Perf Adviser fix 3: pause the decorative rotating cover art. */",
    ".cover-art,",
    ".main-nowPlayingView-coverArtContainer::before,",
    ".main-nowPlayingView-coverArtContainer::after {",
    "  animation-play-state: paused !important;",
    "}",
  ].join("\n");

  // Cosmetic bundle that used to live in the CSS editor. Theme-specific, not a
  // measured performance win, so it is off by default and never part of the
  // recommended preset.
  const THEME_CSS = [
    "/* Perf Adviser optional theme tweaks (cosmetic, not a performance fix). */",
    ".marketplace-card--installed {",
    "  flex: 0 !important;",
    "  -webkit-box-flex: 0 !important;",
    "  border: 2px solid #814fff;",
    "}",
    ":root { --spice-button-active: #7b3bff; }",
    ".main-nowPlayingBar-nowPlayingBar:not(#a):not(#b) { height: 72px !important; }",
  ].join("\n");

  // ---------------------------------------------------------------- state
  // Recommended set: the two fixes that measured a clear win on their own.
  // coverPause is opt-in because the rotation almost always comes from a
  // snippet/theme the user installed - naming and removing the source is the
  // honest fix, and the toggle exists for people who want to keep the look.
  // themeTweaks is cosmetic and stays off unless the user turns it on.
  const DEFAULTS = {
    headerFix: true,
    cardPlayFix: true,
    coverPause: false,
    themeTweaks: false,
    runtimePatch: true,
    cssOff: false,
    lagRecorder: false,
    navTiming: false,
    authorMode: false,
  };
  function loadState() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {}; } catch (e) { stored = {}; }
    const s = {};
    for (const k of Object.keys(DEFAULTS)) s[k] = k in stored ? !!stored[k] : DEFAULTS[k];
    return s;
  }
  function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  const state = loadState();

  // ---------------------------------------------------- author mode (opt-in)
  // A registration inventory for extension authors: it records who registered
  // an interval, a MutationObserver (target + options) and listeners for hot
  // events, with stack attribution at registration time. Nothing is timed while
  // idle. During an author check the same wrappers time those callbacks, which
  // is the only way to time handlers an extension registered at startup (the
  // profiler can only time registrations made after it starts).
  // It is installed at load, so it can only see extensions loaded after this
  // one - Perf Adviser must be first in the extensions list. Off by default.
  const author = (() => {
    const enabled = !!state.authorMode;
    const HOT = new Set(["scroll", "wheel", "mousewheel", "mousemove", "mouseover", "pointermove", "pointerover", "touchmove", "touchstart", "resize"]);
    const INFRA = new Set(["perf-adviser.js", "spicetifyWrapper.js"]);
    const CORE_RE = /^(vendor[~-])?xpui[\w.~-]*\.js$/i;
    const URL_RE = /((?:https?|file|spotify):\/\/[^\s)]+?|blob:[^\s)]+?):\d+:\d+/;
    const MAX_DETAILS = 80;
    const map = new Map();
    const timed = new Map();
    let registrations = 0;
    let loadMs = 0;
    let collecting = false;

    function noteTime(src, kind, ms) {
      let t = timed.get(src);
      if (!t) { t = { ms: 0, calls: 0, kinds: {} }; timed.set(src, t); }
      t.ms += ms; t.calls++;
      const k = t.kinds[kind] || (t.kinds[kind] = { calls: 0, ms: 0 });
      k.calls++; k.ms += ms;
    }
    // The check that runs the wrapper only reads a boolean when idle; timing
    // starts when an author check asks for it.
    function wrapTimed(fn, src, kind) {
      return function pa_author_cb() {
        if (!collecting) return fn.apply(this, arguments);
        const t = performance.now();
        try { return fn.apply(this, arguments); }
        finally { noteTime(src, kind, performance.now() - t); }
      };
    }

    const base = (u) => {
      const p = String(u).split("?")[0].split("#")[0].split("/");
      return p[p.length - 1] || String(u);
    };
    function sourceOf() {
      let stack = "";
      try { stack = new Error().stack || ""; } catch (e) { return "(unknown)"; }
      for (const line of stack.split("\n").slice(1)) {
        if (/perf-adviser\.js|pa_/.test(line)) continue;
        const m = URL_RE.exec(line);
        if (!m) continue;
        const label = base(m[1]);
        if (INFRA.has(label) || CORE_RE.test(label)) continue;
        return label;
      }
      return "(unknown)";
    }
    function describeTarget(t) {
      if (t === document) return "document";
      if (t === document.body) return "body";
      if (t === document.documentElement) return "documentElement";
      if (!t || t.nodeType !== 1) return String(t);
      return t.tagName.toLowerCase() + (t.id ? "#" + t.id : "");
    }
    function entry(src) {
      let e = map.get(src);
      if (!e) { e = { source: src, intervals: [], observers: [], listeners: [] }; map.set(src, e); }
      return e;
    }
    function add(src, kind, detail) {
      if (!enabled) return;
      const e = entry(src);
      if (e[kind].length < MAX_DETAILS) e[kind].push(detail);
    }

    if (enabled) {
      try {
        const origSetInterval = window.setInterval;
        window.setInterval = function pa_author_interval(fn, ms) {
          const t = performance.now();
          let src = "(unknown)";
          let args = arguments;
          try {
            src = sourceOf();
            add(src, "intervals", { at: Date.now(), ms: +ms || 0 });
            if (typeof fn === "function") {
              args = Array.prototype.slice.call(arguments);
              args[0] = wrapTimed(fn, src, "interval");
            }
          } catch (e) { /* ignore */ }
          loadMs += performance.now() - t;
          registrations++;
          return origSetInterval.apply(window, args);
        };
      } catch (e) { /* ignore */ }

      try {
        const NativeMO = window.MutationObserver;
        class AuthorMO extends NativeMO {
          constructor(cb) {
            const src = sourceOf();
            super(typeof cb === "function" ? wrapTimed(cb, src, "observer") : cb);
            this.__paAuthorSrc = src;
          }
          observe(target, options) {
            const t = performance.now();
            try {
              const opts = options || {};
              add(this.__paAuthorSrc || "(unknown)", "observers", {
                at: Date.now(),
                target: describeTarget(target),
                subtree: !!opts.subtree,
                attributes: !!opts.attributes,
                childList: !!opts.childList,
                filter: Array.isArray(opts.attributeFilter) ? opts.attributeFilter.slice(0, 6) : null,
                broad: !!opts.subtree && (target === document || target === document.body || target === document.documentElement),
                attrNoFilter: !!opts.attributes && !opts.attributeFilter,
              });
            } catch (e) { /* ignore */ }
            loadMs += performance.now() - t;
            registrations++;
            return super.observe(target, options);
          }
        }
        window.MutationObserver = AuthorMO;
      } catch (e) { /* ignore */ }

      try {
        const origAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function pa_author_add(type, listener, options) {
          if (HOT.has(type) && (typeof listener === "function" || (listener && typeof listener === "object"))) {
            const t = performance.now();
            let src = "(unknown)";
            let wrapped = listener;
            try {
              src = sourceOf();
              add(src, "listeners", { at: Date.now(), type, target: describeTarget(this), capture: !!(options && (options === true || options.capture)) });
              if (typeof listener === "function") wrapped = wrapTimed(listener, src, "listener:" + type);
            } catch (e) { /* ignore */ }
            loadMs += performance.now() - t;
            registrations++;
            return origAdd.call(this, type, wrapped, options);
          }
          return origAdd.call(this, type, listener, options);
        };
      } catch (e) { /* ignore */ }
    }

    return {
      enabled,
      get collecting() { return collecting; },
      setCollecting(v) { collecting = !!v; if (!collecting) { /* keep the last run's numbers */ } },
      resetTimings() { timed.clear(); },
      timings: (src) => timed.get(src) || null,
      inventory: () => [...map.values()],
      describe: describeTarget,
      get stats() { return { registrations, loadMs: +loadMs.toFixed(2) }; },
    };
  })();

  function activeBlocks() {
    if (state.cssOff) return [];
    const blocks = [];
    if (state.headerFix) blocks.push(HEADER_CSS);
    if (state.cardPlayFix) blocks.push(CARDPLAY_CSS);
    if (state.coverPause) blocks.push(COVER_CSS);
    if (state.themeTweaks) blocks.push(THEME_CSS);
    return blocks;
  }

  function applyInjectedFixes() {
    const blocks = activeBlocks();
    let el = document.getElementById(FIX_ID);
    if (!blocks.length) {
      if (el) el.remove();
      document.documentElement.classList.remove(SCROLL_CLASS);
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = FIX_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = blocks.join("\n");
    if (state.cssOff || !state.cardPlayFix) document.documentElement.classList.remove(SCROLL_CLASS);
  }
  function clearInjectedFixes() {
    const el = document.getElementById(FIX_ID);
    if (el) el.remove();
    document.documentElement.classList.remove(SCROLL_CLASS);
  }
  applyInjectedFixes();

  // ------------------------------------------------------- panel surface
  // Spotify's PopupModal surface is translucent (rgba(...,.7) + a 32 px blur in
  // Lucid). Reuse its own colour at full alpha so the panel matches the theme
  // but stays readable over whatever page is behind it. Scoped to our modal.
  function ensurePanelStyle() {
    if (document.getElementById(PANEL_ID)) return;
    const el = document.createElement("style");
    el.id = PANEL_ID;
    el.textContent = PANEL_CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  // Opaque version of whatever surface colour the theme gives this modal.
  function surfaceColor(modal) {
    const cs = getComputedStyle(modal);
    const trip = (cs.getPropertyValue("--clr-surface-rgb") || "").trim();
    if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(trip)) return "rgb(" + trip + ")";
    const parse = (v) => {
      const m = /rgba?\(([^)]+)\)/.exec(v || "");
      if (!m) return null;
      const p = m[1].split(",").map((x) => parseFloat(x));
      if (p.length < 3 || (p.length > 3 && p[3] < 0.01)) return null;
      return "rgb(" + Math.round(p[0]) + "," + Math.round(p[1]) + "," + Math.round(p[2]) + ")";
    };
    return parse(cs.backgroundColor) ||
      parse(cs.getPropertyValue("--spice-main")) ||
      parse(cs.getPropertyValue("--spice-card")) ||
      "#121212";
  }

  function skinModal(attempt) {
    const nodes = document.querySelectorAll(".GenericModal.spicetify-popup");
    const modal = nodes[nodes.length - 1];
    // PopupModal may mount a tick after display() returns; wait for our content.
    if (!modal || !(modal.textContent || "").includes("Runtime CSS patches")) {
      if ((attempt || 0) < 10) setTimeout(() => skinModal((attempt || 0) + 1), 60);
      return;
    }
    ensurePanelStyle();
    for (const el of document.querySelectorAll("." + PANEL_MODAL)) el.classList.remove(PANEL_MODAL);
    const color = surfaceColor(modal);
    modal.style.setProperty("--perf-adviser-surface", color);
    modal.classList.add(PANEL_MODAL);
    // The theme sets its translucent surface with a higher-specificity
    // !important :has() rule, so an inline !important declaration is needed.
    modal.style.setProperty("background-color", color, "important");
    modal.style.setProperty("backdrop-filter", "none", "important");
    const inner = modal.querySelector(".spicetify-popup-container");
    if (inner) {
      inner.style.setProperty("background-color", color, "important");
      inner.style.setProperty("backdrop-filter", "none", "important");
      inner.classList.add(PANEL_MODAL);
    }
    // PopupModal can mount a tick after display(), which resets the scroll
    // container; put the saved offset back once the content is really there.
    const adviserRoot = modal.querySelector(".perf-adviser-root");
    if (adviserRoot) adviserRoot.scrollTop = panelScroll[adviserRoot.dataset.view || "report"] || 0;
  }

  // ------------------------------------------------------- runtime CSS patches
  // Chromium's :has() invalidation is document-wide: while any live :has() rule
  // exists, a hover can restyle more of the page than the hovered control. Two
  // patches:
  //
  //   1. track-peek's stylesheet starts selectors with :has(), so they can
  //      match any element in the document. Mirror those conditions with
  //      classes we keep in sync, and drop the :has() from the selector.
  //   2. Every other :has() rule that currently matches nothing is parked
  //      (selector replaced with an inert one). It is restored as soon as
  //      something it targets appears. Rules that are in use are never touched.
  //
  // Measured on the installed build (3 rounds, pointer parked outside the
  // target): a wide card hover restyles 951 elements -> 378 with the patch; the
  // player bar 938 -> 381; a top-bar icon is 7 either way. The card still runs
  // one ~50 ms React task and a ~40 ms layout pass with the patch on. That is
  // Spotify's own re-render, not :has() and not this extension.
  const PARK_PREFIX = "perf-adviser-parked-";
  const PEEK_WRAP = "perf-adviser-peek-wrap";
  const PEEK_ANCHOR = "perf-adviser-peek-anchor";
  const PEEK_WRAP_SEL = ":has(> .track-peek)";
  const PEEK_ANCHOR_SEL = ':has(> [data-testid="player-controls"] .track-peek)';

  const runtime = {
    parked: [],          // { rule, original, sentinel }
    live: 0,
    mirrored: 0,
    precond: "",
    seq: 0,
    scans: 0,
    revives: 0,
    scanTimer: null,
    reviveTimer: null,
    deepTimer: null,
    reparkTimer: null,
    reparkTries: 0,
    pending: [],
    lastRevive: 0,
    installed: false,
    headObserver: null,
    bodyObserver: null,
  };

  function patchesActive() {
    return !!state.runtimePatch && !state.cssOff;
  }

  // Split a selector list on commas that are not inside (), [] or quotes.
  function splitTopLevel(text) {
    const out = [];
    let depth = 0, quote = null, cur = "";
    for (const ch of text) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function forEachStyleRule(cb) {
    for (const sheet of [...document.styleSheets]) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      const walk = (list) => {
        for (const rule of list) {
          if (rule.cssRules) walk(rule.cssRules);   // @media, @supports, nesting
          if (rule.selectorText) {
            try { cb(rule); } catch (e) { /* ignore one bad rule */ }
          }
        }
      };
      walk(rules);
    }
  }

  // 0 = matches nothing, >0 = in use, 1 = unknown (never park an unknown).
  function matchesAny(selector) {
    let n = 0;
    for (const part of splitTopLevel(selector)) {
      try { n += document.querySelectorAll(part).length; } catch (e) { return 1; }
      if (n > 0) return n;
    }
    return n;
  }

  function mirrorPeekRules(on) {
    let n = 0;
    forEachStyleRule((rule) => {
      const sel = rule.selectorText;
      if (sel === PEEK_ANCHOR_SEL || (on && sel === "." + PEEK_ANCHOR)) {
        rule.selectorText = on ? "." + PEEK_ANCHOR : PEEK_ANCHOR_SEL;
        n++;
      } else if (sel === PEEK_WRAP_SEL || (on && sel === "." + PEEK_WRAP)) {
        rule.selectorText = on ? "." + PEEK_WRAP : PEEK_WRAP_SEL;
        n++;
      }
    });
    return n;
  }

  // Keep the mirror classes equal to what the original :has() rules would match.
  // Every add/remove is guarded: a no-op classList call still queues an attribute
  // record in Chromium, and this function runs from the body observer's callback.
  // Unguarded writes made the observer re-trigger itself while a .track-peek
  // existed, starving timers and rendering (see tests/peek-loop.mjs).
  function updatePeekMirrors(on) {
    if (!on) {
      for (const el of document.querySelectorAll("." + PEEK_WRAP)) {
        if (el.classList.contains(PEEK_WRAP)) el.classList.remove(PEEK_WRAP);
      }
      for (const el of document.querySelectorAll("." + PEEK_ANCHOR)) {
        if (el.classList.contains(PEEK_ANCHOR)) el.classList.remove(PEEK_ANCHOR);
      }
      return;
    }
    for (const peek of document.querySelectorAll(".track-peek")) {
      const wrap = peek.parentElement;
      if (wrap && !wrap.classList.contains(PEEK_WRAP)) wrap.classList.add(PEEK_WRAP);
      const controls = peek.closest('[data-testid="player-controls"]');
      const anchor = controls && controls.parentElement;
      if (anchor && !anchor.classList.contains(PEEK_ANCHOR)) anchor.classList.add(PEEK_ANCHOR);
    }
    for (const el of document.querySelectorAll("." + PEEK_WRAP)) {
      if (el.classList.contains(PEEK_WRAP) && !el.querySelector(":scope > .track-peek")) el.classList.remove(PEEK_WRAP);
    }
    for (const el of document.querySelectorAll("." + PEEK_ANCHOR)) {
      if (el.classList.contains(PEEK_ANCHOR) && !el.querySelector(':scope > [data-testid="player-controls"] .track-peek')) el.classList.remove(PEEK_ANCHOR);
    }
  }

  // Last compound of a relative selector: the part that appears or disappears.
  // Used only as a cheap mutation filter, never as the real match test.
  function lastCompound(rel) {
    let depth = 0, quote = null, cur = "", last = "";
    for (const ch of rel) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      const combinator = depth === 0 && (ch === " " || ch === ">" || ch === "+" || ch === "~" || ch === "\n" || ch === "\t");
      if (combinator) { if (cur.trim()) { last = cur.trim(); cur = ""; } continue; }
      cur += ch;
    }
    if (cur.trim()) last = cur.trim();
    return last;
  }

  function preconditionsFor(selector) {
    const out = [];
    let i = 0;
    while ((i = selector.indexOf(":has(", i)) >= 0) {
      let depth = 0, quote = null, j = i + 5;
      for (; j < selector.length; j++) {
        const ch = selector[j];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") { if (depth === 0) break; depth--; }
      }
      const inner = selector.slice(i + 5, j);
      for (const rel of splitTopLevel(inner)) {
        const c = lastCompound(rel);
        if (c && c !== "*" && !c.includes(":has(")) out.push(c);
      }
      i = j + 1;
    }
    return out;
  }

  function rebuildPreconditions() {
    const set = new Set([".track-peek"]);
    for (const p of runtime.parked) {
      const list = preconditionsFor(p.original);
      p.precond = list.join(",");
      for (const c of list) set.add(c);
    }
    runtime.precond = [...set].join(",");
  }

  // Does any mutation in this batch touch a node that could satisfy `selector`?
  // Used to skip the full match test for rules whose precondition is unrelated.
  function nodesTouch(records, selector) {
    if (!selector) return true;
    for (const rec of records) {
      if (rec.type === "attributes") {
        if (safeMatches(rec.target, selector)) return true;
        continue;
      }
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (safeMatches(node, selector) || safeQuery(node, selector)) return true;
      }
    }
    return false;
  }

  function reviveMatching(records) {
    runtime.lastRevive = performance.now();
    let changed = false;
    const filter = records && records.length ? records : null;
    for (const p of runtime.parked) {
      if (!p.rule || !p.rule.parentStyleSheet) continue;
      if (p.rule.selectorText !== p.sentinel) continue;
      if (filter && p.precond && !nodesTouch(filter, p.precond)) continue;
      if (matchesAny(p.original) > 0) {
        try { p.rule.selectorText = p.original; changed = true; } catch (e) { /* ignore */ }
      }
    }
    if (changed) {
      runtime.reparkTries = 0;
      runtime.revives++;
      rebuildPreconditions();
      // The target is visible now; check again later so a rule can be parked
      // again after its dialog/menu closes.
      scheduleScan(1500);
      if (!runtime.deepTimer) {
        runtime.deepTimer = setTimeout(() => {
          runtime.deepTimer = null;
          fullScan();
        }, 6000);
      }
    }
  }

  function scheduleRevive(ms, records) {
    if (records) {
      for (const r of records) {
        runtime.pending.push(r);
        if (runtime.pending.length > 400) runtime.pending.shift();
      }
    }
    if (runtime.reviveTimer) return;
    const wait = Math.max(ms, 800 - (performance.now() - runtime.lastRevive));
    runtime.reviveTimer = setTimeout(() => {
      runtime.reviveTimer = null;
      if (!patchesActive()) { runtime.pending = []; return; }
      const recs = runtime.pending;
      runtime.pending = [];
      updatePeekMirrors(true);
      reviveMatching(recs);
    }, Math.max(0, wait));
  }

  function safeMatches(el, selector) {
    if (!selector) return false;
    try { return el.matches(selector); } catch (e) { return true; }
  }

  function safeQuery(el, selector) {
    if (!selector) return false;
    try { return !!el.querySelector(selector); } catch (e) { return true; }
  }

  // Parked rules that are currently restored because their target appeared.
  function liveParkedCount() {
    let n = 0;
    for (const p of runtime.parked) {
      try { if (p.rule && p.rule.parentStyleSheet && p.rule.selectorText === p.original) n++; } catch (e) { /* ignore */ }
    }
    return n;
  }

  // Does this batch touch a .track-peek node (or a subtree containing one)?
  // Replaces a full-document query on every observer batch. Mirror classes are
  // written to .track-peek's ancestors, so an ancestor batch still reports true;
  // the guarded writes in updatePeekMirrors make that a single no-op callback
  // instead of another round.
  function recordsTouchPeek(records) {
    const hasPeek = (node) => {
      if (!node || node.nodeType !== 1) return false;
      if (node.classList && node.classList.contains("track-peek")) return true;
      try { return !!node.querySelector(".track-peek"); } catch (e) { return false; }
    };
    for (const rec of records) {
      if (rec.type === "attributes") {
        if (hasPeek(rec.target)) return true;
        continue;
      }
      for (const node of rec.addedNodes) if (hasPeek(node)) return true;
      for (const node of rec.removedNodes) if (hasPeek(node)) return true;
    }
    return false;
  }

  function onPatchMutations(records) {
    const pre = runtime.precond;
    let flip = false;
    for (const rec of records) {
      if (rec.type === "attributes") {
        if (rec.attributeName === "style") continue;
        if (safeMatches(rec.target, pre)) { flip = true; break; }
      } else {
        for (const node of rec.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (safeMatches(node, pre) || (node.firstElementChild && safeQuery(node, pre))) { flip = true; break; }
        }
      }
      if (flip) break;
    }
    const peekTouched = recordsTouchPeek(records);
    // A new track-peek must get its mirror class before the next frame, not
    // after the revive timer, or the pill renders unstyled for a moment.
    if (peekTouched) updatePeekMirrors(true);
    if (flip || peekTouched) scheduleRevive(150, records);
    // Keep trying to park revived rules again (dialog/menu closed) without
    // waiting for a mutation-free window that this app never has.
    if (liveParkedCount() > 0) scheduleRepark(1200);
  }

  function scheduleScan(ms) {
    if (runtime.scanTimer) clearTimeout(runtime.scanTimer);
    runtime.scanTimer = setTimeout(() => {
      runtime.scanTimer = null;
      fullScan();
    }, ms);
  }

  // Retry parking on a fixed cadence. Spotify mutates the DOM every second or
  // so, so a debounced scan would never run; this one is not reset by mutations
  // and keeps retrying until nothing revived is left live.
  function scheduleRepark(ms) {
    if (runtime.reparkTimer) return;
    if (runtime.reparkTries >= 6) return;
    runtime.reparkTimer = setTimeout(() => {
      runtime.reparkTimer = null;
      if (!patchesActive()) return;
      runtime.reparkTries++;
      fullScan();
      if (liveParkedCount() > 0) scheduleRepark(1500);
      else runtime.reparkTries = 0;
    }, ms);
  }

  function fullScan() {
    if (!patchesActive()) return;
    runtime.scans++;
    mirrorPeekRules(true);
    updatePeekMirrors(true);

    runtime.parked = runtime.parked.filter((p) => p.rule && p.rule.parentStyleSheet);

    // Re-check rules we already know about: park them again when their target
    // goes away, restore them when it comes back.
    for (const p of runtime.parked) {
      let sel = "";
      try { sel = p.rule.selectorText; } catch (e) { continue; }
      if (sel === p.sentinel) {
        if (matchesAny(p.original) > 0) {
          try { p.rule.selectorText = p.original; } catch (e) { /* ignore */ }
        }
      } else if (sel === p.original) {
        if (matchesAny(p.original) === 0) {
          try { p.rule.selectorText = p.sentinel; } catch (e) { /* ignore */ }
        }
      }
    }

    const tracked = new Set(runtime.parked.map((p) => p.rule));
    let live = 0;
    forEachStyleRule((rule) => {
      const sel = rule.selectorText;
      if (!sel.includes(":has(")) return;
      if (tracked.has(rule)) return;
      if (sel === "." + PEEK_ANCHOR || sel === "." + PEEK_WRAP) return;
      if (sel.startsWith(PARK_PREFIX)) return;
      if (matchesAny(sel) > 0) { live++; return; }
      const original = sel;
      const sentinel = PARK_PREFIX + (++runtime.seq);
      try { rule.selectorText = sentinel; } catch (e) { return; }
      runtime.parked.push({ rule, original, sentinel, precond: preconditionsFor(original).join(",") });
    });

    runtime.live = live + runtime.parked.filter((p) => {
      try { return p.rule.selectorText === p.original; } catch (e) { return false; }
    }).length;
    runtime.mirrored = document.querySelectorAll("." + PEEK_ANCHOR + ", ." + PEEK_WRAP).length;
    rebuildPreconditions();
  }

  function installPatchObservers() {
    if (runtime.installed) return;
    runtime.installed = true;
    try {
      runtime.headObserver = new MutationObserver(() => scheduleScan(500));
      runtime.headObserver.observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* ignore */ }
    try {
      runtime.bodyObserver = new MutationObserver(onPatchMutations);
      runtime.bodyObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
    } catch (e) { /* ignore */ }
    try {
      document.addEventListener("focusin", () => scheduleRevive(200), true);
      window.addEventListener("popstate", () => scheduleScan(600));
    } catch (e) { /* ignore */ }
    try {
      if (Spicetify.Platform && Spicetify.Platform.History && Spicetify.Platform.History.listen) {
        Spicetify.Platform.History.listen(() => scheduleScan(700));
      }
    } catch (e) { /* ignore */ }
  }

  function syncRuntimePatches() {
    if (!patchesActive()) {
      if (runtime.reparkTimer) { clearTimeout(runtime.reparkTimer); runtime.reparkTimer = null; }
      for (const p of runtime.parked) {
        try { p.rule.selectorText = p.original; } catch (e) { /* ignore */ }
      }
      runtime.parked = [];
      runtime.live = 0;
      runtime.mirrored = 0;
      mirrorPeekRules(false);
      updatePeekMirrors(false);
      rebuildPreconditions();
      return;
    }
    installPatchObservers();
    fullScan();
  }
  syncRuntimePatches();
  // Stylesheets are injected by Marketplace after this file runs; a couple of
  // delayed scans pick them up without polling.
  setTimeout(() => scheduleScan(0), 1500);
  setTimeout(() => scheduleScan(0), 5000);

  // Scroll-scoped card play button: one class toggle at the start and end of a
  // scroll, instead of the tooltip's ~1500 inline-style writes per 4 s.
  let scrollTimer = null;
  function onScrollSignal() {
    if (!state.cardPlayFix || state.cssOff) return;
    const root = document.documentElement;
    if (!root.classList.contains(SCROLL_CLASS)) root.classList.add(SCROLL_CLASS);
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => root.classList.remove(SCROLL_CLASS), 180);
  }
  try {
    document.addEventListener("scroll", onScrollSignal, { capture: true, passive: true });
    document.addEventListener("wheel", onScrollSignal, { capture: true, passive: true });
    document.addEventListener("touchmove", onScrollSignal, { capture: true, passive: true });
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------- helpers
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const median = (vals) => {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const route = () => {
    try { return Spicetify.Platform.History.location.pathname || "/"; } catch (e) { return location.hash || "/"; }
  };
  function notify(msg, isError) {
    try { Spicetify.showNotification(msg, !!isError, 4000); } catch (e) { /* ignore */ }
  }
  function h(tag, css, text) {
    const node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text != null) node.textContent = text;
    return node;
  }
  const C = {
    text: "var(--spice-text, #fff)",
    sub: "var(--spice-subtext, #b3b3b3)",
    card: "var(--spice-card, rgba(255,255,255,.07))",
    green: "#1ed760",
    amber: "#ffa42b",
    red: "#f15e6c",
    blue: "#4cb3d4",
  };
  const SEV = { high: C.red, medium: C.amber, low: C.blue, ok: C.green, info: C.blue };

  // ZoomAPI levels are percentages: 0 = 100%, -50 = 91.287%, 50 = 109.5%.
  function zoomPct(level) {
    if (level == null) return "unknown";
    return Math.round(Math.pow(1.2, level / 100) * 100) + "% (level " + level + ")";
  }

  // ---------------------------------------------------------------- profiler
  // Compact port of spx-perf.js (that extension is no longer installed). All
  // wrappers are installed only while a recording runs, so profiling costs
  // nothing when you are not using it.
  const prof = (() => {
    const CORE = "spotify-core";
    const UNKNOWN = "(unknown)";
    const ANON = "(anonymous/eval)";
    const CORE_RE = /^(vendor[~-])?xpui[\w.~-]*\.js$/i;
    const INFRA = new Set(["spicetifyWrapper.js", "perf-adviser.js"]);
    const HOT = new Set(["scroll", "wheel", "mousewheel", "mousemove", "mouseover", "pointermove", "pointerover", "touchmove", "touchstart", "resize"]);
    const FORCED_MS = 2;

    const orig = {
      setTimeout: window.setTimeout,
      clearTimeout: window.clearTimeout,
      setInterval: window.setInterval,
      raf: window.requestAnimationFrame,
      MO: window.MutationObserver,
      add: EventTarget.prototype.addEventListener,
      remove: EventTarget.prototype.removeEventListener,
    };
    const later = (fn, ms) => orig.setTimeout.call(window, fn, ms);

    let recording = false;
    let startedAt = 0;
    let activeSource = null;
    let stats = new Map();
    let inventory = new Map();
    let frameDeltas = [];
    let lastFrame = 0;
    let longTasks = { count: 0, totalMs: 0, maxMs: 0 };
    let loaf = { supported: false, frames: 0, blockingMs: 0, scripts: new Map() };
    let lastReport = null;
    let undo = [];
    let perfObservers = [];

    function stat(src) {
      let s = stats.get(src);
      if (!s) {
        s = { source: src, total: 0, count: 0, max: 0, kinds: {}, forcedMs: 0, forcedCount: 0, forcedProps: {} };
        stats.set(src, s);
      }
      return s;
    }
    function rec(src, kind, ms) {
      const s = stat(src);
      s.total += ms; s.count++; if (ms > s.max) s.max = ms;
      const k = s.kinds[kind] || (s.kinds[kind] = { count: 0, ms: 0 });
      k.count++; k.ms += ms;
    }
    function inv(src, kind) {
      let i = inventory.get(src);
      if (!i) { i = { source: src, interval: 0, observer: 0, broadObserver: 0, listener: 0 }; inventory.set(src, i); }
      i[kind]++;
    }

    const baseName = (u) => {
      u = String(u).split("?")[0].split("#")[0];
      const p = u.split("/");
      return p[p.length - 1] || u;
    };
    const URL_RE = /((?:https?|file|spotify):\/\/[^\s)]+?|blob:[^\s)]+?):\d+:\d+/;
    function frameLabel(line) {
      const m = URL_RE.exec(line);
      if (/\beval at\b/.test(line)) return "eval:" + (m ? baseName(m[1]) : "?");
      if (m) return baseName(m[1]);
      if (/<anonymous>:\d+:\d+/.test(line)) return ANON;
      return null;
    }
    // First frame that is not Spotify core, not Spicetify's wrapper, not us.
    function attribute() {
      let stack = "";
      try { stack = new Error().stack || ""; } catch (e) { return UNKNOWN; }
      const lines = stack.split("\n").slice(1);
      let sawCore = false, sawAnon = false;
      for (const line of lines) {
        if (/perf-adviser\.js|pa_/.test(line)) continue;
        const l = frameLabel(line);
        if (!l) continue;
        if (INFRA.has(l)) continue;
        if (l === ANON) { sawAnon = true; continue; }
        if (CORE_RE.test(l)) { sawCore = true; continue; }
        return l;
      }
      if (sawAnon) return ANON;
      return sawCore ? CORE : UNKNOWN;
    }

    function wrapCb(fn, src, kind) {
      return function pa_cb() {
        if (!recording) return fn.apply(this, arguments);
        const prev = activeSource;
        activeSource = src;
        const t = performance.now();
        try { return fn.apply(this, arguments); }
        finally { activeSource = prev; rec(src, kind, performance.now() - t); }
      };
    }

    // ------------------------------------------------------------ forced reads
    function noteForced(prop, ms) {
      const src = attribute();
      const s = stat(src);
      s.forcedMs += ms; s.forcedCount++; if (ms > s.forcedMax || !s.forcedMax) s.forcedMax = ms;
      s.forcedProps[prop] = (s.forcedProps[prop] || 0) + 1;
    }
    function installProbes() {
      const getters = [
        [Element.prototype, ["scrollTop", "scrollLeft", "scrollHeight", "scrollWidth", "clientHeight", "clientWidth"]],
        [HTMLElement.prototype, ["offsetHeight", "offsetWidth", "offsetTop", "offsetLeft"]],
      ];
      for (const [proto, names] of getters) {
        for (const name of names) {
          try {
            const desc = Object.getOwnPropertyDescriptor(proto, name);
            if (!desc || !desc.get) continue;
            const g = desc.get;
            Object.defineProperty(proto, name, {
              configurable: true, enumerable: desc.enumerable, set: desc.set,
              get: function pa_get() {
                const t = performance.now();
                const v = g.call(this);
                const d = performance.now() - t;
                if (d > FORCED_MS) noteForced(name, d);
                return v;
              },
            });
            undo.push(() => Object.defineProperty(proto, name, desc));
          } catch (e) { /* ignore */ }
        }
      }
      for (const name of ["getBoundingClientRect", "getClientRects"]) {
        try {
          const desc = Object.getOwnPropertyDescriptor(Element.prototype, name);
          if (!desc || typeof desc.value !== "function") continue;
          const f = desc.value;
          Object.defineProperty(Element.prototype, name, {
            configurable: true, enumerable: desc.enumerable, writable: true,
            value: function pa_method() {
              const t = performance.now();
              const v = f.apply(this, arguments);
              const d = performance.now() - t;
              if (d > FORCED_MS) noteForced(name, d);
              return v;
            },
          });
          undo.push(() => Object.defineProperty(Element.prototype, name, desc));
        } catch (e) { /* ignore */ }
      }
    }

    // ------------------------------------------------------------ patch/unpatch
    function patch() {
      if (!recording) return;
      // Restore whatever was in place when the recording started, not the
      // natives captured at load: Author mode may have installed wrappers that
      // must survive a recording.
      const prev = {
        setInterval: window.setInterval,
        setTimeout: window.setTimeout,
        raf: window.requestAnimationFrame,
        MO: window.MutationObserver,
        add: EventTarget.prototype.addEventListener,
      };
      window.setInterval = function pa_setInterval(fn) {
        const args = Array.prototype.slice.call(arguments);
        try {
          if (typeof fn === "function") {
            const src = activeSource || attribute();
            inv(src, "interval");
            if (src !== CORE) args[0] = wrapCb(fn, src, "interval");
          }
        } catch (e) { /* ignore */ }
        return orig.setInterval.apply(window, args);
      };
      undo.push(() => { window.setInterval = prev.setInterval; });

      window.setTimeout = function pa_setTimeout(fn) {
        const args = Array.prototype.slice.call(arguments);
        try {
          if (typeof fn === "function") {
            const src = activeSource || attribute();
            if (src !== CORE) args[0] = wrapCb(fn, src, "timeout");
          }
        } catch (e) { /* ignore */ }
        return orig.setTimeout.apply(window, args);
      };
      undo.push(() => { window.setTimeout = prev.setTimeout; });

      window.requestAnimationFrame = function pa_raf(fn) {
        try {
          if (typeof fn === "function") {
            const src = activeSource || attribute();
            if (src !== CORE) fn = wrapCb(fn, src, "raf");
          }
        } catch (e) { /* ignore */ }
        return orig.raf.call(window, fn);
      };
      undo.push(() => { window.requestAnimationFrame = prev.raf; });

      EventTarget.prototype.addEventListener = function pa_add(type, listener, options) {
        try {
          if (typeof listener === "function" && typeof type === "string") {
            const src = activeSource || attribute();
            if (src !== CORE) {
              inv(src, "listener");
              const w = wrapCb(listener, src, "listener:" + type);
              return orig.add.call(this, type, w, options);
            }
          }
        } catch (e) { /* fall through */ }
        return orig.add.call(this, type, listener, options);
      };
      undo.push(() => { EventTarget.prototype.addEventListener = prev.add; });

      // MutationObserver: attribute callback time to whoever created the observer.
      class PaMO extends orig.MO {
        constructor(cb) {
          let src = UNKNOWN;
          try { src = activeSource || attribute(); } catch (e) { /* ignore */ }
          const wrapped = function (records, obs) {
            if (!recording || src === CORE) return cb.call(obs, records, obs);
            const prevSrc = activeSource;
            activeSource = src;
            const t = performance.now();
            try { return cb.call(obs, records, obs); }
            finally { activeSource = prevSrc; rec(src, "observer", performance.now() - t); }
          };
          super(typeof cb === "function" ? wrapped : cb);
          this.__paSrc = src;
          if (src !== CORE) inv(src, "observer");
        }
        observe(target, options) {
          try {
            if (options && options.subtree && this.__paSrc !== CORE &&
                (target === document.body || target === document || target === document.documentElement)) {
              inv(this.__paSrc, "broadObserver");
            }
          } catch (e) { /* ignore */ }
          return super.observe(target, options);
        }
      }
      window.MutationObserver = PaMO;
      undo.push(() => { window.MutationObserver = prev.MO; });
    }

    function startObservers() {
      try {
        const types = (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes) || [];
        if (types.includes("long-animation-frame")) {
          loaf.supported = true;
          const o = new PerformanceObserver((list) => {
            if (!recording) return;
            for (const e of list.getEntries()) {
              loaf.frames++;
              loaf.blockingMs += e.blockingDuration || 0;
              for (const s of e.scripts || []) {
                const label = baseName(s.sourceURL || s.invoker || "?");
                let r = loaf.scripts.get(label);
                if (!r) { r = { source: label, ms: 0, forcedMs: 0, count: 0 }; loaf.scripts.set(label, r); }
                r.ms += s.duration || 0;
                r.forcedMs += s.forcedStyleAndLayoutDuration || 0;
                r.count++;
              }
            }
          });
          o.observe({ type: "long-animation-frame" });
          perfObservers.push(o);
        }
        if (types.includes("longtask")) {
          const o = new PerformanceObserver((list) => {
            if (!recording) return;
            for (const e of list.getEntries()) {
              longTasks.count++; longTasks.totalMs += e.duration;
              if (e.duration > longTasks.maxMs) longTasks.maxMs = e.duration;
            }
          });
          o.observe({ type: "longtask" });
          perfObservers.push(o);
        }
      } catch (e) { /* unsupported */ }
    }

    function fpsTick() {
      if (!recording) return;
      const now = performance.now();
      if (lastFrame) frameDeltas.push(now - lastFrame);
      lastFrame = now;
      orig.raf.call(window, fpsTick);
    }

    function start() {
      if (recording) return;
      stats = new Map();
      inventory = new Map();
      frameDeltas = [];
      lastFrame = 0;
      longTasks = { count: 0, totalMs: 0, maxMs: 0 };
      loaf = { supported: false, frames: 0, blockingMs: 0, scripts: new Map() };
      undo = [];
      perfObservers = [];
      startedAt = performance.now();
      recording = true;
      patch();
      installProbes();
      startObservers();
      orig.raf.call(window, fpsTick);
    }

    function build() {
      const sorted = frameDeltas.slice().sort((a, b) => a - b);
      const n = sorted.length;
      const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
      const topProps = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + " x" + v).join(", ");
      return {
        version: VERSION,
        recordedMs: Math.round(performance.now() - startedAt),
        fps: n ? {
          avg: +(1000 / mean).toFixed(1),
          p95: +sorted[Math.floor(n * 0.95)].toFixed(1),
          slowPct: +(100 * sorted.filter((d) => d > 33.4).length / n).toFixed(1),
        } : null,
        longTasks: { count: longTasks.count, totalMs: Math.round(longTasks.totalMs), maxMs: Math.round(longTasks.maxMs) },
        sources: [...stats.values()]
          .sort((a, b) => (b.total + b.forcedMs) - (a.total + a.forcedMs))
          .map((s) => ({
            source: s.source,
            totalMs: +s.total.toFixed(1),
            calls: s.count,
            maxMs: +s.max.toFixed(1),
            kinds: Object.entries(s.kinds).sort((a, b) => b[1].ms - a[1].ms).slice(0, 2).map(([k, v]) => k + " " + Math.round(v.ms) + " ms (" + v.count + ")").join(", "),
            forcedMs: +s.forcedMs.toFixed(1),
            forcedCount: s.forcedCount,
            forcedBy: topProps(s.forcedProps),
            intervalCalls: (s.kinds.interval && s.kinds.interval.count) || 0,
          })),
        inventory: [...inventory.values()].sort((a, b) =>
          (b.interval + b.observer + b.listener) - (a.interval + a.observer + a.listener)),
        loaf: loaf.supported ? {
          frames: loaf.frames,
          blockingMs: Math.round(loaf.blockingMs),
          scripts: [...loaf.scripts.values()].sort((a, b) => b.ms - a.ms).slice(0, 12)
            .map((r) => ({ source: r.source, ms: Math.round(r.ms), forcedMs: Math.round(r.forcedMs), count: r.count })),
        } : null,
      };
    }

    function stop() {
      if (!recording) return lastReport;
      recording = false;
      for (const fn of undo.reverse()) { try { fn(); } catch (e) { /* ignore */ } }
      undo = [];
      for (const o of perfObservers) { try { o.disconnect(); } catch (e) { /* ignore */ } }
      perfObservers = [];
      lastReport = build();
      return lastReport;
    }

    return {
      get recording() { return recording; },
      get startedAt() { return startedAt; },
      start,
      stop,
      report: () => lastReport,
      reset: () => { lastReport = null; },
    };
  })();

  // ------------------------------------------------------- lag recorder (opt-in)
  // Records slow frames continuously while on, so a stutter can be explained
  // afterwards without having started a recording first. One PerformanceObserver,
  // no timers, no wrappers. Uses long-animation-frame when the build supports it
  // (that is the only API that says which script ran); otherwise it falls back to
  // longtask, which has duration but no script attribution.
  const lag = (() => {
    const MAX = 30;
    const types = (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes) || [];
    const supported = { loaf: types.includes("long-animation-frame"), longtask: types.includes("longtask") };
    let obs = null;
    let mode = null;
    let running = false;
    let entries = [];
    let dropped = 0;
    let lastAt = 0;

    // ---- navigation timing (shares this observer) --------------------------
    // Definition, also documented in the README and the panel: from the route
    // change, sum the blocking time of every long frame that STARTED inside the
    // next 2 s, then add the time from the route change to the END of the last
    // such frame ("settle"). costMs = settleMs + blockingMs. It is not first
    // paint and it stays near zero on a route change that never produces a long
    // frame, which is the point: it measures jank, not network time.
    const NAV_WINDOW = 2000;
    const NAV_SAMPLES = 30;
    const NAV_RECENT = 20;
    let navActive = null;
    let navRoutes = new Map();
    let navRecent = [];
    let navMarks = 0;

    const medianOf = (vals) => {
      if (!vals.length) return 0;
      const s = [...vals].sort((a, b) => a - b);
      const n = s.length;
      return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    };

    function normalizeRoute(p) {
      p = String(p || "/").split("?")[0].split("#")[0] || "/";
      const m = /^\/(playlist|album|artist|show|episode|user|concert)\/[^/]+/.exec(p);
      return m ? "/" + m[1] + "/*" : p;
    }

    function finalizeNav(force) {
      if (!navActive) return null;
      if (!force && performance.now() < navActive.start + NAV_WINDOW) return null;
      const nav = navActive;
      navActive = null;
      const blocking = nav.frames.reduce((n, f) => n + f.blocking, 0);
      const lastEnd = nav.frames.length ? Math.max(...nav.frames.map((f) => f.end)) : nav.start;
      const settle = Math.max(0, lastEnd - nav.start);
      const src = new Map();
      for (const f of nav.frames) {
        for (const s of f.scripts) {
          let r = src.get(s.file);
          if (!r) { r = { file: s.file, ms: 0, calls: 0 }; src.set(s.file, r); }
          r.ms += s.duration; r.calls++;
        }
      }
      const sample = {
        route: nav.route,
        at: nav.at,
        frames: nav.frames.length,
        blocking: +blocking.toFixed(1),
        settle: +settle.toFixed(1),
        cost: +(settle + blocking).toFixed(1),
        sources: [...src.values()].sort((a, b) => b.ms - a.ms),
      };
      let r = navRoutes.get(nav.route);
      if (!r) { r = { route: nav.route, samples: [] }; navRoutes.set(nav.route, r); }
      r.samples.push(sample);
      while (r.samples.length > NAV_SAMPLES) r.samples.shift();
      navRecent.push(sample);
      while (navRecent.length > NAV_RECENT) navRecent.shift();
      return sample;
    }

    function markNavigation(explicitRoute) {
      if (!state.navTiming) return null;
      finalizeNav(true);
      navActive = { route: normalizeRoute(explicitRoute || route()), start: performance.now(), frames: [], at: Date.now() };
      navMarks++;
      return navActive.route;
    }

    function addToNav(entry, rawStart, rawEnd) {
      if (!navActive || !state.navTiming) return;
      if (rawStart > navActive.start + NAV_WINDOW) { finalizeNav(true); return; }
      if (rawEnd < navActive.start) return;
      navActive.frames.push({ duration: entry.duration, blocking: entry.blocking, end: rawEnd, scripts: entry.scripts });
    }

    function navRows() {
      const rows = [];
      for (const v of navRoutes.values()) {
        const costs = v.samples.map((s) => s.cost);
        const blocks = v.samples.map((s) => s.blocking);
        const src = new Map();
        for (const s of v.samples) for (const x of s.sources) {
          let r = src.get(x.file);
          if (!r) { r = { file: x.file, ms: 0, calls: 0 }; src.set(x.file, r); }
          r.ms += x.ms; r.calls += x.calls;
        }
        const top = [...src.values()].sort((a, b) => b.ms - a.ms)[0];
        rows.push({
          route: v.route,
          n: v.samples.length,
          median: +medianOf(costs).toFixed(1),
          worst: +Math.max(...costs).toFixed(1),
          blocking: +medianOf(blocks).toFixed(1),
          frames: +medianOf(v.samples.map((s) => s.frames)).toFixed(1),
          top: top ? top.file + " " + top.ms.toFixed(1) + " ms" : "-",
        });
      }
      return rows.sort((a, b) => b.median - a.median);
    }

    function clearNav() {
      navRoutes = new Map();
      navRecent = [];
      navActive = null;
    }

    const base = (u) => {
      u = String(u || "").split("?")[0].split("#")[0];
      const p = u.split("/");
      return p[p.length - 1] || u || "?";
    };

    function normalize(e) {
      const scripts = (e.scripts || []).map((s) => ({
        file: base(s.sourceURL || s.invoker || "?"),
        invoker: String(s.invoker || ""),
        duration: +(s.duration || 0).toFixed(1),
        forced: +(s.forcedStyleAndLayoutDuration || 0).toFixed(1),
      }));
      return {
        at: Date.now(),
        start: +(e.startTime || 0).toFixed(1),
        duration: +(e.duration || 0).toFixed(1),
        blocking: +(e.blockingDuration || 0).toFixed(1),
        styleLayout: +(e.styleAndLayoutStart ? Math.max(0, e.startTime + e.duration - e.styleAndLayoutStart) : 0).toFixed(1),
        route: route(),
        scripts,
      };
    }

    function push(entry, raw) {
      lastAt = Date.now();
      entries.push(entry);
      while (entries.length > MAX) { entries.shift(); dropped++; }
      if (raw) addToNav(entry, raw.startTime || 0, (raw.startTime || 0) + (raw.duration || 0));
    }

    function start() {
      if (running || !window.PerformanceObserver) return;
      mode = supported.loaf ? "long-animation-frame" : supported.longtask ? "longtask" : null;
      if (!mode) return;
      try {
        obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) push(normalize(e), e);
        });
        obs.observe({ type: mode });
        running = true;
      } catch (e) {
        try { obs.disconnect(); } catch (e2) { /* ignore */ }
        obs = null;
        running = false;
      }
    }

    function stop() {
      if (obs) { try { obs.disconnect(); } catch (e) { /* ignore */ } }
      obs = null;
      running = false;
      finalizeNav(true);
    }

    // One observer serves the lag recorder and the navigation timer.
    function wanted() {
      return !!(state.lagRecorder || state.navTiming);
    }
    function sync() {
      if (wanted()) start(); else stop();
    }

    function clear() {
      entries = [];
      dropped = 0;
    }

    // Sum of script ms per file over the buffered frames, newest data included.
    function rollup() {
      const map = new Map();
      for (const e of entries) {
        for (const s of e.scripts) {
          let r = map.get(s.file);
          if (!r) { r = { file: s.file, ms: 0, forced: 0, calls: 0 }; map.set(s.file, r); }
          r.ms += s.duration; r.forced += s.forced; r.calls++;
        }
      }
      return [...map.values()].sort((a, b) => b.ms - a.ms);
    }

    return {
      supported,
      get running() { return running; },
      get mode() { return mode; },
      get entries() { return entries; },
      get dropped() { return dropped; },
      get lastAt() { return lastAt; },
      start, stop, sync, clear, rollup,
      nav: {
        get marks() { return navMarks; },
        get active() { return navActive ? { route: navActive.route, start: +navActive.start.toFixed(1), frames: navActive.frames.length } : null; },
        get recent() { return navRecent.slice(); },
        rows: navRows,
        mark: markNavigation,
        finalize: finalizeNav,
        clear: clearNav,
        normRoute: normalizeRoute,
        windowMs: NAV_WINDOW,
      },
    };
  })();
  lag.sync();

  // Route changes are the only navigation signal; no timer and no polling. The
  // listener is installed once and does nothing while navTiming is off.
  try {
    if (Spicetify.Platform && Spicetify.Platform.History && Spicetify.Platform.History.listen) {
      Spicetify.Platform.History.listen((location) => {
        if (state.navTiming) lag.nav.mark(location && location.pathname);
      });
    }
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------- environment
  function timeout(promise, ms, fallback) {
    return Promise.race([promise, sleep(ms).then(() => fallback)]);
  }

  async function readMarketplace() {
    let db = null;
    try {
      if (indexedDB.databases) {
        const dbs = await timeout(indexedDB.databases(), 1500, null);
        if (dbs && !dbs.some((d) => d.name === "spicetify-marketplace")) return null;
      }
      db = await timeout(new Promise((resolve, reject) => {
        const req = indexedDB.open("spicetify-marketplace");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("blocked"));
      }), 2500, null);
      if (!db) return null;

      const read = (key) => new Promise((resolve) => {
        try {
          const tx = db.transaction("settings", "readonly");
          const req = tx.objectStore("settings").get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
      const parseList = (row) => {
        try { return JSON.parse((row && row.value) || "[]"); } catch (e) { return []; }
      };
      const [extRow, snipRow, themeRow] = await Promise.all([
        read("marketplace:installed-extensions"),
        read("marketplace:installed-snippets"),
        read("marketplace:theme-installed"),
      ]);
      const describe = async (key) => {
        const tail = key.replace("marketplace:installed:snippet:", "").replace("marketplace:installed:", "");
        let name = tail.split("/").filter(Boolean).pop() || tail;
        try {
          const row = await read(key);
          const v = JSON.parse((row && row.value) || "{}");
          name = (v.manifest && v.manifest.name) || v.title || name;
        } catch (e) { /* keep tail */ }
        return { key: tail, name };
      };
      const extensions = await Promise.all(parseList(extRow).map(describe));
      const snippets = await Promise.all(parseList(snipRow).map(describe));
      let theme = null;
      if (themeRow && themeRow.value) {
        theme = await describe(String(themeRow.value));
      }
      return { extensions, snippets, theme };
    } catch (e) {
      return null;
    } finally {
      try { if (db) db.close(); } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------- selector health
  // The fixes target Spotify class names that can be renamed in an update. This
  // registry makes a silent breakage visible: each selector is checked on the
  // route where it should exist, and last-seen evidence is kept with the Spotify
  // version. Runs on panel open and once after a route change, never on a timer.
  const SELECTOR_STORE = "perf-adviser:selector-health";
  const TRACKLIST_ROUTES = ["/playlist/*", "/album/*", "/artist/*", "/collection/tracks"];
  const SELECTORS = [
    { id: "header-topbar", label: "Sticky header surface", sel: ".main-topBar-background", routes: ["*"] },
    { id: "header-search", label: "Search category header", sel: ".search-searchCategory-SearchCategory", routes: ["/search"] },
    { id: "header-home-chips", label: "Home filter chips", sel: ".main-home-filterChipsSection", routes: ["/"] },
    { id: "header-tracklist", label: "Tracklist header", sel: ".main-trackList-trackListHeader", routes: TRACKLIST_ROUTES },
    { id: "header-tracklist-stuck", label: "Stuck tracklist header", sel: ".main-trackList-trackListHeaderStuck", routes: TRACKLIST_ROUTES, note: "only exists after scrolling the list" },
    { id: "header-var", label: "--header-filters variable", sel: "--header-filters", kind: "cssvar", routes: ["*"], optional: true, note: "the fix sets it; empty means the theme does not expose it" },
    { id: "home-page", label: "Home page root", sel: '[data-testid="home-page"]', routes: ["/"] },
    { id: "card-play", label: "Home card play button", sel: ".main-card-PlayButtonContainer", routes: ["/"] },
    { id: "cover", label: "Rotating cover art", sel: ".cover-art", routes: ["*"] },
    { id: "now-playing-bar", label: "Now-playing bar", sel: ".main-nowPlayingBar-nowPlayingBar", routes: ["*"], optional: true },
    { id: "now-playing-cover", label: "Now-playing cover container", sel: ".main-nowPlayingView-coverArtContainer", routes: ["*"], optional: true },
    { id: "player-controls", label: "Player controls (peek anchor)", sel: '[data-testid="player-controls"]', routes: ["*"] },
    { id: "track-peek", label: "track-peek node", sel: ".track-peek", routes: ["*"], requires: "track-peek" },
    { id: "peek-wrap", label: "track-peek mirror (wrap)", sel: ".perf-adviser-peek-wrap", routes: ["*"], requires: "track-peek", enabled: () => state.runtimePatch },
    { id: "peek-anchor", label: "track-peek mirror (anchor)", sel: ".perf-adviser-peek-anchor", routes: ["*"], requires: "track-peek", enabled: () => state.runtimePatch },
  ];

  let lastMarket = null;

  function spotifyVersion() {
    let version = "";
    let source = "none";
    try {
      const v = Spicetify.Platform && Spicetify.Platform.version;
      if (v) { version = String(v); source = "Spicetify.Platform.version"; }
    } catch (e) { /* ignore */ }
    if (!version) {
      const m = /Spotify\/([\d.]+)/.exec(navigator.userAgent || "");
      if (m) { version = m[1]; source = "navigator.userAgent"; }
    }
    return { version: version || "unknown", source };
  }

  function readSelectorStore() {
    try {
      const v = JSON.parse(localStorage.getItem(SELECTOR_STORE) || "null");
      if (v && typeof v === "object") {
        if (!v.seen || typeof v.seen !== "object") v.seen = {};
        return v;
      }
    } catch (e) { /* ignore */ }
    return { spotifyVersion: null, seen: {} };
  }

  function selectorInstalled(name) {
    if (!lastMarket || !lastMarket.extensions) return true; // unknown, do not claim N/A
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return lastMarket.extensions.some((e) => re.test(String(e.key || "")) || re.test(String(e.name || "")));
  }

  function evaluateSelectorHealth(market) {
    if (market !== undefined) lastMarket = market;
    const ver = spotifyVersion();
    const routeNow = lag.nav.normRoute(route());
    const stored = readSelectorStore();
    const previous = stored.spotifyVersion || null;
    const rows = [];
    for (const def of SELECTORS) {
      const routeOk = def.routes.includes("*") || def.routes.includes(routeNow);
      const available = !def.requires || selectorInstalled(def.requires);
      const enabled = !def.enabled || def.enabled();
      let present = false;
      if (def.kind === "cssvar") {
        try { present = !!getComputedStyle(document.documentElement).getPropertyValue(def.sel).trim(); } catch (e) { present = false; }
      } else {
        try { present = !!document.querySelector(def.sel); } catch (e) { present = false; }
      }
      let status;
      if (!available) {
        status = "N/A here";
      } else if (!enabled || !routeOk) {
        status = "N/A here";
      } else if (present) {
        status = "OK";
        stored.seen[def.id] = { version: ver.version, lastSeen: new Date().toISOString(), route: routeNow };
      } else if (stored.seen[def.id] && stored.seen[def.id].version !== ver.version) {
        status = "STALE";
      } else if (def.optional) {
        status = "N/A here";
      } else {
        status = "NOT SEEN";
      }
      rows.push({ ...def, status, present, routeOk, available, enabled });
    }
    stored.spotifyVersion = ver.version;
    stored.versionSource = ver.source;
    stored.checkedAt = new Date().toISOString();
    stored.lastRoute = routeNow;
    try { localStorage.setItem(SELECTOR_STORE, JSON.stringify(stored)); } catch (e) { /* ignore */ }
    return {
      version: ver.version,
      source: ver.source,
      previous,
      migrated: !!previous && previous !== ver.version,
      route: routeNow,
      rows,
    };
  }

  // One-shot after a route change, after the new view has had time to mount.
  // This is not a polling timer: it schedules once per navigation and only when
  // a navigation happened.
  try {
    if (Spicetify.Platform && Spicetify.Platform.History && Spicetify.Platform.History.listen) {
      Spicetify.Platform.History.listen(() => {
        setTimeout(() => { try { evaluateSelectorHealth(); } catch (e) { /* ignore */ } }, 900);
      });
    }
  } catch (e) { /* ignore */ }

  function headerBlurOffenders() {
    const out = [];
    for (const sel of HEADER_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const f = getComputedStyle(el).backdropFilter;
      if (f && f !== "none") out.push({ sel, filter: f });
    }
    return out;
  }

  async function readZoom() {
    let level = null;
    try {
      level = await Spicetify.Platform.ZoomAPI.getZoomLevel();
      if (typeof level !== "number") level = null;
    } catch (e) { level = null; }
    return { dpr: window.devicePixelRatio, level };
  }

  // How much CSS is still parked in the CSS editor extension.
  function cssEditorChars() {
    let raw = null;
    try { raw = localStorage.getItem("css-editor.css"); } catch (e) { return null; }
    if (raw == null) return 0;
    try {
      const v = JSON.parse(raw);
      if (typeof v === "string") return v.length;
      if (v && typeof v.value === "string") return v.value.length;
    } catch (e) { /* not JSON */ }
    return String(raw).length;
  }

  // The rotation can be added by a snippet, the theme or an extension. The
  // animation name stays readable even when our opt-in CSS has paused it, so it
  // identifies the source, not our fix.
  function coverAnimationName() {
    const el = document.querySelector(".cover-art");
    if (!el) return "";
    const name = getComputedStyle(el).animationName;
    return name && name !== "none" && /rotat|spin/i.test(name) ? name : "";
  }

  // Marketplace packs every snippet into one <style class="marketplaceSnippets">
  // and prefixes each block with "/* Title - description */". Splitting on those
  // comments gives per-snippet CSS without relying on names or a fixed list.
  function snippetSources() {
    const out = [];
    const el = document.querySelector("style.marketplaceSnippets");
    const txt = (el && el.textContent) || "";
    if (!txt) return out;
    const marks = [...txt.matchAll(/\/\*\s*([\s\S]*?)\s*\*\//g)].filter((m) => /\s-\s/.test(m[1]));
    for (let i = 0; i < marks.length; i++) {
      const head = marks[i][1];
      const name = (head.split(" - ")[0] || head).trim();
      const start = marks[i].index + marks[i][0].length;
      const end = i + 1 < marks.length ? marks[i + 1].index : txt.length;
      out.push({ kind: "snippet", name, code: txt.slice(start, end) });
    }
    return out;
  }

  // Theme CSS is either a <style class="marketplaceCSS marketplaceUserCSS"> or a
  // <link href="user.css">. Broken rules in a stylesheet make cssRules throw, so
  // both paths are guarded.
  function themeSources() {
    const st = document.querySelector("style.marketplaceCSS.marketplaceUserCSS");
    if (st && st.textContent) return [{ kind: "theme", name: "Theme user.css", code: st.textContent }];
    const link = document.querySelector("link[href='user.css'], link.userCSS");
    if (!link) return [];
    try {
      const sheet = [...document.styleSheets].find((s) => s.ownerNode === link);
      if (sheet && sheet.cssRules) {
        return [{ kind: "theme", name: "Theme user.css", code: [...sheet.cssRules].map((r) => r.cssText).join("\n") }];
      }
    } catch (e) { /* ignore */ }
    return [{ kind: "theme", name: "Theme user.css (not readable)", code: "" }];
  }

  // Count the signals that make a block of CSS expensive to keep valid during
  // scrolling. These are counts, not measured fps: they say where to look.
  function cssStats(code) {
    const count = (re) => (String(code).match(re) || []).length;
    return {
      chars: String(code).length,
      rules: count(/\{/g),
      has: count(/:has\(/g),
      blur: count(/backdrop-filter|filter\s*:[^;}]*blur/gi),
      anim: count(/animation(-name)?\s*:/gi),
      infinite: count(/\binfinite\b/gi),
      sticky: count(/position\s*:\s*(sticky|fixed)/gi),
      important: count(/!important/g),
    };
  }

  function cssSources() {
    const srcs = [...snippetSources(), ...themeSources()];
    // Extension-injected <style> blocks (not ours, not the Marketplace's).
    for (const el of document.querySelectorAll("style")) {
      if (el.id === FIX_ID) continue;
      if (el.classList.contains("marketplaceSnippets") || el.classList.contains("marketplaceCSS")) continue;
      const code = el.textContent || "";
      if (code.length < 120) continue;
      const label = el.id ? "#" + el.id : "inline <style>";
      srcs.push({ kind: "style", name: label, code });
    }
    const out = [];
    for (const s of srcs) {
      if (!s.code) continue;
      const st = cssStats(s.code);
      st.score = st.has * 3 + st.blur * 3 + st.infinite * 2 + st.anim + Math.round(st.rules / 200);
      out.push({ kind: s.kind, name: s.name, code: s.code, ...st });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // Which source declares this animation? Exact name first, then a rotation rule
  // aimed at the cover, so a minified name still resolves to its snippet.
  function animationSource(name, sources) {
    if (name) {
      for (const s of sources) if (s.code && s.code.indexOf(name) >= 0) return s;
    }
    for (const s of sources) {
      if (s.code && /animation[^;}]*rotate|rotate[^;}]*infinite/i.test(s.code) && /cover-art|coverArt/i.test(s.code)) return s;
    }
    return null;
  }

  // Infinite animations that are actually running (or paused by our override).
  function infiniteAnimations() {
    let list = [];
    try { list = document.getAnimations ? document.getAnimations() : []; } catch (e) { list = []; }
    const out = [];
    const seen = new Set();
    for (const a of list) {
      let timing = null;
      try { timing = (a.effect && a.effect.getTiming()) || null; } catch (e) { timing = null; }
      if (!timing || timing.iterations !== Infinity) continue;
      const t = a.effect && a.effect.target;
      if (!t || t.id === FIX_ID) continue;
      let nm = a.animationName || "";
      if (!nm) { try { nm = getComputedStyle(t).animationName || ""; } catch (e) { nm = ""; } }
      const cls = (t.className && String(t.className).trim().split(/\s+/).slice(0, 2).join(".")) || t.tagName.toLowerCase();
      const key = nm + "@" + cls;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: nm || "(unnamed)", target: t.tagName.toLowerCase() + (cls ? "." + cls : ""), state: a.playState });
    }
    return out;
  }

  async function scan() {
    lag.nav.finalize(false);
    const [market, zoom] = await Promise.all([readMarketplace(), readZoom()]);
    lastMarket = market;
    const css = cssSources();
    const coverName = coverAnimationName();
    return {
      market,
      zoom,
      selectorHealth: evaluateSelectorHealth(market),
      route: route(),
      headerBlur: headerBlurOffenders(),
      headerFilterVar: getComputedStyle(document.documentElement).getPropertyValue("--header-filters").trim(),
      cssEditorChars: cssEditorChars(),
      cssActive: !state.cssOff && !!document.getElementById(FIX_ID),
      headerFix: !!state.headerFix,
      cardPlayFix: !!state.cardPlayFix,
      coverPause: !!state.coverPause,
      themeTweaks: !!state.themeTweaks,
      coverRotating: !!coverName,
      coverName,
      coverSource: coverName ? animationSource(coverName, css) : null,
      css,
      animations: infiniteAnimations(),
      cssOff: !!state.cssOff,
      runtimePatch: !!state.runtimePatch,
      runtime: {
        active: patchesActive(),
        parked: runtime.parked.length,
        live: runtime.live,
        mirrored: runtime.mirrored,
      },
      scrollClassNow: document.documentElement.classList.contains(SCROLL_CLASS),
      cardPlayPresent: !!document.querySelector(".main-card-PlayButtonContainer"),
      profRunning: prof.recording,
      profElapsed: prof.recording ? Math.round((performance.now() - prof.startedAt) / 1000) : null,
    };
  }

  // ---------------------------------------------------------------- benchmark
  function findScroller() {
    const candidates = [...document.querySelectorAll("*")].filter((el) => {
      if (el.scrollHeight <= el.clientHeight + 200) return false;
      return /auto|scroll/.test(getComputedStyle(el).overflowY);
    });
    candidates.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return candidates[0] || null;
  }

  function measureOnce(durationMs) {
    const el = findScroller();
    const longTasks = [];
    let obs = null;
    try {
      obs = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
      obs.observe({ entryTypes: ["longtask"] });
    } catch (e) { obs = null; }

    const frames = [];
    const start = performance.now();
    let last = start;
    const prevScroll = el ? el.scrollTop : 0;
    const max = el ? Math.min(el.scrollHeight - el.clientHeight, 4000) : 0;

    return new Promise((resolve) => {
      function tick(now) {
        frames.push(now - last);
        last = now;
        const t = (now - start) / durationMs;
        if (t >= 1) {
          if (obs) obs.disconnect();
          if (el) el.scrollTop = prevScroll;
          const sorted = [...frames].sort((a, b) => a - b);
          const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
          resolve({
            fps: mean > 0 ? 1000 / mean : 0,
            p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
            slowPct: 100 * frames.filter((f) => f > 33).length / frames.length,
            longTaskCount: longTasks.length,
            longestTaskMs: Math.max(0, ...longTasks),
            scrollable: !!el,
          });
          return;
        }
        if (el) el.scrollTop = (1 - Math.abs(2 * t - 1)) * max;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  async function benchmark(durationMs, runs) {
    const rows = [];
    // Unmeasured warm-up: the first scroll after a reload is always slower, and
    // it also lets lazy-loaded shelves settle.
    await measureOnce(1500);
    await sleep(400);
    for (let i = 0; i < runs; i++) {
      const r = await measureOnce(durationMs);
      if (r.fps > 0) rows.push(r);
      if (i < runs - 1) await sleep(1200);
    }
    if (!rows.length) return null;
    const med = median(rows.map((r) => r.fps));
    const mad = median(rows.map((r) => Math.abs(r.fps - med)));
    return {
      fps: +med.toFixed(1),
      mad: +mad.toFixed(2),
      samples: rows.map((r) => +r.fps.toFixed(1)),
      p95: +median(rows.map((r) => r.p95)).toFixed(1),
      slowPct: +median(rows.map((r) => r.slowPct)).toFixed(1),
      longTaskCount: median(rows.map((r) => r.longTaskCount)),
      longestTaskMs: +median(rows.map((r) => r.longestTaskMs)).toFixed(1),
      scrollable: rows.every((r) => r.scrollable),
      runs: rows.length,
      durationMs,
      route: route(),
    };
  }

  // ---------------------------------------------------------------- panel
  let last = null;
  let busy = false;
  let authorPick = null;
  let authorCheck = null;
  let panelView = "report";
  let panelRoot = null;
  const panelScroll = { report: 0, bisect: 0 };

  // Switching tabs rebuilds the panel, but each tab keeps its own scroll offset.
  function savePanelScroll() {
    // A detached modal reports scrollTop 0, which would clobber the saved
    // offset; only read a root that is still mounted.
    if (panelRoot && panelRoot.isConnected) panelScroll[panelRoot.dataset.view || "report"] = panelRoot.scrollTop;
  }

  function switchPanelView(view) {
    if (view === panelView) return;
    if (panelRoot) panelScroll[panelView] = panelRoot.scrollTop;
    panelView = view;
    showPanel();
    const el = document.querySelector(".perf-adviser-root");
    if (el) {
      el.dataset.view = view;
      el.scrollTop = panelScroll[view] || 0;
    }
  }

  function buildBisectPanel(bBody, s) {
    const sec = section("Guided bisect");
    const card = h("div", `display:flex;flex-direction:column;gap:10px;background:${C.card};border-radius:12px;padding:12px 14px;`);

    const top = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;");
    top.appendChild(h("div", `font-size:13px;color:${C.text};`, "Find which extension costs frame time"));
    if (bisect) {
      const label = bisect.phase === "done" ? bisect.status : bisect.phase;
      const color = bisect.status === "found" ? C.green : bisect.status === "inconclusive" ? C.amber : C.blue;
      top.appendChild(pill(label, color));
    }
    card.appendChild(top);
    card.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.45;`,
      "This panel never turns an extension on or off. It says which half to toggle, you apply that in Marketplace -> Installed, reload, and measure. Each change is compared with a noise band measured by two identical runs, so a difference smaller than that is never called a result."));

    if (!bisect) {
      const names = extensionNames(s);
      card.appendChild(h("div", `font-size:12px;color:${C.text};line-height:1.45;`,
        names.length + " extension(s) in the list" + (names.length ? ": " + names.join(", ") : ".") +
        " Perf Adviser itself is excluded."));
      if (names.length < 2) {
        card.appendChild(h("div", `font-size:12px;color:${C.amber};line-height:1.45;`,
          "At least two other extensions are needed to bisect. Installing another extension is not required for any other feature."));
      }
      const btns = h("div", "display:flex;gap:8px;justify-content:flex-end;");
      btns.appendChild(btn("Start a bisect", () => startBisect(s), true));
      card.appendChild(btns);
    } else {
      card.appendChild(row("Candidates left", String(bisect.candidates.length)));
      card.appendChild(row("Instructed off", bisect.disabled.length ? bisect.disabled.join(", ") : "none"));
      if (bisect.found.length) card.appendChild(row("Named culprit", bisect.found.join(", ")));

      if (bisect.phase === "done") {
        const good = bisect.status === "found";
        card.appendChild(h("div", `font-size:12px;color:${good ? C.green : C.amber};background:${good ? "rgba(30,215,96,.10)" : "rgba(255,164,43,.10)"};border:1px solid ${good ? "rgba(30,215,96,.35)" : "rgba(255,164,43,.35)"};border-radius:10px;padding:9px 12px;line-height:1.45;`,
          bisect.note));
      } else if (bisect.awaiting && bisect.pending) {
        card.appendChild(h("div", `font-size:12px;color:${C.text};background:rgba(76,179,212,.10);border:1px solid rgba(76,179,212,.35);border-radius:10px;padding:9px 12px;line-height:1.45;white-space:pre-wrap;`,
          bisectInstruction()));
      } else if (bisect.phase === "calibrate") {
        card.appendChild(h("div", `font-size:12px;color:${C.text};background:rgba(76,179,212,.10);border:1px solid rgba(76,179,212,.35);border-radius:10px;padding:9px 12px;line-height:1.45;`,
          "Calibration: reload Spotify without changing any extension, reopen this panel and measure again. Two readings of the same setup give the noise floor that every later round is tested against."));
      }
      if (bisect.note && bisect.phase !== "done") {
        card.appendChild(h("div", `font-size:11px;color:${C.sub};line-height:1.45;`, bisect.note));
      }

      const btns = h("div", "display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;");
      if (bisect.phase !== "done") {
        const label = bisect.phase === "baseline" ? "Measure baseline" : bisect.phase === "calibrate" ? "Measure after reload" : "Measure this round";
        btns.appendChild(btn(label, () => runBisectMeasure(), true));
      }
      if (bisect.pending) btns.appendChild(btn("Copy instruction", () => copyText(bisectInstruction())));
      btns.appendChild(btn("Copy report", () => copyText(bisectReportText())));
      if (bisect.phase === "done") {
        if (bisect.found.length) btns.appendChild(btn("Find another", () => findAnotherBisect(s)));
        btns.appendChild(btn("Start over", () => { resetBisect(); showPanel(); }));
      } else {
        btns.appendChild(btn("Abandon", () => { resetBisect(); showPanel(); }));
      }
      card.appendChild(btns);
    }
    sec.appendChild(card);
    bBody.appendChild(sec);

    if (bisect && bisect.rounds.length) {
      const rSec = section("Rounds");
      const rCard = h("div", `background:${C.card};border-radius:12px;padding:12px 14px;overflow:auto;`);
      rCard.appendChild(miniTable(
        ["round", "toggled", "action", "before fps", "after fps", "delta", "noise", "outcome"],
        bisect.rounds.map((r) => [r.n, r.toggled.join(", "), r.action, r.before, r.after, r.delta, r.noise, r.outcome])
      ));
      rSec.appendChild(rCard);
      bBody.appendChild(rSec);
    }

    const limSec = section("Limits of bisect");
    const limCard = h("div", `background:${C.card};border-radius:12px;padding:12px 14px;font-size:11px;color:${C.sub};line-height:1.5;`);
    limCard.textContent =
      "One culprit per run: after a culprit is named, 'Find another' starts a new run with that extension excluded. " +
      "A cost that only appears when two extensions are installed together can end as 'inconclusive' because every single toggle looks like noise. " +
      "Marketplace toggles take effect after a Spotify reload, so each round needs a reload; the calibration measures that reload-to-reload spread on this machine before any round is judged. " +
      "The extension list comes from Spicetify.Config.extensions or Marketplace, whichever is available; it starts from the assumption that every listed extension is enabled. " +
      "Snippets and themes are not toggled by this workflow.";
    limSec.appendChild(limCard);
    bBody.appendChild(limSec);
  }

  // Thresholds are deliberately explicit so the README can quote the same
  // numbers. They are calibrated from measured extensions on one machine; see
  // docs/MEASUREMENTS.md. They are heuristics, not a certification.
  const AUTHOR = {
    forcedMs: 2,
    scrollMs: 6000,
    idleMs: 3000,
    callbackMsPerSec: { pass: 8, warn: 25 },
    intervalsPerSec: { pass: 2, warn: 10 },
  };

  // ---------------------------------------------------------------- bisect
  // Guided, never automatic: extension toggles are the user's job, because this
  // extension must not disable anything. One round toggles half of the current
  // candidates; the user applies that in Marketplace and reloads. A change
  // larger than the measured reload-to-reload noise points at the toggled half;
  // a change inside the noise points at the other half and is never called a
  // result. Start-up calibration measures that noise with two identical runs.
  const BISECT_KEY = "perf-adviser:bisect";
  const BISECT = { runMs: 5000, runs: 3, maxRounds: 8, repeatMax: 1 };
  let bisect = loadBisect();
  let bisectBusy = false;

  function loadBisect() {
    try {
      const v = JSON.parse(localStorage.getItem(BISECT_KEY) || "null");
      if (!v || typeof v !== "object" || !Array.isArray(v.candidates) || !v.phase) return null;
      if (!Array.isArray(v.rounds)) v.rounds = [];
      if (!Array.isArray(v.found)) v.found = [];
      if (!Array.isArray(v.disabled)) v.disabled = [];
      v.noiseFloor = +v.noiseFloor || 0;
      return v;
    } catch (e) { return null; }
  }
  function saveBisect() {
    try {
      if (bisect) localStorage.setItem(BISECT_KEY, JSON.stringify(bisect));
      else localStorage.removeItem(BISECT_KEY);
    } catch (e) { /* ignore */ }
  }
  function resetBisect() { bisect = null; saveBisect(); }

  // Names the user can find in Marketplace -> Installed. Falls back to the
  // loaded file names when Marketplace data is unavailable.
  function extensionNames(s) {
    const out = new Set();
    try {
      const list = Spicetify.Config && Spicetify.Config.extensions;
      if (Array.isArray(list) && list.length) {
        for (const f of list) {
          const n = String(f).replace(/\.js$/i, "");
          if (n && !/^perf-adviser$/i.test(n)) out.add(n);
        }
      }
    } catch (e) { /* ignore */ }
    if (!out.size && s && s.market && s.market.extensions) {
      for (const e of s.market.extensions) {
        if (e && e.name && !/perf adviser/i.test(e.name)) out.add(e.name);
      }
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  function bisectInstruction() {
    if (!bisect || !bisect.pending) return "";
    const p = bisect.pending;
    return "Turn " + (p.action === "disable" ? "OFF" : "ON") + " these " + p.toggled.length +
      " extension(s) in Marketplace -> Installed: " + p.toggled.join(", ") +
      ". Then reload Spotify (or restart it), open Perf Adviser -> Bisect and click Measure this round. Leave every other extension as it is.";
  }

  function pushBisectRound(pend, afterFps, delta, noise, outcome) {
    bisect.rounds.push({
      at: new Date().toISOString(),
      n: bisect.rounds.length + 1,
      toggled: pend.toggled.slice(),
      action: pend.action,
      before: bisect.last ? bisect.last.fps : null,
      after: +afterFps.toFixed(1),
      delta,
      noise: +noise.toFixed(1),
      samples: pend.samples.map((x) => x.fps),
      outcome,
    });
    while (bisect.rounds.length > 12) bisect.rounds.shift();
  }

  function nextBisectRound() {
    if (!bisect.candidates.length) {
      bisect.phase = "done";
      bisect.status = "inconclusive";
      bisect.note = "No candidates left. Nothing was toggled often enough to name a culprit.";
      return;
    }
    if (bisect.rounds.length >= BISECT.maxRounds) {
      bisect.phase = "done";
      bisect.status = "inconclusive";
      bisect.note = "Stopped after " + BISECT.maxRounds + " rounds without narrowing to one extension.";
      return;
    }
    const half = Math.ceil(bisect.candidates.length / 2);
    const toggled = bisect.candidates.slice(0, half);
    const anyDisabled = toggled.some((n) => bisect.disabled.includes(n));
    const action = anyDisabled ? "enable" : "disable";
    bisect.disabled = action === "disable"
      ? [...new Set([...bisect.disabled, ...toggled])]
      : bisect.disabled.filter((n) => !toggled.includes(n));
    bisect.pending = { toggled, action, samples: [] };
    bisect.phase = "running";
    bisect.awaiting = true;
    bisect.note = "";
  }

  function bisectStep(m) {
    if (!bisect) return;
    if (bisect.phase === "baseline") {
      bisect.baseline = m;
      bisect.phase = "calibrate";
      bisect.awaiting = false;
      bisect.note = "Baseline recorded at " + m.fps + " fps. Reload Spotify without changing any extension, open Bisect again and measure. That second reading measures reload-to-reload noise, which is what every later comparison is tested against.";
      return;
    }
    if (bisect.phase === "calibrate") {
      const a = bisect.baseline;
      bisect.noiseFloor = +Math.max(2, Math.abs(m.fps - a.fps), 1.4826 * Math.max(a.mad || 0, m.mad || 0)).toFixed(2);
      bisect.calibration = { first: a, second: m, noise: bisect.noiseFloor };
      bisect.last = m;
      bisect.phase = "running";
      bisect.note = "Reload-to-reload noise measured at " + bisect.noiseFloor + " fps. A change smaller than that is never reported as a result.";
      nextBisectRound();
      return;
    }
    const pend = bisect.pending;
    if (!pend) { nextBisectRound(); return; }
    pend.samples.push(m);
    const before = bisect.last;
    const fps = median(pend.samples.map((x) => x.fps));
    const mad = Math.max(m.mad || 0, ...pend.samples.map((x) => x.mad || 0));
    const noise = Math.max(bisect.noiseFloor || 0, 1.4826 * mad, 2);
    const delta = +(fps - (before ? before.fps : fps)).toFixed(1);

    if (Math.abs(delta) <= noise) {
      if (pend.samples.length <= BISECT.repeatMax) {
        bisect.note = "The change (" + delta + " fps) is inside the noise band (" + noise.toFixed(1) + " fps). Measure this round again without changing extensions: a second sample is needed before any conclusion.";
        return;
      }
      const remain = bisect.candidates.filter((n) => !pend.toggled.includes(n));
      pushBisectRound(pend, fps, delta, noise, "within noise twice - no conclusion");
      bisect.last = { fps, mad, at: m.at, runs: m.runs };
      bisect.pending = null;
      bisect.awaiting = false;
      if (!remain.length) {
        bisect.status = "inconclusive";
        bisect.phase = "done";
        bisect.note = "Toggling " + pend.toggled.join(", ") + " alone did not move the metric beyond noise, so no single extension can be named. The cost may need a combination of extensions, or come from outside this list (theme, snippet, Spotify build).";
        return;
      }
      bisect.candidates = remain;
      bisect.note = "Toggling " + pend.toggled.join(", ") + " did not change the metric beyond noise (" + noise.toFixed(1) + " fps), so the cause is in the half that stayed as it was.";
      if (remain.length === 1) {
        bisect.note += " One candidate left; the next round toggles it.";
      }
      nextBisectRound();
      return;
    }

    const moved = pend.toggled.slice();
    pushBisectRound(pend, fps, delta, noise, "significant");
    bisect.candidates = moved;
    bisect.pending = null;
    bisect.awaiting = false;
    bisect.last = { fps, mad, at: m.at, runs: m.runs };
    if (moved.length === 1) {
      bisect.found = [...new Set([...(bisect.found || []), moved[0]])];
      bisect.status = "found";
      bisect.phase = "done";
      bisect.note = "Toggling " + moved[0] + " alone moved Home scroll FPS by " + delta + " fps against a measured noise band of " + noise.toFixed(1) + " fps.";
      return;
    }
    bisect.note = "Toggling " + moved.join(", ") + " moved FPS by " + delta + " fps against a noise band of " + noise.toFixed(1) + " fps, so the cause is inside that group.";
    nextBisectRound();
  }

  async function runBisectMeasure() {
    if (busy || bisectBusy) { notify("Perf Adviser is already measuring"); return; }
    if (!bisect) return;
    if (lag.nav.normRoute(route()) !== "/") { notify("Perf Adviser: open Home before a bisect measurement", true); return; }
    bisectBusy = true;
    busy = true;
    savePanelScroll(); try { Spicetify.PopupModal.hide(); } catch (e) { /* ignore */ }
    notify("Perf Adviser: bisect measurement - " + BISECT.runs + " x " + (BISECT.runMs / 1000) + " s, the page will scroll");
    await sleep(600);
    let bm = null;
    try { bm = await benchmark(BISECT.runMs, BISECT.runs); } finally { busy = false; bisectBusy = false; }
    if (!bm || !bm.samples || !bm.samples.length) {
      notify("Perf Adviser: no frames measured - is a scrollable page open?", true);
      showPanel();
      return;
    }
    bisectStep({ fps: bm.fps, mad: bm.mad, at: new Date().toISOString(), runs: bm.runs });
    saveBisect();
    await refresh();
  }

  async function startBisect(s) {
    if (busy || bisectBusy) { notify("Perf Adviser is already measuring"); return; }
    if (lag.nav.normRoute(route()) !== "/") { notify("Perf Adviser: open Home first", true); return; }
    const candidates = extensionNames(s);
    if (candidates.length < 2) {
      notify("Perf Adviser: need at least two other extensions to bisect", true);
      return;
    }
    bisect = {
      startedAt: new Date().toISOString(),
      phase: "baseline",
      status: "running",
      candidates,
      disabled: [],
      found: [],
      rounds: [],
      noiseFloor: 0,
      calibration: null,
      baseline: null,
      last: null,
      pending: null,
      awaiting: false,
      note: "",
    };
    saveBisect();
    await runBisectMeasure();
  }

  async function findAnotherBisect(s) {
    if (!bisect || !bisect.found.length) return;
    const candidates = extensionNames(s).filter((n) => !bisect.found.includes(n));
    if (candidates.length < 2) {
      notify("Perf Adviser: no other extensions left to test", true);
      return;
    }
    const disabled = bisect.disabled.slice();
    const found = bisect.found.slice();
    bisect = {
      startedAt: new Date().toISOString(),
      phase: "baseline",
      status: "running",
      candidates,
      disabled,
      found,
      rounds: [],
      noiseFloor: 0,
      calibration: null,
      baseline: null,
      last: null,
      pending: null,
      awaiting: false,
      note: "Looking for another culprit. Keep the already-found extension in the state that made the page fast, then measure a new baseline.",
    };
    saveBisect();
    await runBisectMeasure();
  }

  function bisectReportText() {
    if (!bisect) return "";
    const lines = [];
    lines.push("Perf Adviser guided bisect (heuristic, one machine)");
    lines.push("Started: " + bisect.startedAt);
    lines.push("Metric: median Home scroll FPS over " + BISECT.runs + " x " + (BISECT.runMs / 1000) + " s, plus a reload-to-reload noise calibration");
    if (bisect.calibration) {
      lines.push("Calibration: " + bisect.calibration.first.fps + " then " + bisect.calibration.second.fps +
        " fps with no changes; noise floor " + bisect.calibration.noise + " fps");
    }
    for (const r of bisect.rounds) {
      lines.push("Round " + r.n + ": turned " + (r.action === "disable" ? "OFF " : "ON ") + r.toggled.join(", ") +
        "; before " + r.before + ", after " + r.after + ", delta " + r.delta + " fps, noise " + r.noise +
        " fps -> " + r.outcome);
    }
    lines.push("Result: " + (bisect.status === "found" ? "culprit " + bisect.found.join(", ") : "inconclusive"));
    if (bisect.note) lines.push("Note: " + bisect.note);
    lines.push("Limits: finds one culprit per run; a cost that needs a combination of extensions may come out inconclusive; the extension list is whatever Marketplace and the loaded config expose; toggles are done by the user, never by this extension.");
    return lines.join("\n");
  }

  function evaluateAuthor(source, p, scroll) {
    const checks = [];
    const inv = author.inventory().find((x) => x.source === source) || null;
    const src = p && p.sources ? p.sources.find((x) => x.source === source) : null;
    const own = author.timings(source);
    const secs = p ? Math.max(0.001, p.recordedMs / 1000) : 0;
    const add = (id, label, result, evidence) => checks.push({ id, label, result, evidence });

    const broad = inv ? inv.observers.filter((o) => o.broad) : [];
    const attr = inv ? inv.observers.filter((o) => o.attrNoFilter) : [];
    if (!author.enabled) {
      add("observers", "No broad subtree observers", "WARN",
        "Author mode was off at load, so observers registered at startup are invisible. Timing-only evidence below still applies.");
    } else if (!inv) {
      add("observers", "No broad subtree observers", "WARN",
        "No registrations recorded for this source. It may have loaded before Perf Adviser or registered nothing.");
    } else if (broad.length) {
      add("observers", "No broad subtree observers", "FAIL",
        broad.map((o) => o.target + (o.childList ? " childList" : "") + (o.attributes ? " attributes" + (o.filter ? "[" + o.filter.join(",") + "]" : " (no filter)") : "")).join("; "));
    } else if (attr.length) {
      add("observers", "No broad subtree observers", "WARN",
        attr.length + " attribute observer(s) without attributeFilter: " + attr.map((o) => o.target).join(", "));
    } else {
      add("observers", "No broad subtree observers", "PASS",
        inv.observers.length + " observer(s), none on document/body/documentElement with subtree.");
    }

    const forced = src ? src.forcedCount || 0 : 0;
    add("forced", "No forced layout/style read over " + AUTHOR.forcedMs + " ms", forced ? "FAIL" : "PASS",
      forced ? forced + " read(s), " + src.forcedMs + " ms total (" + (src.forcedBy || "unknown") + ")" :
        "none over the " + AUTHOR.forcedMs + " ms threshold during the standard test");

    const rate = +((own ? own.ms : src ? src.totalMs : 0) / secs).toFixed(2);
    const timedBy = own ? "timed by the Author mode wrappers, which is the only way to see handlers registered at startup" : "timed by the profiler, so startup handlers are not included";
    add("callback", "Callback time per second of test", rate > AUTHOR.callbackMsPerSec.warn ? "FAIL" : rate > AUTHOR.callbackMsPerSec.pass ? "WARN" : "PASS",
      rate + " ms/s (" + timedBy + "); pass < " + AUTHOR.callbackMsPerSec.pass + ", warn " + AUTHOR.callbackMsPerSec.pass + "-" + AUTHOR.callbackMsPerSec.warn + ", fail > " + AUTHOR.callbackMsPerSec.warn + " over " + secs.toFixed(1) + " s");

    const intervalCalls = own && own.kinds.interval ? own.kinds.interval.calls : src ? src.intervalCalls || 0 : 0;
    const intRate = +(intervalCalls / secs).toFixed(2);
    add("intervals", "Interval callback rate", intRate > AUTHOR.intervalsPerSec.warn ? "FAIL" : intRate > AUTHOR.intervalsPerSec.pass ? "WARN" : "PASS",
      intRate + "/s measured" + (inv ? " (" + inv.intervals.length + " registered from this source)" : "") +
      " (pass <= " + AUTHOR.intervalsPerSec.pass + ", warn <= " + AUTHOR.intervalsPerSec.warn + ", fail above)");

    const overall = checks.some((c) => c.result === "FAIL") ? "fail" : checks.some((c) => c.result === "WARN") ? "warn" : "pass";
    return {
      at: new Date().toISOString(),
      source,
      route: lag.nav.normRoute(route()),
      conditions: { scrollMs: AUTHOR.scrollMs, idleMs: AUTHOR.idleMs, homeOnly: true },
      scroll: scroll || null,
      overall,
      checks,
      thresholds: AUTHOR,
      authorMode: author.enabled,
      authorStats: author.stats,
      inventory: inv,
      profile: p ? {
        recordedMs: p.recordedMs,
        source: src,
        fps: p.fps,
        longTasks: p.longTasks,
      } : null,
      authorTimings: own ? {
        calls: own.calls,
        ms: +own.ms.toFixed(2),
        kinds: Object.fromEntries(Object.entries(own.kinds).map(([k, v]) => [k, { calls: v.calls, ms: +v.ms.toFixed(2) }])),
      } : null,
    };
  }

  async function runAuthorCheck(source) {
    if (busy) { notify("Perf Adviser is already measuring"); return; }
    if (!author.enabled) { notify("Perf Adviser: turn on Author mode and reload first", true); return; }
    if (lag.nav.normRoute(route()) !== "/") { notify("Perf Adviser: open Home before the author check", true); return; }
    if (!source) { notify("Perf Adviser: pick a source first", true); return; }
    busy = true;
    savePanelScroll(); try { Spicetify.PopupModal.hide(); } catch (e) { /* ignore */ }
    notify("Perf Adviser: author check - scrolling Home for " + (AUTHOR.scrollMs / 1000) + " s, then " + (AUTHOR.idleMs / 1000) + " s idle");
    await sleep(500);
    author.resetTimings();
    author.setCollecting(true);
    let p = null;
    let scroll = null;
    try {
      prof.start();
      scroll = await measureOnce(AUTHOR.scrollMs);
      await sleep(AUTHOR.idleMs);
    } finally {
      p = prof.stop();
      author.setCollecting(false);
    }
    const s = await scan();
    last = { scan: s, bench: last ? last.bench : null, prof: last ? last.prof : null };
    authorCheck = evaluateAuthor(source, p, scroll);
    busy = false;
    showPanel();
    return authorCheck;
  }

  function section(title) {
    const wrap = h("div", "display:flex;flex-direction:column;gap:8px;");
    wrap.appendChild(h("div", `font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.sub};`, title));
    return wrap;
  }

  function row(label, value, color) {
    const r = h("div", "display:flex;justify-content:space-between;gap:16px;align-items:baseline;");
    r.appendChild(h("span", `color:${C.sub};font-size:13px;`, label));
    r.appendChild(h("span", `color:${color || C.text};font-size:13px;`, value));
    return r;
  }

  function pill(text, color) {
    return h("span", `display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;border:1px solid ${color};color:${color};`, text);
  }

  function btn(text, onClick, primary) {
    const b = h("button", [
      "padding:7px 14px",
      "border-radius:999px",
      "font-size:13px",
      "cursor:pointer",
      `border:1px solid ${primary ? "transparent" : "rgba(128,128,128,.5)"}`,
      `background:${primary ? C.green : "transparent"}`,
      `color:${primary ? "#000" : C.text}`,
    ].join(";"), text);
    b.addEventListener("click", onClick);
    return b;
  }

  // Compact table for the profiler output.
  function miniTable(headers, rows) {
    const wrap = h("div", "display:flex;flex-direction:column;gap:1px;font-size:11px;font-family:ui-monospace,Consolas,monospace;overflow-x:auto;");
    const head = h("div", `display:grid;grid-template-columns:${headers.map(() => "minmax(0,1fr)").join(" ")};gap:10px;color:${C.sub};padding:2px 0;`);
    for (const hd of headers) head.appendChild(h("div", "", hd));
    wrap.appendChild(head);
    if (!rows.length) {
      wrap.appendChild(h("div", `color:${C.sub};padding:4px 0;`, "nothing recorded"));
      return wrap;
    }
    for (const r of rows) {
      const line = h("div", `display:grid;grid-template-columns:${r.map(() => "minmax(0,1fr)").join(" ")};gap:10px;padding:3px 0;border-top:1px solid rgba(128,128,128,.14);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`);
      for (const cell of r) line.appendChild(h("div", `overflow:hidden;text-overflow:ellipsis;color:${C.text};`, String(cell)));
      wrap.appendChild(line);
    }
    return wrap;
  }

  function buildRecommendations(s, p) {
    const recs = [];
    if (s.headerBlur.length) {
      recs.push({
        severity: "high",
        title: "Sticky header blur is active",
        body: "Measured +5.8 fps on Home on top of the card fix; on its own the gain is within noise (+1.5 fps). " + s.headerBlur.length + " surface(s) currently carry backdrop-filter.",
        action: "Turn on 'Sticky header blur' in One-click fixes. If it is already on, some other extension or snippet is re-adding the blur.",
      });
    }
    if (s.cssEditorChars > 0) {
      recs.push({
        severity: "low",
        title: "The CSS editor still has " + s.cssEditorChars + " characters of CSS",
        body: "All current fixes are injected by this extension, so the CSS editor can stay empty and must not duplicate them.",
        action: "Press F12, copy the text somewhere safe, then clear the CSS editor.",
      });
    }
    if (s.zoom.level != null && s.zoom.level !== 0) {
      recs.push({
        severity: "info",
        title: "Page zoom is " + zoomPct(s.zoom.level),
        body: "A non-100% page zoom made the whole UI redraw at the wrong scale after backgrounding. This is a display bug, not fps.",
        action: "Use 'Reset zoom to 100%' below.",
      });
    }
    if (s.route === "/" && !s.cardPlayFix) {
      recs.push({
        severity: "info",
        title: "Home FPS depends on where the mouse rests",
        body: "With the cursor over a card, Spotify's play-button tooltip is repositioned on every scroll frame. Hiding it while scrolling measured +38.5 fps median (paired, 3 rounds).",
        action: "Turn on 'Home card play button' below. It keeps the button usable at rest and only affects Home.",
      });
    }
    const hasRules = (s.css || []).reduce((n, c) => n + (c.has || 0), 0);
    if (!s.runtime || (s.runtime.active === false && hasRules >= 10)) {
      recs.push({
        severity: "medium",
        title: "Idle :has() CSS rules widen card and player hovers",
        body: "Chromium treats any live :has() rule as document-wide, even one that matches nothing. " + hasRules +
          " :has() selectors are loaded; with them live, hovering a wide Home card restyles 951 elements instead of 378. Parking the idle ones cuts that work, but Spotify's own card re-render still costs a frame.",
        action: "Turn on 'Runtime CSS patches' below. It only parks rules that match nothing and restores each one when its target appears.",
      });
    }
    if (s.coverRotating) {
      const src = s.coverSource ? s.coverSource.name : "";
      const kind = s.coverSource ? (s.coverSource.kind === "theme" ? "theme" : s.coverSource.kind === "style" ? "style block" : "snippet") : "";
      const where = s.coverSource && s.coverSource.kind === "theme" ? "Marketplace > Themes" : "Marketplace > Snippets";
      if (s.coverPause) {
        recs.push({
          severity: "info",
          title: "Rotating cover art is paused by this extension",
          body: (src ? "The " + kind + " \"" + src + "\" adds the rotation; the pause only overrides it. " : "") +
            "Pausing the rotation measured +37.1 fps median on Home (3 paired 8 s runs).",
          action: src ? "Cleaner: disable \"" + src + "\" in " + where + " and turn this toggle off." : "Keep this on only if you want the rotation gone and cannot find its source.",
        });
      } else {
        recs.push({
          severity: "medium",
          title: src ? "Rotating cover art: source is " + src : "Rotating cover art is animating",
          body: (src ? "The " + kind + " \"" + src + "\" animates .cover-art" : "An installed snippet or theme animates .cover-art") +
            " with an infinite rotation. With it paused, Home gained +37.1 fps median (3 paired 8 s runs). Removing the source is the real fix; 'Pause rotation' only hides the cost.",
          action: src ? "Disable \"" + src + "\" in " + where + " for the same gain. Use 'Pause rotation' only if you want to keep the look." : "Find the snippet or theme that adds it and disable it; or use 'Pause rotation' as an override.",
        });
      }
    }

    // Measured attribution from the built-in profiler. Generic: whatever the
    // user recorded becomes the finding, no allow-list of names involved.
    if (p && p.sources && p.sources.length) {
      const skip = /^(spotify-core|\(unknown\)|\(anonymous\/eval\)|spicetifyWrapper\.js|perf-adviser\.js)$/;
      const heavy = p.sources.filter((x) => !skip.test(x.source) && (x.totalMs + (x.forcedMs || 0)) >= 250).slice(0, 3);
      for (const t of heavy) {
        const ms = Math.round(t.totalMs + (t.forcedMs || 0));
        const share = p.recordedMs ? Math.round((100 * ms) / p.recordedMs) : 0;
        recs.push({
          severity: share >= 25 ? "high" : "medium",
          title: "Profile: " + t.source + " used " + ms + " ms",
          body: ms + " ms in " + t.calls + " callback(s) over " + (p.recordedMs / 1000).toFixed(1) + " s of recording" +
            (share ? " (~" + share + "% of the window)" : "") + ", longest " + Math.round(t.maxMs) + " ms" +
            (t.forcedCount ? "; includes " + Math.round(t.forcedMs) + " ms of forced layout reads" : "") + ". This is measured, not a guess.",
          action: "If you do not need it, disable it in Marketplace and record again to compare.",
        });
      }
    }

    // CSS cost signals, generic. Only the top source and only when the counts are
    // notable; skip when that same source is already named above.
    const cssTop = (s.css || []).find((x) => x.score > 0);
    const coverName = s.coverSource ? s.coverSource.name : "";
    if (cssTop && cssTop.name !== coverName && (cssTop.has >= 80 || cssTop.blur >= 6 || cssTop.infinite >= 2 || cssTop.chars > 400000)) {
      recs.push({
        severity: "info",
        title: "Heavy CSS signals in " + cssTop.name,
        body: cssTop.rules + " rules, " + cssTop.has + " :has() selectors, " + cssTop.blur + " blur rule(s), " +
          Math.round(cssTop.chars / 1024) + " KB of CSS, " + cssTop.infinite + " infinite animation(s). " +
          "These are counts, not a measured fps cost, but they make style recalc more expensive on every scroll.",
        action: "If you do not need it, disable it and press 'Measure again' to compare on your own machine.",
      });
    }

    return { recs };
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => notify("Perf Adviser: report copied to clipboard"),
        () => notify("Perf Adviser: could not copy", true)
      );
      return;
    }
    const ta = h("textarea", "position:fixed;left:-9999px;top:0;", text);
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); notify("Perf Adviser: report copied"); } catch (e) { notify("Perf Adviser: could not copy", true); }
    ta.remove();
  }

  function reportText(s, b, p) {
    const lines = [];
    lines.push("Perf Adviser " + VERSION + " - " + new Date().toISOString());
    lines.push("Route: " + (b ? b.route : s.route));
    if (b) {
      lines.push("FPS: " + b.fps + " (p95 " + b.p95 + " ms, slow frames " + b.slowPct + "%, long tasks " + b.longTaskCount + ") - " + b.runs + " x " + (b.durationMs / 1000) + "s " + (b.scrollable ? "scroll" : "idle"));
    } else {
      lines.push("FPS: not measured");
    }
    lines.push("Zoom: " + zoomPct(s.zoom.level) + ", devicePixelRatio " + s.zoom.dpr.toFixed(4));
    lines.push("Header blur: " + (s.headerBlur.length ? s.headerBlur.map((o) => o.sel + "=" + o.filter).join("; ") : "none") + " (--header-filters: " + (s.headerFilterVar || "unset") + ")");
    lines.push("Injected CSS: " + (s.cssOff ? "DISABLED" : "active") + "; CSS editor: " + (s.cssEditorChars == null ? "unknown" : s.cssEditorChars + " chars"));
    lines.push("Fixes: header blur " + (s.headerFix ? "removed" : "left alone") +
      ", Home card play button " + (s.cardPlayFix ? "hidden while scrolling" : "always shown") +
      ", rotating cover " + (s.coverPause ? "paused" : "left alone") +
      ", theme tweaks " + (s.themeTweaks ? "on" : "off") +
      "; rotating animation present: " + (s.coverRotating ? "yes" : "no"));
    if (p) {
      lines.push("Profile: " + (p.recordedMs / 1000).toFixed(1) + " s" + (p.fps ? ", " + p.fps.avg + " fps, " + p.longTasks.count + " long tasks (max " + p.longTasks.maxMs + " ms)" : ""));
      p.sources.slice(0, 10).forEach((x) => lines.push("  " + x.source + ": " + x.totalMs + " ms in " + x.calls + " calls, max " + x.maxMs + " ms" + (x.forcedCount ? ", forced " + x.forcedMs + " ms" : "")));
      lines.push("Registered since load:");
      p.inventory.slice(0, 10).forEach((x) => lines.push("  " + x.source + ": intervals " + x.interval + ", observers " + x.observer + " (broad " + x.broadObserver + "), hot listeners " + x.listener));
    }
    if (s.market) {
      lines.push("Extensions (" + s.market.extensions.length + "): " + s.market.extensions.map((e) => e.name).join(", "));
      lines.push("Snippets (" + s.market.snippets.length + "): " + s.market.snippets.map((e) => e.name).join(", "));
      lines.push("Theme: " + (s.market.theme ? s.market.theme.name : "unknown"));
    } else {
      lines.push("Marketplace data: unavailable");
    }
    lines.push("Slow-frame recorder: " + (state.lagRecorder ? "on (" + (lag.mode || "unsupported") + ")" : "off") +
      ", " + lag.entries.length + " frame(s) buffered" + (lag.dropped ? ", " + lag.dropped + " dropped" : ""));
    lag.entries.slice().reverse().slice(0, 10).forEach((e) => {
      const top = e.scripts.slice().sort((a, b) => b.duration - a.duration)[0];
      lines.push("  " + e.route + " frame " + e.duration + " ms, blocking " + e.blocking + " ms, " +
        (top ? top.file + " " + top.duration + " ms" : "no script attribution"));
    });
    const lagRoll = lag.rollup().slice(0, 8);
    if (lagRoll.length) {
      lines.push("  by source: " + lagRoll.map((x) => x.file + " " + x.ms.toFixed(1) + " ms/" + x.calls).join(", "));
    }
    if (state.navTiming) {
      const navRows = lag.nav.rows();
      lines.push("Route change timing: on, " + lag.nav.marks + " mark(s), window " + (lag.nav.windowMs / 1000) + " s");
      if (!navRows.length) lines.push("  no completed route change yet");
      navRows.forEach((r) => lines.push("  " + r.route + ": median " + r.median + " ms, worst " + r.worst + " ms, blocking " + r.blocking + " ms, " + r.n + " sample(s), top " + r.top));
      lag.nav.recent.slice(-5).forEach((r) => lines.push("  last " + r.route + ": cost " + r.cost + " ms (frames " + r.frames + ", blocking " + r.blocking + ", settle " + r.settle + ")"));
    } else {
      lines.push("Route change timing: off");
    }
    if (s.coverSource) lines.push("Cover animation source: " + s.coverSource.name + " (" + s.coverSource.kind + ")");
    if (s.selectorHealth) {
      const sh = s.selectorHealth;
      lines.push("Selector health: Spotify " + sh.version + " (" + sh.source + "), checked on " + sh.route +
        (sh.migrated ? ", SPOTIFY CHANGED from " + sh.previous : ""));
      sh.rows.forEach((r) => lines.push("  " + r.status + " - " + r.label + " [" + r.sel + "] expected " +
        (r.routes.includes("*") ? "any page" : r.routes.join(","))));
    }
    if (authorCheck) {
      lines.push("Author check: " + authorCheck.overall.toUpperCase() + " for " + authorCheck.source +
        " (" + authorCheck.route + ", " + authorCheck.at + ", author mode " + (authorCheck.authorMode ? "on" : "off") + ")");
      authorCheck.checks.forEach((c) => lines.push("  [" + c.result + "] " + c.label + " - " + c.evidence));
      lines.push("  thresholds: forced > " + authorCheck.thresholds.forcedMs + " ms fails; callback " +
        authorCheck.thresholds.callbackMsPerSec.pass + "/" + authorCheck.thresholds.callbackMsPerSec.warn +
        " ms/s; intervals " + authorCheck.thresholds.intervalsPerSec.pass + "/" + authorCheck.thresholds.intervalsPerSec.warn + " per second");
    }
    if (s.animations && s.animations.length) {
      lines.push("Infinite animations: " + s.animations.slice(0, 8).map((a) => a.name + " on " + a.target + " (" + a.state + ")").join(", "));
    }
    if (s.css && s.css.length) {
      lines.push("CSS sources by signal:");
      s.css.slice(0, 5).forEach((x) => lines.push("  " + x.name + " [" + x.kind + "]: " + x.rules + " rules, " + x.has + " :has(), " + x.blur + " blur, " + x.infinite + " infinite, " + Math.round(x.chars / 1024) + " KB"));
    }
    const { recs } = buildRecommendations(s, p);
    lines.push("Findings:");
    recs.forEach((r, i) => lines.push(" " + (i + 1) + ". [" + r.severity + "] " + r.title + " - " + r.body + " " + r.action));
    return lines.join("\n");
  }

  function showPanel() {
    if (!last) return;
    const { scan: s, bench: b } = last;
    const p = last.prof || null;
    const { recs } = buildRecommendations(s, p);
    savePanelScroll();

    const root = h("div", "display:flex;flex-direction:column;gap:16px;min-width:min(620px,78vw);max-height:70vh;overflow:auto;padding:4px 2px 8px;");
    root.className = "perf-adviser-root";
    root.dataset.view = panelView;
    root.addEventListener("scroll", () => { if (root.isConnected && root === panelRoot) panelScroll[root.dataset.view || "report"] = root.scrollTop; }, { passive: true });

    // header
    const head = h("div", "display:flex;align-items:center;justify-content:space-between;gap:12px;");
    const titleWrap = h("div", "display:flex;flex-direction:column;gap:2px;");
    titleWrap.appendChild(h("div", `font-size:12px;color:${C.sub};`, "v" + VERSION + " - " + (b ? b.route : s.route) + " - nothing is disabled automatically"));
    titleWrap.appendChild(h("div", `font-size:11px;color:${C.sub};`, "Fixes are CSS injected by this extension. Extensions, snippets and themes are never changed."));
    head.appendChild(titleWrap);
    head.appendChild(h("span", `font-size:11px;color:${C.sub};`, "no network"));
    root.appendChild(head);

    // report / bisect tabs; only one body is shown, both are built so switching
    // back does not need a measurement
    const tabBar = h("div", "display:flex;gap:6px;border-bottom:1px solid rgba(128,128,128,.18);padding-bottom:6px;");
    const tabBtn = (label, view) => {
      const active = panelView === view;
      const el = btn(label, () => switchPanelView(view), active);
      el.style.borderRadius = "8px";
      el.style.padding = "5px 12px";
      el.style.fontSize = "12px";
      if (!active) el.style.color = C.sub;
      return el;
    };
    tabBar.appendChild(tabBtn("Report", "report"));
    tabBar.appendChild(tabBtn("Bisect", "bisect"));
    root.appendChild(tabBar);

    const body = h("div", "display:flex;flex-direction:column;gap:16px;");
    body.style.display = panelView === "report" ? "" : "none";
    root.appendChild(body);

    const bBody = h("div", "display:flex;flex-direction:column;gap:16px;");
    bBody.style.display = panelView === "bisect" ? "" : "none";
    root.appendChild(bBody);

    const health = s.selectorHealth;
    if (health && health.migrated) {
      body.appendChild(h("div", `font-size:12px;color:${C.amber};background:rgba(255,164,43,.12);border:1px solid rgba(255,164,43,.35);border-radius:10px;padding:9px 12px;line-height:1.45;`,
        "Spotify updated to " + health.version + " (last checked on " + health.previous + "). Re-run the scroll test; the Selector health section below shows which class names this version still uses."));
    }

    // score
    const score = h("div", `display:flex;gap:22px;align-items:flex-end;background:${C.card};border-radius:12px;padding:14px 16px;flex-wrap:wrap;`);
    const big = h("div", "display:flex;flex-direction:column;");
    big.appendChild(h("div", `font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.sub};`, "Scroll FPS"));
    big.appendChild(h("div", `font-size:40px;line-height:1;font-weight:700;color:${b ? (b.fps >= 90 ? C.green : b.fps >= 45 ? C.amber : C.red) : C.sub};`, b ? String(b.fps) : "--"));
    score.appendChild(big);
    if (b) {
      const metrics = h("div", "display:flex;flex-direction:column;gap:3px;");
      metrics.appendChild(row("p95 frame", b.p95 + " ms"));
      metrics.appendChild(row("slow frames", b.slowPct + " %"));
      metrics.appendChild(row("long tasks", String(b.longTaskCount)));
      metrics.appendChild(row("mode", (b.scrollable ? "scroll" : "idle") + " - " + b.runs + " x " + (b.durationMs / 1000) + " s"));
      score.appendChild(metrics);
    }
    const scoreBtns = h("div", "display:flex;gap:8px;margin-left:auto;align-self:center;");
    scoreBtns.appendChild(btn("Measure again", () => runBench(true), true));
    scoreBtns.appendChild(btn("Copy report", () => copyText(reportText(s, b, p))));
    score.appendChild(scoreBtns);
    body.appendChild(score);
    if (b && b.runs === 1) {
      body.appendChild(h("div", `font-size:11px;color:${C.sub};margin-top:-8px;`, "One short run (after a warm-up). Home FPS also depends on where the mouse rests: over a card, Spotify's play-button tooltip churns every scroll frame. 'Measure again' runs 2 x 6 s."));
    }

    // findings
    const findings = section("What to change");
    if (!recs.length) {
      findings.appendChild(h("div", `font-size:13px;color:${C.green};`, "No live offender right now: header blur, zoom, CSS-editor leftovers and infinite animations are clean. Record a profile on a slow page for per-script cost."));
    }
    for (const r of recs) {
      const box = h("div", `display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid rgba(128,128,128,.18);`);
      const dot = h("div", `flex:0 0 8px;width:8px;height:8px;border-radius:50%;margin-top:6px;background:${SEV[r.severity] || C.sub};`);
      const body = h("div", "display:flex;flex-direction:column;gap:2px;");
      body.appendChild(h("div", `font-size:13px;font-weight:600;color:${C.text};`, r.title));
      body.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.45;`, r.body));
      body.appendChild(h("div", `font-size:12px;color:${C.text};line-height:1.45;`, r.action));
      box.appendChild(dot);
      box.appendChild(body);
      findings.appendChild(box);
    }
    body.appendChild(findings);

    // environment
    const env = section("Environment");
    if (s.market) {
      env.appendChild(row("Extensions", String(s.market.extensions.length)));
      env.appendChild(row("Snippets", String(s.market.snippets.length)));
      env.appendChild(row("Theme", s.market.theme ? s.market.theme.name : "unknown"));
    } else {
      env.appendChild(h("div", `font-size:12px;color:${C.amber};`, "Marketplace data unavailable (is the Marketplace app loaded?)."));
    }
    env.appendChild(row("Header blur", s.headerBlur.length ? s.headerBlur.length + " active surface(s)" : "none", s.headerBlur.length ? C.red : C.green));
    env.appendChild(row("Rotating cover", s.coverRotating
      ? (s.coverPause ? "paused by fix" : "animating") + (s.coverSource ? " - from " + s.coverSource.name : "")
      : "not present", s.coverRotating && !s.coverPause ? C.amber : C.green));
    env.appendChild(row("Injected CSS", s.cssOff ? "disabled" : "active", s.cssOff ? C.amber : C.green));
    env.appendChild(row("CSS editor", s.cssEditorChars == null ? "unknown" : s.cssEditorChars ? s.cssEditorChars + " chars" : "empty", s.cssEditorChars ? C.amber : C.green));
    env.appendChild(row("Page zoom", (s.zoom.level == null ? "unknown" : zoomPct(s.zoom.level)) + " / DPR " + s.zoom.dpr.toFixed(3), s.zoom.level === 0 ? C.green : C.amber));
    body.appendChild(env);

    // Generic CSS inventory: every snippet, the theme and extension <style>
    // blocks, ranked by expensive signals. Counts only - the profiler gives
    // measured attribution, so nothing here depends on a name being known.
    const cssSec = section("Installed CSS (signals)");
    const cssCard = h("div", `display:flex;flex-direction:column;gap:8px;background:${C.card};border-radius:12px;padding:12px 14px;`);
    const cssRows = (s.css || []).slice(0, 5).map((x) => [
      x.name, String(x.rules), String(x.has), String(x.blur), String(x.infinite), Math.round(x.chars / 1024) + " KB",
    ]);
    if (cssRows.length) {
      cssCard.appendChild(miniTable(["source", "rules", ":has()", "blur", "infinite", "size"], cssRows));
      cssCard.appendChild(h("div", `font-size:11px;color:${C.sub};line-height:1.4;`,
        "Counts are signals for style-recalc risk, not measured fps. Record a profile on the slow page to attribute real main-thread time."));
    } else {
      cssCard.appendChild(h("div", `font-size:12px;color:${C.sub};`, "No snippet, theme or extension CSS found."));
    }
    cssSec.appendChild(cssCard);
    body.appendChild(cssSec);

    // fixes
    const fixes = section("Fixes (measured)");
    const fixCard = h("div", `display:flex;flex-direction:column;gap:0;background:${C.card};border-radius:12px;padding:4px 14px;`);

    const setFix = (key, value, message) => {
      state[key] = value;
      if (value && state.cssOff) state.cssOff = false;
      saveState(state);
      applyInjectedFixes();
      syncRuntimePatches();
      notify(message);
      refresh();
    };

    const addToggle = (opts) => {
      const row = h("div", "display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;padding:10px 0;border-top:1px solid rgba(128,128,128,.18);");
      const text = h("div", "display:flex;flex-direction:column;gap:3px;flex:1 1 320px;min-width:240px;");
      const titleLine = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;");
      titleLine.appendChild(h("div", `font-size:13px;color:${C.text};`, opts.title));
      if (opts.recommended) titleLine.appendChild(pill("recommended", C.green));
      titleLine.appendChild(pill(opts.on ? "on" : "off", opts.on ? C.green : C.sub));
      text.appendChild(titleLine);
      text.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.4;`, opts.detail));
      row.appendChild(text);
      row.appendChild(btn(opts.action, opts.onClick, !opts.on && !!opts.recommended));
      return row;
    };

    const recOn = !s.cssOff && s.headerFix && s.cardPlayFix;
    const presetRow = h("div", "display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;padding:10px 0;");
    const presetText = h("div", "display:flex;flex-direction:column;gap:3px;flex:1 1 320px;min-width:240px;");
    presetText.appendChild(h("div", `font-size:13px;font-weight:600;color:${C.text};`, "Recommended preset"));
    presetText.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.4;`,
      "Turns on the two fixes that measured a clear win: sticky header blur and the Home card button. Rotating cover is opt-in because an installed snippet or theme usually adds it; removing that source is better than overriding it."));
    presetRow.appendChild(presetText);
    if (recOn) {
      presetRow.appendChild(pill("applied", C.green));
    } else {
      presetRow.appendChild(btn("Apply recommended", () => {
        state.headerFix = true;
        state.cardPlayFix = true;
        state.runtimePatch = true;
        state.cssOff = false;
        saveState(state);
        applyInjectedFixes();
        syncRuntimePatches();
        notify("Perf Adviser: recommended fixes applied");
        refresh();
      }, true));
    }
    fixCard.appendChild(presetRow);

    // 1. header blur
    fixCard.appendChild(addToggle({
      title: "Sticky header blur",
      recommended: true,
      on: !!s.headerFix,
      detail: s.headerFix
        ? "Backdrop blur removed and replaced with an opaque theme background. Measured +5.8 fps on top of the card fix."
        : "Spotify's blurred sticky header is active. Removing it measured +5.8 fps on top of the card fix.",
      action: s.headerFix ? "Restore blur" : "Remove blur",
      onClick: () => setFix("headerFix", !s.headerFix, s.headerFix ? "Perf Adviser: header blur restored" : "Perf Adviser: header blur removed"),
    }));

    // 2. Home card play button while scrolling
    fixCard.appendChild(addToggle({
      title: "Home card play button",
      recommended: true,
      on: !!s.cardPlayFix,
      detail: s.cardPlayFix
        ? "Hidden only while scrolling, so its tooltip stops repositioning every frame. Usable at rest; Home only. Measured +38.5 fps median."
        : "Spotify repositions this tooltip on every scroll frame while the pointer rests on a card. Measured a +38.5 fps median gain.",
      action: s.cardPlayFix ? "Show button" : "Hide while scrolling",
      onClick: () => setFix("cardPlayFix", !s.cardPlayFix, s.cardPlayFix ? "Perf Adviser: play button always shown" : "Perf Adviser: play button hidden while scrolling"),
    }));

    // 3. rotating cover art (opt-in; usually added by an installed snippet/theme)
    const coverSrcName = s.coverSource ? s.coverSource.name : "";
    const coverWhere = s.coverSource && s.coverSource.kind === "theme" ? "Marketplace > Themes" : "Marketplace > Snippets";
    fixCard.appendChild(addToggle({
      title: "Rotating cover art (opt-in)",
      on: !!s.coverPause,
      detail: s.coverPause
        ? "Paused by this extension. " + (coverSrcName ? coverSrcName + " adds the rotation; disabling it is the cleaner fix." : "Disabling the snippet/theme that adds the rotation is the cleaner fix.")
        : (s.coverRotating
          ? (coverSrcName
            ? coverSrcName + " rotates .cover-art. Disabling it in " + coverWhere + " removes the cost at the source. Pausing here is only an override; measured +37.1 fps median."
            : "An installed snippet/theme rotates .cover-art. Disabling it is the cleaner fix; pausing here measured +37.1 fps median.")
          : "No rotating cover animation detected right now, so this toggle would do nothing."),
      action: s.coverPause ? "Resume rotation" : "Pause rotation",
      onClick: () => setFix("coverPause", !s.coverPause, s.coverPause ? "Perf Adviser: cover rotation resumed" : "Perf Adviser: cover rotation paused"),
    }));

    // 4. optional cosmetic bundle
    fixCard.appendChild(addToggle({
      title: "Theme tweaks",
      on: !!s.themeTweaks,
      detail: "Cosmetic only: marketplace card border, active-button colour and a 72 px player bar. Not a performance fix; off by default.",
      action: s.themeTweaks ? "Turn off" : "Turn on",
      onClick: () => setFix("themeTweaks", !s.themeTweaks, s.themeTweaks ? "Perf Adviser: theme tweaks off" : "Perf Adviser: theme tweaks on"),
    }));

    // page zoom
    const zoomRow = h("div", "display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;border-top:1px solid rgba(128,128,128,.18);padding:10px 0;");
    const zoomText = h("div", "display:flex;flex-direction:column;gap:3px;flex:1 1 320px;min-width:240px;");
    zoomText.appendChild(h("div", `font-size:13px;color:${C.text};`, "Page zoom"));
    zoomText.appendChild(h("div", `font-size:12px;color:${C.sub};`, "Reset to 100% (fixes the whole-UI-shrink bug; not an fps fix)"));
    zoomRow.appendChild(zoomText);
    if (s.zoom.level != null && s.zoom.level !== 0) {
      zoomRow.appendChild(btn("Reset zoom to 100%", async () => {
        try {
          await Spicetify.Platform.ZoomAPI.setZoomLevel(0);
          notify("Perf Adviser: zoom reset to 100%");
          await sleep(900);
          refresh();
        } catch (e) {
          notify("Perf Adviser: zoom reset failed", true);
        }
      }, true));
    } else {
      zoomRow.appendChild(pill("100%", C.green));
    }
    fixCard.appendChild(zoomRow);

    // master kill switch
    const killRow = h("div", "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid rgba(128,128,128,.18);padding:10px 0;");
    killRow.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.4;flex:1 1 280px;`,
      s.cssOff ? "All injected fixes are off. Nothing is hidden or paused." : "Turn every injected rule off at once (state is kept, so you can switch back)."));
    if (s.cssOff) {
      killRow.appendChild(btn("Enable everything", () => {
        state.cssOff = false;
        saveState(state);
        applyInjectedFixes();
        syncRuntimePatches();
        notify("Perf Adviser: fixes enabled");
        refresh();
      }, true));
    } else {
      killRow.appendChild(btn("Disable all fixes", () => {
        state.cssOff = true;
        saveState(state);
        applyInjectedFixes();
        syncRuntimePatches();
        notify("Perf Adviser: all fixes disabled");
        refresh();
      }));
    }
    fixCard.appendChild(killRow);
    fixes.appendChild(fixCard);
    body.appendChild(fixes);

    // runtime CSS patches (separate: they do not inject any CSS rule)
    const rt = s.runtime || { active: false, parked: 0, live: 0, mirrored: 0 };
    const rtSec = section("Runtime CSS patches");
    const rtCard = h("div", `display:flex;flex-direction:column;gap:0;background:${C.card};border-radius:12px;padding:4px 14px;`);
    const rtRow = h("div", "display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;padding:10px 0;");
    const rtText = h("div", "display:flex;flex-direction:column;gap:3px;flex:1 1 320px;min-width:240px;");
    const rtTitle = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;");
    rtTitle.appendChild(h("div", `font-size:13px;color:${C.text};`, "Park idle :has() rules"));
    rtTitle.appendChild(pill(rt.active ? "on" : "off", rt.active ? C.green : C.sub));
    rtTitle.appendChild(pill(rt.parked + " parked", rt.parked ? C.green : C.sub));
    if (rt.mirrored) rtTitle.appendChild(pill(rt.mirrored + " mirrored", C.blue));
    rtText.appendChild(rtTitle);
    rtText.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.4;`,
      "Chromium treats any live :has() rule as document-wide, so a hover can restyle more than the hovered control. " +
      "This parks rules that match nothing and restores each when its target appears; " +
      "track-peek's two global :has() anchors are mirrored with a class. " +
      "Measured: a wide card hover restyles 951 elements with the rules live and 378 parked; the player bar 938 -> 381. " +
      "Spotify's own card re-render is not removed. " +
      (rt.live ? rt.live + " :has() rule(s) are in use and untouched." : "")));
    rtRow.appendChild(rtText);
    rtRow.appendChild(btn(rt.active ? "Turn off" : "Turn on", () => {
      state.runtimePatch = !state.runtimePatch;
      if (state.runtimePatch && state.cssOff) state.cssOff = false;
      saveState(state);
      applyInjectedFixes();
      syncRuntimePatches();
      notify(state.runtimePatch ? "Perf Adviser: runtime CSS patches on" : "Perf Adviser: runtime CSS patches off");
      refresh();
    }, !rt.active));
    rtCard.appendChild(rtRow);
    rtSec.appendChild(rtCard);
    body.appendChild(rtSec);

    // profiler
    const profile = section("Profile (merged from Perf Tools)");
    const pCard = h("div", `display:flex;flex-direction:column;gap:10px;background:${C.card};border-radius:12px;padding:12px 14px;`);
    const pTop = h("div", "display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;");
    const pText = h("div", "display:flex;flex-direction:column;gap:2px;");
    pText.appendChild(h("div", `font-size:13px;color:${C.text};`, "Attribute cost by extension/script"));
    pText.appendChild(h("div", `font-size:12px;color:${C.sub};`, prof.recording
      ? "Recording - scroll the slow page, then come back and press Stop."
      : "Start, scroll the slow page for ~10 s, then Stop. Wrappers are installed only while recording."));
    pTop.appendChild(pText);
    const pBtns = h("div", "display:flex;gap:8px;flex-wrap:wrap;");
    if (prof.recording) {
      pBtns.appendChild(btn("Stop recording", () => {
        const r = prof.stop();
        last = last || { scan: null, bench: null };
        last.prof = r;
        notify("Perf Adviser: profile finished - " + (r.fps ? r.fps.avg + " fps" : "no frames"));
        refresh();
      }, true));
    } else {
      pBtns.appendChild(btn(p ? "Start again" : "Start recording", () => startProfile(), !p));
      if (p) pBtns.appendChild(btn("Copy JSON", () => copyText(JSON.stringify(p, null, 2))));
    }
    pTop.appendChild(pBtns);
    pCard.appendChild(pTop);

    if (p) {
      const sum = h("div", `font-size:12px;color:${C.sub};border-top:1px solid rgba(128,128,128,.18);padding-top:8px;`,
        (p.recordedMs / 1000).toFixed(1) + " s" + (p.fps ? " - " + p.fps.avg + " fps, p95 " + p.fps.p95 + " ms, " + p.fps.slowPct + "% slow" : "") +
        " - long tasks " + p.longTasks.count + " (max " + p.longTasks.maxMs + " ms)" + (p.loaf ? " - slow frames " + p.loaf.frames : ""));
      pCard.appendChild(sum);
      pCard.appendChild(h("div", `font-size:11px;color:${C.sub};`, "Cost by source (inclusive callback time + forced layout reads)"));
      pCard.appendChild(miniTable(
        ["source", "total ms", "calls", "max ms", "forced"],
        p.sources.slice(0, 10).map((x) => [x.source, x.totalMs, x.calls, x.maxMs, x.forcedCount ? x.forcedMs + " (" + x.forcedCount + ")" : "-"])
      ));
      pCard.appendChild(h("div", `font-size:11px;color:${C.sub};margin-top:4px;`, "Registered since load (intervals / observers / hot listeners)"));
      pCard.appendChild(miniTable(
        ["source", "int", "obs", "broad", "listen"],
        p.inventory.slice(0, 10).map((x) => [x.source, x.interval, x.observer, x.broadObserver, x.listener])
      ));
      if (p.loaf && p.loaf.scripts.length) {
        pCard.appendChild(h("div", `font-size:11px;color:${C.sub};margin-top:4px;`, "Script time by file (browser long-animation-frame data)"));
        pCard.appendChild(miniTable(
          ["file", "script ms", "forced ms", "entries"],
          p.loaf.scripts.map((x) => [x.source, x.ms, x.forcedMs, x.count])
        ));
      }
    }
    profile.appendChild(pCard);
    body.appendChild(profile);

    // ------------------------------------------------ what just lagged? (opt-in)
    const lagSec = section("What just lagged?");
    const lagCard = h("div", `display:flex;flex-direction:column;gap:10px;background:${C.card};border-radius:12px;padding:12px 14px;`);
    const lagTop = h("div", "display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;");
    const lagText = h("div", "display:flex;flex-direction:column;gap:3px;flex:1 1 340px;min-width:260px;");
    const lagTitle = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;");
    lagTitle.appendChild(h("div", `font-size:13px;color:${C.text};`, "Slow-frame recorder"));
    lagTitle.appendChild(pill(state.lagRecorder ? "on" : "off", state.lagRecorder ? C.green : C.sub));
    if (state.lagRecorder) {
      lagTitle.appendChild(pill(lag.mode === "long-animation-frame" ? "script attribution" : lag.mode || "unsupported",
        lag.mode === "long-animation-frame" ? C.green : C.amber));
    }
    lagText.appendChild(lagTitle);
    lagText.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.45;`,
      !state.lagRecorder
        ? "Off. Turn it on before the stutter, then come back here: it keeps the last 30 slow frames with the script file and blocking time for each. In-memory only, no timers, no wrappers, no network."
        : lag.mode === "long-animation-frame"
          ? "On. Newest slow frames first. Clicking anything in Spotify's own UI during the frame can appear as the invoker even when the cost is in another file; read the file column first."
          : lag.mode === "longtask"
            ? "On, but this Spotify build only supports longtask entries: you get duration and the blocking window, not which script ran. Turn it off when you are done."
            : "On, but this build supports neither long-animation-frame nor longtask, so nothing can be recorded."));
    lagTop.appendChild(lagText);
    lagTop.appendChild(btn(state.lagRecorder ? "Turn off" : "Turn on", () => {
      state.lagRecorder = !state.lagRecorder;
      saveState(state);
      lag.sync();
      notify(state.lagRecorder ? "Perf Adviser: recording slow frames" : "Perf Adviser: slow-frame recorder off");
      refresh();
    }, !state.lagRecorder));
    lagCard.appendChild(lagTop);

    if (state.lagRecorder) {
      const recent = lag.entries.slice().reverse().slice(0, 10);
      lagCard.appendChild(h("div", `font-size:11px;color:${C.sub};`, "Slow frames (newest first)" + (lag.dropped ? " - " + lag.dropped + " older dropped" : "")));
      lagCard.appendChild(miniTable(
        ["ago", "frame ms", "blocking", "route", "top script"],
        recent.map((e) => {
          const top = e.scripts.slice().sort((a, b) => b.duration - a.duration)[0];
          return [
            Math.max(0, Math.round((Date.now() - e.at) / 1000)) + "s",
            e.duration,
            e.blocking,
            e.route || "/",
            top ? top.file + " " + top.duration + " ms" : "(no attribution)",
          ];
        })
      ));
      const roll = lag.rollup().slice(0, 8);
      if (roll.length) {
        lagCard.appendChild(h("div", `font-size:11px;color:${C.sub};margin-top:4px;`, "By source (sum of script ms in the buffer)"));
        lagCard.appendChild(miniTable(
          ["file", "script ms", "forced ms", "entries"],
          roll.map((x) => [x.file, +x.ms.toFixed(1), +x.forced.toFixed(1), x.calls])
        ));
      }
      const lagBtns = h("div", "display:flex;gap:8px;justify-content:flex-end;");
      lagBtns.appendChild(btn("Clear", () => { lag.clear(); refresh(); }));
      lagCard.appendChild(lagBtns);
    } else {
      lagCard.appendChild(h("div", `font-size:12px;color:${C.sub};`, "Nothing is being observed. Idle cost while off is zero: no observer, no timer."));
    }
    lagSec.appendChild(lagCard);
    body.appendChild(lagSec);

    // ------------------------------------------------ page navigation timing
    const navSec = section("Page navigation timing");
    const navCard = h("div", `display:flex;flex-direction:column;gap:10px;background:${C.card};border-radius:12px;padding:12px 14px;`);
    const navTop = h("div", "display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;");
    const navText = h("div", "display:flex;flex-direction:column;gap:3px;flex:1 1 340px;min-width:260px;");
    const navTitle = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;");
    navTitle.appendChild(h("div", `font-size:13px;color:${C.text};`, "Route change cost"));
    navTitle.appendChild(pill(state.navTiming ? "on" : "off", state.navTiming ? C.green : C.sub));
    if (state.navTiming && lag.nav.active) navTitle.appendChild(pill("recording " + lag.nav.active.route, C.blue));
    navText.appendChild(navTitle);
    navText.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.45;`,
      !state.navTiming
        ? "Off. When on, each route change starts a 2 s window. Navigation cost = blocking time of the long frames that start in that window + time from the change to the end of the last one. It measures jank after the change, not download or first-paint time."
        : "Cost = settle time (route change to the end of the last long frame that started within 2 s) + the blocking time of those frames. A clean change reads near zero; it is not a page-load timer."));
    navTop.appendChild(navText);
    navTop.appendChild(btn(state.navTiming ? "Turn off" : "Turn on", () => {
      state.navTiming = !state.navTiming;
      saveState(state);
      lag.sync();
      if (state.navTiming) lag.nav.mark();
      notify(state.navTiming ? "Perf Adviser: timing route changes" : "Perf Adviser: route timing off");
      refresh();
    }, !state.navTiming));
    navCard.appendChild(navTop);

    if (state.navTiming) {
      const rows = lag.nav.rows();
      if (rows.length) {
        navCard.appendChild(miniTable(
          ["route", "n", "median ms", "worst ms", "blocking ms", "top source"],
          rows.slice(0, 10).map((r) => [r.route, r.n, r.median, r.worst, r.blocking, r.top])
        ));
      } else {
        navCard.appendChild(h("div", `font-size:12px;color:${C.sub};`, "No completed route change yet. Navigate Home -> Playlist -> Search -> Library -> Home, then reopen this panel."));
      }
      const recent = lag.nav.recent.slice(-5).reverse();
      if (recent.length) {
        navCard.appendChild(h("div", `font-size:11px;color:${C.sub};margin-top:4px;`, "Last route changes (newest first)"));
        navCard.appendChild(miniTable(
          ["route", "frame ms", "blocking", "settle", "cost"],
          recent.map((r) => [r.route, r.frames, r.blocking, r.settle, r.cost])
        ));
      }
      const navBtns = h("div", "display:flex;gap:8px;justify-content:flex-end;");
      navBtns.appendChild(btn("Clear", () => { lag.nav.clear(); refresh(); }));
      navCard.appendChild(navBtns);
    } else {
      navCard.appendChild(h("div", `font-size:12px;color:${C.sub};`, "Idle cost while off is zero: the shared observer is disconnected when both this and the slow-frame recorder are off."));
    }
    navSec.appendChild(navCard);
    body.appendChild(navSec);

    // ------------------------------------------------ selector health
    const selSec = section("Selector health");
    const selCard = h("div", `display:flex;flex-direction:column;gap:10px;background:${C.card};border-radius:12px;padding:12px 14px;`);
    if (health) {
      const stale = health.rows.filter((r) => r.status === "STALE");
      const missing = health.rows.filter((r) => r.status === "NOT SEEN");
      const topLine = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;");
      topLine.appendChild(h("div", `font-size:13px;color:${C.text};`, "Spotify " + health.version));
      topLine.appendChild(pill(health.source, C.sub));
      topLine.appendChild(pill(health.rows.filter((r) => r.status === "OK").length + " OK", C.green));
      if (missing.length) topLine.appendChild(pill(missing.length + " not seen", C.amber));
      if (stale.length) topLine.appendChild(pill(stale.length + " stale", C.red));
      selCard.appendChild(topLine);
      selCard.appendChild(h("div", `font-size:11px;color:${C.sub};line-height:1.45;`,
        "Checked on " + health.route + " when the panel opened. OK = matched on its expected route; N/A here = wrong route, or the extension that owns it is not installed; NOT SEEN = expected here but not matched yet; STALE = matched on an earlier Spotify version, not on this one."));
      selCard.appendChild(miniTable(
        ["item", "selector", "expected", "status"],
        health.rows.map((r) => [
          r.label,
          r.sel.length > 34 ? r.sel.slice(0, 33) + "..." : r.sel,
          r.routes.includes("*") ? "any page" : r.routes.join(", "),
          r.status,
        ])
      ));
      if (stale.length) {
        selCard.appendChild(h("div", `font-size:12px;color:${C.red};line-height:1.45;`,
          "STALE: " + stale.map((r) => r.label).join(", ") + ". Spotify renamed or removed this class, so the matching fix may now silently do nothing. That is a bug report worth filing, not something this extension can repair by itself."));
      }
      if (missing.length) {
        selCard.appendChild(h("div", `font-size:12px;color:${C.amber};line-height:1.45;`,
          "NOT SEEN on this route: " + missing.map((r) => r.label).join(", ") + ". If it stays missing on the route named in the Expected column, the fix cannot apply there."));
      }
    } else {
      selCard.appendChild(h("div", `font-size:12px;color:${C.sub};`, "Selector health unavailable."));
    }
    selSec.appendChild(selCard);
    body.appendChild(selSec);

    // ------------------------------------------------ author check (heuristic)
    const aSec = section("Author check (heuristic)");
    const aCard = h("div", `display:flex;flex-direction:column;gap:10px;background:${C.card};border-radius:12px;padding:12px 14px;`);
    const aTop = h("div", "display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;");
    const aText = h("div", "display:flex;flex-direction:column;gap:3px;flex:1 1 340px;min-width:260px;");
    const aTitle = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;");
    aTitle.appendChild(h("div", `font-size:13px;color:${C.text};`, "Extension author check"));
    aTitle.appendChild(pill(author.enabled ? "author mode on" : "author mode off", author.enabled ? C.green : C.sub));
    aText.appendChild(aTitle);
    aText.appendChild(h("div", `font-size:12px;color:${C.sub};line-height:1.45;`,
      "A fixed Home scroll (" + (AUTHOR.scrollMs / 1000) + " s) plus " + (AUTHOR.idleMs / 1000) + " s idle, then PASS/WARN/FAIL for broad observers, forced reads over " +
      AUTHOR.forcedMs + " ms and callback/interval rates. Heuristic, one machine, not a Spicetify or Marketplace certification. " +
      "Author mode records who registered an interval, a MutationObserver (target and options) and hot listeners; during a check it also times those callbacks, including ones registered at startup. Nothing is timed while idle. It only sees extensions loaded after Perf Adviser."));
    aTop.appendChild(aText);
    if (!state.authorMode && !author.enabled) {
      aTop.appendChild(btn("Turn on Author mode", () => {
        state.authorMode = true;
        saveState(state);
        notify("Perf Adviser: Author mode saved - reload Spotify to install the inventory");
        refresh();
      }, true));
    } else if (state.authorMode && !author.enabled) {
      aTop.appendChild(pill("saved - reload Spotify", C.amber));
    } else if (author.enabled) {
      aTop.appendChild(btn("Turn off (reload)", () => {
        state.authorMode = false;
        saveState(state);
        notify("Perf Adviser: Author mode off - reload Spotify to remove the inventory");
        refresh();
      }));
    }
    aCard.appendChild(aTop);

    aCard.appendChild(h("div", `font-size:11px;color:${C.sub};`,
      "Author mode idle cost: " + author.stats.registrations + " registration(s), " + author.stats.loadMs + " ms of one-off wrapper time at load; while idle each wrapped callback only pays one boolean check, and nothing is timed until a check runs."));

    if (author.enabled) {
      const srcSet = new Set();
      for (const i of author.inventory()) srcSet.add(i.source);
      const pr = (last && last.prof) || prof.report();
      if (pr && pr.sources) for (const x of pr.sources) srcSet.add(x.source);
      const candidates = [...srcSet]
        .filter((x) => !/^(spotify-core|\(unknown\)|\(anonymous\/eval\)|spicetifyWrapper\.js|perf-adviser\.js)$/.test(x))
        .sort();
      if (!authorPick || !candidates.includes(authorPick)) authorPick = candidates[0] || null;

      if (candidates.length) {
        const pickRow = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;");
        const sel = document.createElement("select");
        sel.style.cssText = `background:#1f1f1f;color:${C.text};border:1px solid rgba(128,128,128,.5);border-radius:8px;padding:6px 8px;font-size:12px;max-width:320px;`;
        for (const c of candidates) {
          const opt = document.createElement("option");
          opt.value = c; opt.textContent = c;
          if (c === authorPick) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => { authorPick = sel.value; });
        pickRow.appendChild(h("span", `font-size:12px;color:${C.sub};`, "Source"));
        pickRow.appendChild(sel);
        pickRow.appendChild(btn("Run standard test", () => runAuthorCheck(authorPick), true));
        aCard.appendChild(pickRow);
      } else {
        aCard.appendChild(h("div", `font-size:12px;color:${C.sub};`, "No sources registered yet. Reload with Author mode on, or record a profile first."));
      }

      if (authorCheck) {
        const ac = authorCheck;
        const color = ac.overall === "pass" ? C.green : ac.overall === "warn" ? C.amber : C.red;
        const sum = h("div", "display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid rgba(128,128,128,.18);padding-top:8px;");
        sum.appendChild(h("div", `font-size:13px;color:${C.text};`, "Result for " + ac.source));
        sum.appendChild(pill(ac.overall.toUpperCase(), color));
        sum.appendChild(h("span", `font-size:11px;color:${C.sub};`, ac.at.slice(0, 19).replace("T", " ") + " on " + ac.route));
        aCard.appendChild(sum);
        aCard.appendChild(miniTable(
          ["check", "result", "evidence"],
          ac.checks.map((c) => [c.label, c.result, c.evidence])
        ));
        aCard.appendChild(h("div", `font-size:11px;color:${C.sub};line-height:1.45;`,
          "Thresholds: callback pass < " + AUTHOR.callbackMsPerSec.pass + " ms/s, fail > " + AUTHOR.callbackMsPerSec.warn +
          " ms/s; intervals pass <= " + AUTHOR.intervalsPerSec.pass + "/s, fail > " + AUTHOR.intervalsPerSec.warn +
          "/s; any forced read > " + AUTHOR.forcedMs + " ms fails; any subtree observer on document/body/documentElement fails. " +
          "One machine, one theme, synthetic scroll: treat this as a debugging aid, not a guarantee."));
        const aBtns = h("div", "display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;");
        aBtns.appendChild(btn("Copy JSON", () => copyText(JSON.stringify(ac, null, 2))));
        aBtns.appendChild(btn("Copy badge line", () => copyText("Perf Adviser check: " + ac.overall.toUpperCase() + " - " + ac.source + " - " + ac.at.slice(0, 10) + " (heuristic, one machine)")));
        aCard.appendChild(aBtns);
      }
    } else {
      aCard.appendChild(h("div", `font-size:12px;color:${C.sub};`, "Timing-only results still work without Author mode; startup observers and intervals are invisible until it is on and Spotify is reloaded."));
    }
    aSec.appendChild(aCard);
    body.appendChild(aSec);

    buildBisectPanel(bBody, s);

    // footer
    const foot = h("details", `font-size:11px;color:${C.sub};line-height:1.5;`);
    foot.appendChild(h("summary", "cursor:pointer;", "How it measures / uninstall"));
    foot.appendChild(h("div", "margin-top:6px;",
      "The FPS test scrolls the largest scrollable element for a fixed time and reports median frame rate, p95 frame time, slow frames (>33 ms) and long tasks. " +
      "It runs with this panel closed, does one unmeasured warm-up scroll first, and acknowledges that Home FPS depends on where the mouse rests. " +
      "The profiler wraps timers, animation frames, event listeners and MutationObservers only while recording, then restores them. " +
      "When idle the extension runs no timers, observers or animation frames - just three passive scroll listeners. " +
      "The CSS/animation inventory is read only when the panel is built, never on a timer. " +
      "Uninstall: run \"spicetify config extensions perf-adviser.js-\" then \"spicetify apply -n\" (or delete perf-adviser.js from %APPDATA%\\spicetify\\Extensions and remove it from config-xpui.ini)."
    ));
    body.appendChild(foot);

    Spicetify.PopupModal.display({ title: "Performance Adviser", content: root, isLarge: true });
    panelRoot = root;
    // A rebuild from a measurement, a tab switch or a refresh must not jump the
    // panel back to the top; restore the offset for the tab being shown. The
    // modal may lay out a frame later, so repeat once after layout.
    const restore = () => { root.scrollTop = panelScroll[panelView] || 0; };
    restore();
    try { requestAnimationFrame(() => requestAnimationFrame(restore)); } catch (e) { /* ignore */ }
    skinModal();
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    last = { scan: await scan(), bench: last ? last.bench : null, prof: last ? last.prof : null };
    busy = false;
    showPanel();
  }

  async function runBench(full) {
    if (busy) return;
    busy = true;
    try {
      savePanelScroll();
    try { Spicetify.PopupModal.hide(); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
    notify("Perf Adviser: measuring " + (full ? "2 x 6 s" : "5 s") + " - the page will scroll");
    await sleep(600);
    const b = await benchmark(full ? 6000 : 5000, full ? 2 : 1);
    const s = await scan();
    last = { scan: s, bench: b, prof: last ? last.prof : null };
    busy = false;
    showPanel();
    if (!full) notify("Perf Adviser: click 'Measure again' for a longer, steadier run");
  }

  function startProfile() {
    if (prof.recording) return;
    savePanelScroll(); try { Spicetify.PopupModal.hide(); } catch (e) { /* ignore */ }
    prof.start();
    last = { scan: last ? last.scan : null, bench: last ? last.bench : null, prof: null };
    notify("Perf Adviser: recording - scroll the slow page, then reopen the gauge and press Stop");
  }

  async function openAdviser() {
    if (busy) { notify("Perf Adviser is already measuring"); return; }
    busy = true;
    try {
      const s = await scan();
      if (prof.recording) {
        last = { scan: s, bench: last ? last.bench : null, prof: last ? last.prof : null };
        busy = false;
        showPanel();
        return;
      }
      if (last && (last.bench || last.prof)) {
        last = { scan: s, bench: last.bench, prof: last.prof, when: Date.now() };
        busy = false;
        showPanel();
        return;
      }
      notify("Perf Adviser: measuring (about 7 s)...");
      const b = await benchmark(5000, 1);
      last = { scan: s, bench: b, prof: null, when: Date.now() };
    } finally {
      busy = false;
    }
    showPanel();
  }

  // ------------------------------------------------ keep panel.onopen fresh
  const origShowPanel = showPanel;
  showPanel = function () {
    if (last) last.when = Date.now();
    origShowPanel();
  };

  // ---------------------------------------------------------------- install
  (async function install() {
    for (let i = 0; i < 150 && !(window.Spicetify && Spicetify.PopupModal && (Spicetify.Topbar || Spicetify.Menu)); i++) {
      await sleep(200);
    }
    if (!(window.Spicetify && Spicetify.PopupModal)) return;

    const icon = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 7 7h-1.5A5.5 5.5 0 1 1 8 2.5V1z"/><path d="M8 4.5v4l3 1.5.6-1.3-2.4-1.2V4.5z"/></svg>';
    if (Spicetify.Topbar && Spicetify.Topbar.Button) {
      new Spicetify.Topbar.Button("Perf Adviser", icon, openAdviser);
    } else if (Spicetify.Menu && Spicetify.Menu.Item) {
      new Spicetify.Menu.Item("Perf Adviser", false, openAdviser).register();
    }

    window.__perfAdviser = {
      version: VERSION,
      open: openAdviser,
      scan,
      benchmark,
      profile: { start: prof.start, stop: prof.stop, report: prof.report, get recording() { return prof.recording; } },
      lag: {
        supported: lag.supported,
        get running() { return lag.running; },
        get mode() { return lag.mode; },
        get entries() { return lag.entries; },
        start: lag.start,
        stop: lag.stop,
        clear: lag.clear,
        rollup: lag.rollup,
        nav: {
          get marks() { return lag.nav.marks; },
          get recent() { return lag.nav.recent; },
          rows: lag.nav.rows,
          mark: lag.nav.mark,
          finalize: lag.nav.finalize,
          clear: lag.nav.clear,
        },
      },
      author: {
        // enabled is what the running build installed at load; saved is the
        // toggle. They differ between pressing the toggle and reloading.
        get mode() { return author.enabled; },
        get saved() { return state.authorMode; },
        get stats() { return author.stats; },
        inventory: () => author.inventory(),
        timings: (src) => author.timings(src),
        get result() { return authorCheck; },
        run: (src) => runAuthorCheck(src || authorPick),
        evaluate: (src, profile, scroll) => evaluateAuthor(src, profile, scroll),
        thresholds: AUTHOR,
      },
      bisect: {
        get state() { return bisect ? JSON.parse(JSON.stringify(bisect)) : null; },
        candidates: () => extensionNames(last ? last.scan : null),
        start: () => startBisect(last ? last.scan : null),
        measure: runBisectMeasure,
        reset: () => { resetBisect(); if (last) showPanel(); },
        findAnother: () => findAnotherBisect(last ? last.scan : null),
        report: bisectReportText,
        instruction: bisectInstruction,
        // Scripted control: same decision path with supplied FPS instead of a
        // live scroll. Intended for tests and for replaying saved numbers.
        begin(names) {
          bisect = {
            startedAt: new Date().toISOString(), phase: "baseline", status: "running",
            candidates: (Array.isArray(names) ? names : []).map(String),
            disabled: [], found: [], rounds: [], noiseFloor: 0, calibration: null,
            baseline: null, last: null, pending: null, awaiting: false, note: "",
          };
          saveBisect();
          return JSON.parse(JSON.stringify(bisect));
        },
        apply(fps, mad) {
          if (!bisect) return null;
          bisectStep({ fps: +fps, mad: +mad || 0, at: new Date().toISOString(), runs: 1 });
          saveBisect();
          return JSON.parse(JSON.stringify(bisect));
        },
      },
      cssEditorChars,
      selectorHealth: () => evaluateSelectorHealth(lastMarket),
      getState: () => Object.assign({}, state),
      setState(patch) {
        Object.assign(state, patch || {});
        saveState(state);
        applyInjectedFixes();
        syncRuntimePatches();
        lag.sync();
        return Object.assign({}, state);
      },
      patchInfo: () => ({
        active: patchesActive(),
        parked: runtime.parked.length,
        live: runtime.live,
        mirrored: runtime.mirrored,
        scans: runtime.scans,
        revives: runtime.revives,
        liveOriginals: runtime.parked
          .filter((p) => { try { return p.rule && p.rule.parentStyleSheet && p.rule.selectorText === p.original; } catch (e) { return false; } })
          .map((p) => p.original.slice(0, 100))
          .slice(0, 10),
        preconditions: runtime.precond,
      }),
      removeFixes() {
        state.headerFix = false;
        state.cardPlayFix = false;
        state.coverPause = false;
        state.themeTweaks = false;
        state.runtimePatch = false;
        state.cssOff = true;
        saveState(state);
        applyInjectedFixes();
        syncRuntimePatches();
      },
    };
  })();
})();
