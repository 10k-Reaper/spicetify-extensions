# Spicetify Extensions

A collection of Spicetify extensions maintained by
[10k-Reaper](https://github.com/10k-Reaper). Repository stars are shared by
every extension here; each extension keeps its own install path, README, and
license.

## Extensions

| Extension | What it does | Marketplace name | Manual install |
|---|---|---|---|
| [Performance Adviser](perf-adviser.js) | Measures Spotify UI scroll performance and applies reversible CSS fixes. | Performance Adviser | `spicetify config extensions perf-adviser.js` |
| [Liquid Lyrics Revival](revived/liquid-lyrics-revival/README.md) | Word-by-word synced lyrics, fullscreen lyrics, romanization, and a sidebar card. | Liquid Lyrics Revival | `spicetify config extensions liquid-lyrics-revival.js` |

Both are installed the same way: copy the `.js` file into your Spicetify
`Extensions` folder, add it with `spicetify config extensions <file>`, and run
`spicetify apply`. See each extension's README for details.

## Revived extensions

`revived/` holds community-maintained forks of NMWplays' extensions. Each one is
self-contained, with its own README, preview, `LICENSE`, and `NOTICE.md`.

- **[Liquid Lyrics Revival](revived/liquid-lyrics-revival/README.md)** is a fork
  of [NMWplays/Liquid-Lyrics](https://github.com/NMWplays/Liquid-Lyrics), kept on
  Spicetify and based on the upstream `spicetify` branch (fork commit
  `d5a453d`). The original project, design, and code are by NMW.

Do not install Liquid Lyrics Revival alongside NMW's original
`liquid-lyrics.js`. Both files use the same `window.__liquidLyricsLoaded` guard
and the same storage keys, so whichever loads first wins and the second one does
nothing.

## Licensing

This repository has two license scopes:

- Root-level files (`perf-adviser.js`, the root `README.md`, `manifest.json`,
  `docs/`, `tests/`, and `scripts/`) are MIT-licensed. See [LICENSE](LICENSE).
- `revived/liquid-lyrics-revival/` is AGPL-3.0. See
  [its LICENSE](revived/liquid-lyrics-revival/LICENSE) and
  [NOTICE.md](revived/liquid-lyrics-revival/NOTICE.md).

The scopes are separate works. Do not relicense either one under the other.

---

# Performance Adviser

A single-file Spicetify extension that measures your Spotify UI's scroll performance, finds the installed snippet, theme or extension responsible, and removes the cost with reversible CSS.

![Performance Adviser panel](preview.png)

![Release downloads](https://img.shields.io/github/downloads/10k-Reaper/spicetify-extensions/total?label=release%20downloads)

It does not rewrite Spotify's own JavaScript. Each fix is a separate toggle, and the panel shows the before/after number it measured for that toggle.

**On Home, the recommended preset measured 27.7 → 72.0 fps** (one machine, synthetic scroll — see [Results](#results)). If scrolling your Home page stutters, that is the case this extension targets.

## Features

- **Two independent, recommended fixes**
  - Removes the sticky-header backdrop blur by setting `--header-filters: none` and giving the five header surfaces a theme-coloured background.
  - Hides the Home card play button only while Home scrolls, which stops Spotify from repositioning its tooltip on every scroll frame. Lyrics, playlists and the Library are never affected.
- **Runtime CSS patches.** Parks `:has()` rules that currently match nothing and restores each one when its target appears. It also mirrors track-peek's two global anchors with a class. In our tests, hovering a wide Home card restyled 951 elements with the idle rules live and 378 with them parked. It cannot remove Spotify's own card re-render, which is the remaining hover hitch.
- **Opt-in cover pause.** A rotating `.cover-art` animation is usually added by a snippet you installed, such as Marketplace's [Rotating Cover Art](https://github.com/spicetify/marketplace/blob/main/resources/snippets.json). The panel names the source when it can, because removing the source is the real fix. **Pause rotation** is for people who want to keep the look.
- **Opt-in offscreen-animation pause.** Pauses endless CSS animations only while their element is outside the viewport and resumes them as soon as it scrolls in. Six offscreen ivLyrics background blobs cost 6.4 fps of scroll headroom in testing.
- **Generic detection, no allow-list.** Reads every snippet, theme and extension `<style>` block, counts expensive CSS signals (`:has()`, blur, infinite animations, rule count) and turns the profiler's measured per-script cost into findings.
- **Recommended preset.** One button enables the two CSS fixes plus the runtime CSS patches. Nothing cosmetic and nothing snippet-specific is included.
- **Built-in profiler (Advanced tab).** Record a slow scroll and see callback time attributed by source, forced layout reads, long tasks and long-animation-frame data. Wrappers exist only while recording.
- **Opt-in diagnostics (Advanced tab).** All three are off by default and install nothing while off:
  - **Slow-frame recorder** keeps the last 30 long-animation frames (or long tasks on older clients) with the script files that ran in them, so you can reopen the panel after a hitch.
  - **Route change cost** reports the blocking time of the long frames in the 2 s after each route change. It measures jank, not download or first-paint time.
  - **Author check** is for extension authors: it records who registered a `setInterval`, a `MutationObserver` or a hot-event listener, then runs a fixed Home scroll and reports PASS/WARN/FAIL.
- **Selector health.** A table of the Spotify class names and CSS variables this extension depends on, each marked OK, N/A here, NOT SEEN or STALE, with the detected Spotify version. A Spotify rename shows up as STALE instead of a fix silently doing nothing.
- **Guided bisect (separate tab).** Halves the installed extension list and tells you which half to toggle in Marketplace, comparing every change against a noise band measured by two identical runs. It outlines the cards for the round but never turns an extension on or off itself, and never presses Remove or Install. Snippets and themes are not toggled.
- **A panel that keeps its place.** Report, Bisect and Advanced swap inside the open panel and each keeps its own scroll offset. A **Reload Spotify** button in the header re-runs extensions from disk without `spicetify apply`.
- **Measuring is a button, not a side effect.** Opening the panel only scans. Nothing scrolls and no popup closes until you press **Measure**. The panel reopens when the run ends, with an explanation if the Spotify window was hidden.
- **Plain-language options.** Every switch has a one-sentence explanation and an expandable **What this changes technically** note.
- **Live environment scan.** Marketplace extensions and snippets, the active theme, active backdrop-filter surfaces, the heaviest CSS sources ranked by cost signals, infinite-animation counts per source, and page zoom.
- **Pause all fixes.** One switch at the top of the fixes card turns off every injected rule and runtime patch at once, keeps your individual choices, and shows a `paused` label next to each fix until you resume.
- **No network, no file edits.** It makes no network requests and never writes files or changes installed extensions.
- **What it changes.** In-memory CSS; the selectors of loaded `:has()` rules (restored when their target appears); its saved choices, bisect run and selector-health history in `localStorage`; and, only when you press the button, Spotify's page zoom. With the offscreen switch on it also adds one class to elements whose endless animation is outside the viewport. With Author mode on (after a reload) it wraps `setInterval`, `MutationObserver` and `addEventListener` globally to attribute registrations, which costs one boolean check per wrapped callback while idle.

## Install

### Spicetify Marketplace (recommended)

1. Open **Marketplace → Extensions**.
2. Search for **Performance Adviser** and install it.
3. Restart Spotify when prompted.

### Manually

1. Download [`perf-adviser.js`](https://github.com/10k-Reaper/spicetify-extensions/releases/download/v1.1.0/perf-adviser.js) from the [v1.1.0 release](https://github.com/10k-Reaper/spicetify-extensions/releases/tag/v1.1.0) (or `gh release download v1.1.0 -R 10k-Reaper/spicetify-extensions`).
2. Copy it into your Spicetify extensions folder:
   - Windows: `%APPDATA%\spicetify\Extensions\`
   - Linux/macOS: `~/.config/spicetify/Extensions/`
3. Add it to the extensions list and apply:

   ```sh
   spicetify config extensions perf-adviser.js
   spicetify apply -n
   ```

   The command appends `perf-adviser.js` to the list, or creates the line if none exists. Extension order does not change the CSS fixes: they use `!important` and the patch engine rescans every loaded stylesheet. Order **does** matter for **Author mode**, which can only inventory and time extensions loaded *after* Perf Adviser; put `perf-adviser.js` first if you want to check another extension. Everything else works in any order.
4. Restart Spotify.

> The badge at the top counts **release-asset downloads only**: people who fetch `perf-adviser.js` directly. Marketplace installs are served through jsDelivr, so GitHub never sees them. Read it as a manual-download count, not an install count.

> Installing by hand works exactly like a Marketplace install, with one difference: Marketplace only lists extensions **it** installed. A manual install runs normally but does not appear under **Installed**, and Marketplace will not offer to remove or update it. Use the Marketplace route above if you want it in that list.

## Usage

1. Click the **Perf Adviser** icon in the top bar (the clock badge). Opening it scans; it does not measure.
2. Read the score card: the first time it shows `--` and asks you to press **Measure** for a 5 s run. **Measure again** runs two longer 6 s runs. The panel closes itself for the run because an open popup costs frames, and reopens when the run ends.
3. The findings block under the score lists live evidence: an active header blur, a running animation with the snippet/theme that declares it, CSS blocks with heavy selector counts, or the measured sources from your last profile.
4. Use the toggles under **Fixes you can try**. Each one applies or removes its CSS immediately and is stored in `localStorage`. Every toggle has a short explanation and a **What this changes technically** note you can expand.
5. To compare against unmodified Spotify, press **Pause all fixes** at the top of that card; **Resume all fixes** puts back exactly the switches you had chosen.
6. Open the **Advanced** tab for the deeper diagnostics: **Attribute cost** (profiler), **Slow-frame recorder**, **Route change cost** and **Extension author check**. Turn on the recorders before the hitch or page change you want to catch; leave them off when you are not debugging, because while off they install no observer.
7. **Selector health** is at the bottom of the **Report** tab and needs no toggle. It compares this build's selectors with the current page and the Spotify version; **STALE** means Spotify renamed something.
8. **Bisect** is its own tab. It walks you through toggling half the installed extensions in Marketplace, reloading and measuring. **Open Marketplace → Installed** jumps to that page and outlines the cards for the round; an enable round opens **Extensions** instead, because Marketplace moves a removed extension's card there. If Marketplace collapses its tabs into a **More** menu, the round switches tabs through it. It never changes an extension itself.
9. Extension authors: open the **Advanced** tab and turn **Author mode** on, read the three steps in the card, press **Reload Spotify** when the panel says a reload is pending, then press **Author check** on a source. The card explains what to do in plain language and keeps the mechanics, thresholds and wrapper costs inside **How this works technically**.
10. If you want a starting point, press **Apply recommended**.
11. If the interface looks shrunken after backgrounding, press **Reset zoom to 100%** under **Page zoom**. This is a display fix, not an FPS fix.
12. For a specific slow page, open **Advanced** and press **Start recording**, scroll for about ten seconds, then reopen the panel and press **Stop recording**. The profile names the extension or script that owns the cost.

If you change an extension file by hand, the header's **Reload Spotify** button re-runs extensions from disk. It cannot pick up config changes made by `spicetify apply`; for those, restart Spotify.

## Settings

| Setting | Default | What it does | Risk |
|---|---|---|---|
| Sticky header blur | On | Sets `--header-filters: none` and gives the five sticky header surfaces the theme's surface colour as a solid background. Removes the per-frame re-blur while content scrolls behind them. | The header loses its frosted look. Themes that intentionally use a translucent header will look different, and themes that hard-code the filter ignore the variable. |
| Home card play button | On | Puts the scroll class on `[data-testid="home-page"]` and hides `.main-card-PlayButtonContainer` only while Home scrolls, which stops the tooltip from being repositioned every frame. Scrolling lyrics, a playlist or the Library never adds it. | The button disappears during a Home scroll and returns when you stop. Marketplace install/remove buttons use the same class and are **not** affected. |
| Rotating cover art (opt-in) | Off | Pauses animations on `.cover-art` and the now-playing cover pseudo-elements, keeping the circular crop. When it can identify the source, the panel names the snippet/theme that declares the animation. | If a theme or snippet rotates the cover on purpose and you want to keep it, leave this off. |
| Offscreen animations (opt-in) | Off | Uses an `IntersectionObserver` to pause endless CSS animations while their element is outside the viewport and resume them on the way in. Measured **+6.4 fps** median on Home (six paired runs) with six ivLyrics blobs animating 1,700 px below the viewport. | Decorative motion stops while it is offscreen and restarts when scrolled into view. The element list is refreshed when you enable it, 1.5 s and 5 s later, on route changes and when the panel opens - not continuously, so an animation started later in the same view is noticed at the next refresh. |
| Theme tweaks | Off | Cosmetic bundle: a 2 px purple border on Marketplace installed cards, a `#7b3bff` active-button colour and a 72 px player bar. The border and variable use `!important` and `:root:root` because Marketplace's route CSS and `colors.css` are injected later at equal specificity. Not a performance fix. | Purely visual and theme-specific. Never part of the recommended preset. |
| Runtime CSS patches | On | Mirrors the two `track-peek` global `:has()` anchors with a class and parks other `:has()` rules that currently match nothing, restoring each one when its target appears. Rules that depend on interaction state (`:hover`, `:focus`, `:focus-visible`, `:focus-within`, `:active`, `:target`, `:visited`) are never parked, because they cannot wait for a rescan. | Other rules that are in use are never touched. A parked rule comes back in well under a second. If a menu or dialog looks wrong, pause all fixes and report the selector. |
| Slow-frame recorder | Off | Keeps the last 30 long-animation frames (long tasks as a fallback) with their script files, blocking time and route. While off it installs no observer. | A short in-memory ring buffer. It records only while the switch is on; nothing is sent anywhere. |
| Route change cost | Off | Times each route change over a 2 s window: blocking time of the long frames that start inside it plus settle time to the end of the last one. Shares the slow-frame observer. | A heuristic for jank after navigation; clean changes read near zero. It needs `Spicetify.Platform.History.listen`; the panel says if that never attached. |
| Author mode | Off | For extension authors: records which extension registered a `setInterval`, a `MutationObserver` (target and options) or a hot-event listener, and times those callbacks during an author check. The card gives the three usage steps first; thresholds and wrapper costs are inside its expandable note. | Only sees extensions loaded after Perf Adviser (see Install, step 3). While idle each wrapped callback pays one boolean check; nothing is timed until a check runs. |
| Page zoom | 100% | Shows the current zoom. When it is not 100%, offers **Reset zoom to 100%**, which fixes the whole-UI-shrink bug after backgrounding. | Changes Spotify's page-zoom setting; this is the only Spotify setting the extension can change, and only when you press the button. |
| Pause all fixes | Off | One switch at the top of the fixes card. It removes every injected rule, makes the runtime patches inactive, stops the Home scroll class and disconnects the offscreen-animation observer, while keeping every individual choice. **Resume all fixes** restores the same combination. | None. It only removes rules and classes this extension added; Spotify itself is unchanged. |

The panel remembers your choices in `localStorage["perf-adviser:state"]`. Selector health is a read-only table; the guided bisect stores its run in `localStorage["perf-adviser:bisect"]` so a reload does not lose it.

## Results

The package is tuned for the common case: a blurred theme (Lucid) on Home. In a test where the pointer rested on a Home card and the Rotating Cover Art snippet was installed, the recommended preset measured **27.7 → 72.0 fps (+44.3 fps, 2.6×)**; the card-button fix alone accounted for most of it. Those are synthetic scroll numbers from one machine, and your client may differ.

Full tables and caveats - scroll, hover/`:has()`, idle overhead - are in [docs/MEASUREMENTS.md](https://github.com/10k-Reaper/spicetify-extensions/blob/main/docs/MEASUREMENTS.md).

## Compatibility

| Component | Tested |
|---|---|
| Spotify | 1.3.9.2055, 1.3.10.2586 (the panel shows your version under **Selector health**) |
| Spicetify | 2.46.4, 2.46.7 |
| OS | Windows 11 |
| Marketplace | Extensions tab, install and remove |

**Untested on Linux/macOS.** The manual install paths are listed above, but no behaviour was measured there.

The fixes target Spotify class names and CSS variables (`--header-filters`, `.main-topBar-background`, `.main-home-filterChipsSection`, `[data-testid="home-page"]`, `.main-card-PlayButtonContainer`, `.cover-art`). Spotify UI updates can rename them; if that happens, the Environment section reports no active blur or no rotating cover, and the matching fix simply does nothing.

The runtime patch knows only two selectors by name - track-peek's two global `:has()` anchors. Everything else is discovered generically from the loaded stylesheets, so a Spotify class rename does not break it; at worst a rule is parked while its target is absent.

## Known limitations

- **It cannot speed up Spotify's own JavaScript.** Tracklist re-renders, network work and Spotify's React tree are outside its reach. For large playlists, record a profile and test disabling the heavy third-party extensions it names.
- The header fix only works when the theme applies `backdrop-filter` through `--header-filters` (Lucid does). A theme that hard-codes the filter ignores the variable.
- CSS counts (`:has()`, blur, rule count) are **signals**, not measured fps. Only the profiler attributes real main-thread time.
- **Runtime patches are CSS-only.** They cannot make Spotify's JavaScript faster, and they only park `:has()` rules that match nothing. Rules that depend on interaction state (listed under Runtime CSS patches in Settings) are excluded on purpose, because parking them broke Library hover. The behaviour depends on how Chromium's `:has()` invalidation works today (measured on Chromium 151); if a future version removes the cost, the patch becomes unnecessary rather than harmful.
- The tooltip fix is Home-specific by design. Applying it globally would also hide Marketplace install/remove buttons, which reuse the same container class.
- **Measure needs a visible window.** A hidden or minimized Spotify window stops delivering animation frames, so there is nothing to average. The run aborts after about 1.5 s, keeps your previous result, reopens the panel and says why.
- **Offscreen animations are collected at moments, not continuously.** The refresh points are listed under Offscreen animations in Settings. An animation that a script starts between two refreshes keeps running until the next one. Watching continuously would need a dedicated `MutationObserver`, which this switch deliberately does not add.
- **The new diagnostics are heuristics.** Author check thresholds (callback ms/s, intervals/s) come from a handful of measured extensions on one machine; they flag a smell, not a proven frame cost. A broad body observer with a zero measured callback still fails the observer check, because the registration is the risk. The bisect assumes every listed extension starts enabled, needs a reload per Marketplace toggle, finds one culprit per run, and can only say **inconclusive** when the cost needs a combination of extensions. Snippets and themes are not toggled by it. The **Open Marketplace → Installed** shortcut matches the Marketplace manifest name against the card titles; an extension installed by hand has no card there, so the banner lists it as not found instead.
- **Route change cost measures jank after a route change, not page load.** A quiet change reads near zero. Without `Spicetify.Platform.History.listen` it records nothing and the panel says so.
- **Selector health knows only the selectors this build uses.** A new Spotify rename outside that registry will not be listed; the matching fix simply does nothing.
- **The slow-frame recorder is not a DevTools trace.** It buffers 30 long-animation frames (or long tasks on clients without LoAF) and their script attribution. Longer or more detailed investigations still need the profiler or DevTools.

## Troubleshooting

| Symptom | Check |
|---|---|
| No Perf Adviser icon in the top bar | Is `perf-adviser.js` listed in `extensions`? Run `spicetify apply -n` and restart Spotify. Without top-bar buttons, use the **Perf Adviser** menu item. |
| Panel opens but a fix does nothing | Check the Environment section: no blur or no rotation means there is nothing to remove on that page/theme. |
| Header is still blurred | Another extension or the theme may re-apply `backdrop-filter` with higher specificity. Report the case with **Copy report**. |
| FPS looks low right after opening | Press **Measure** for a stable run. Home lazy-loads shelves, so let the page settle and keep the pointer off the card grid. |
| Measure does nothing or the panel stays closed | Keep the Spotify window visible (see Known limitations). The panel reopens with a message instead of a number. |
| The Perf Adviser panel does not appear at all | Make sure only one copy is installed. A manual copy plus a Marketplace copy load two instances; keep one, then restart Spotify. |
| Cover is frozen and you want it back | Turn off **Rotating cover art (opt-in)**. |
| The purple installed-card border does not show | Turn **Theme tweaks** on, then reopen Marketplace → Installed. If a theme or snippet also sets that border with `!important`, it still wins; report the computed rule. |
| Bisect names something it could not find | The names come from the Marketplace manifest. Extensions installed by hand have no card, so toggle those where they live; the banner lists every name it could not outline. An enable round looks in **Installed** and then in **Extensions**, where Marketplace keeps a removed extension. |
| An offscreen animation still runs | The switch only finds animations that exist at its refresh points (see Settings). Reopen the panel on that page to refresh the list. |
| A menu or dialog looks wrong after enabling patches | Press **Pause all fixes**, then report the dialog with the **Copy report** text. |
| Not sure what to disable | Open the CSS signals table under **(signals)**, then record a profile on the slow page from the **Advanced** tab. Any source that used 250 ms or more appears in the findings block at the top of the **Report** tab. |
| Something else looks wrong | Press **Pause all fixes**, then report the issue with the **Copy report** text and your Spotify/Spicetify versions. |

Uninstall in one line:

```sh
spicetify config extensions perf-adviser.js- && spicetify apply -n
```

Then delete `perf-adviser.js` from your Spicetify extensions folder if you wish.

## Contributing

Issues and pull requests are welcome. A useful bug report includes:

- Spotify and Spicetify versions;
- whether each recommended fix was on, and whether the opt-in cover pause was on;
- the **Copy report** text from the panel;
- what page was being scrolled and where the pointer was.

The extension must stay self-contained: one `.js` file, no build step, no remote code, no network requests.

## License

[MIT](LICENSE)
