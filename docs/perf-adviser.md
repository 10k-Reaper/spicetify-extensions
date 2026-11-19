# Performance Adviser

A single-file Spicetify extension that measures your Spotify UI's scroll performance, finds the installed snippet, theme or extension responsible, and removes the cost with reversible CSS.

![Performance Adviser panel](../preview.png)

![Release downloads](https://img.shields.io/github/downloads/10k-Reaper/spicetify-extensions/total?label=release%20downloads)

It does not rewrite Spotify's own JavaScript. Each fix is a separate toggle, and the panel shows the before/after number it measured for that toggle.

**On Home, the recommended preset measured 27.7 → 72.0 fps** (one machine, synthetic scroll — see [Results](#results)). If scrolling your Home page stutters, that is the case this extension targets.

## Features

- **Two independent recommended fixes.** Removes the sticky-header backdrop blur and hides the Home card play button while Home scrolls.
- **Runtime CSS patches.** Parks `:has()` rules that match nothing and restores each one when its target appears.
- **Opt-in cover pause.** Pauses a rotating `.cover-art` animation and names the snippet or theme that declares it.
- **Opt-in offscreen-animation pause.** Pauses endless CSS animations only while their element is outside the viewport.
- **Generic detection, no allow-list.** Reads every loaded snippet, theme and extension `<style>` block, counts `:has()`, blur, infinite animations and rule count, and turns the profiler's measured per-script cost into findings.
- **Recommended preset.** Enables the two CSS fixes plus the runtime CSS patches; nothing cosmetic or snippet-specific.
- **Built-in profiler.** Attributes callback time, forced layout reads, long tasks and long-animation-frame data; wrappers exist only while recording.
- **Opt-in diagnostics.** Slow-frame recorder, route change cost and author check; all three are off by default and install nothing while off.
- **Selector health.** Marks this build's class and variable dependencies OK, N/A here, NOT SEEN or STALE, with the detected Spotify version.
- **Guided bisect.** Halves the installed extension list and names the culprit; it never toggles anything itself.
- **A panel that keeps its place.** Tabs keep their scroll offsets, and **Reload Spotify** re-runs extensions from disk.
- **Measuring is a button.** Opening the panel only scans; nothing scrolls and no popup closes until you press **Measure**.
- **Plain-language options.** Every switch has a one-sentence explanation and an expandable technical note.
- **Live environment scan.** Lists extensions, snippets, theme, blur surfaces, heavy CSS sources, infinite-animation counts and page zoom.
- **No network, no file edits.** No requests, no file writes, and no changes to installed extensions.
- **What it changes.** In-memory CSS, saved choices and history in `localStorage`, and page zoom only when you press the button.

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
5. To compare against unmodified Spotify, press **Pause all fixes** at the top of that card; **Resume all fixes** puts back exactly the switches you had chosen. Pausing only turns the effects off: the top-bar icon and the panel stay available, including after a reload.
6. If you want a starting point, press **Apply recommended**.
7. If the interface looks shrunken after backgrounding, press **Reset zoom to 100%** under **Page zoom**. This is a display fix, not an FPS fix.
8. For a specific slow page, open **Advanced** and press **Start recording**, scroll for about ten seconds, then reopen the panel and press **Stop recording**. The profile names the extension or script that owns the cost.

If you change an extension file by hand, the header's **Reload Spotify** button re-runs extensions from disk. It cannot pick up config changes made by `spicetify apply`; for those, restart Spotify.

## Advanced

- **Diagnostics.** The **Advanced** tab holds **Attribute cost** (profiler), **Slow-frame recorder**, **Route change cost** and **Extension author check**. Turn on a recorder before the hitch or page change you want to catch; leave it off when you are not debugging, because while off it installs no observer.
- **Selector health.** At the bottom of the **Report** tab and with no toggle, it compares this build's selectors with the current page and the Spotify version; **STALE** means Spotify renamed something.
- **Bisect.** Its own tab walks you through toggling half the installed extensions in Marketplace, reloading and measuring, and compares every change against a noise band measured by two identical runs. **Open Marketplace → Installed** jumps to that page and outlines the cards for the round; an enable round opens **Extensions** instead, because Marketplace moves a removed extension's card there. If Marketplace collapses its tabs into a **More** menu, the round switches tabs through it. While a round is waiting, it hides Marketplace's own reload prompt and shows a note above the player bar with its own **Reload Spotify** button, so reload only after every outlined card is changed. It never turns an extension on or off itself, and never presses Remove or Install.
- **Author mode.** Extension authors turn it on in **Advanced**, read the three steps in the card, press **Reload Spotify** when the panel says a reload is pending, then press **Author check** on a source. Mechanics, thresholds and wrapper costs are inside **How this works technically**.

## Settings

| Setting | Default | What it does | Risk |
|---|---|---|---|
| Sticky header blur | On | Sets `--header-filters: none` and gives the five sticky header surfaces the theme's surface colour as a solid background. Removes the per-frame re-blur while content scrolls behind them. | The header loses its frosted look. Themes that intentionally use a translucent header will look different, and themes that hard-code the filter ignore the variable. |
| Home card play button | On | Puts the scroll class on `[data-testid="home-page"]` and hides `.main-card-PlayButtonContainer` only while Home scrolls, which stops the tooltip from being repositioned every frame. Scrolling lyrics, a playlist or the Library never adds it. | The button disappears during a Home scroll and returns when you stop. Marketplace install/remove buttons use the same class and are **not** affected. |
| Rotating cover art (opt-in) | Off | A rotating `.cover-art` animation is usually added by a snippet you installed, such as Marketplace's [Rotating Cover Art](https://github.com/spicetify/marketplace/blob/main/resources/snippets.json); removing the source is the real fix. This switch pauses animations on `.cover-art` and the now-playing cover pseudo-elements, keeping the circular crop, and names the snippet/theme that declares the animation when it can. | If a theme or snippet rotates the cover on purpose and you want to keep it, leave this off. |
| Offscreen animations (opt-in) | Off | Uses an `IntersectionObserver` to pause endless CSS animations while their element is outside the viewport and resume them on the way in, adding one class to those elements. Measured **+6.4 fps** median on Home (six paired runs) with six ivLyrics blobs animating 1,700 px below the viewport. | Decorative motion stops while it is offscreen and restarts when scrolled into view. The element list is refreshed when you enable it, 1.5 s and 5 s later, on route changes and when the panel opens - not continuously, so an animation started later in the same view is noticed at the next refresh. |
| Theme tweaks | Off | Cosmetic bundle: a 2 px purple border on Marketplace installed cards, a `#7b3bff` active-button colour and a 72 px player bar. The border and variable use `!important` and `:root:root` because Marketplace's route CSS and `colors.css` are injected later at equal specificity. Not a performance fix. | Purely visual and theme-specific. Never part of the recommended preset. |
| Runtime CSS patches | On | Mirrors the two `track-peek` global `:has()` anchors with a class and parks other `:has()` rules that currently match nothing, restoring each one when its target appears. Rules that depend on interaction state (`:hover`, `:focus`, `:focus-visible`, `:focus-within`, `:active`, `:target`, `:visited`) are never parked, because they cannot wait for a rescan. In our tests, hovering a wide Home card restyled 951 elements with the idle rules live and 378 with them parked. It cannot remove Spotify's own card re-render, which is the remaining hover hitch. | Other rules that are in use are never touched. A parked rule comes back in well under a second. If a menu or dialog looks wrong, pause all fixes and report the selector. |
| Slow-frame recorder | Off | Keeps the last 30 long-animation frames (long tasks as a fallback) with their script files, blocking time and route. While off it installs no observer. | A short in-memory ring buffer. It records only while the switch is on; nothing is sent anywhere. |
| Route change cost | Off | Times each route change over a 2 s window: blocking time of the long frames that start inside it plus settle time to the end of the last one. Shares the slow-frame observer. | A heuristic for jank after navigation; clean changes read near zero. It measures jank, not download or first-paint time. It needs `Spicetify.Platform.History.listen`; the panel says if that never attached. |
| Author mode | Off | For extension authors: records which extension registered a `setInterval`, a `MutationObserver` (target and options) or a hot-event listener, times those callbacks during a fixed Home scroll, and reports PASS/WARN/FAIL. The card gives the three usage steps first; thresholds and wrapper costs are inside its expandable note. | Only sees extensions loaded after Perf Adviser (see Install, step 3). While idle each wrapped callback pays one boolean check; nothing is timed until a check runs. |
| Page zoom | 100% | Shows the current zoom. When it is not 100%, offers **Reset zoom to 100%**, which fixes the whole-UI-shrink bug after backgrounding. | Changes Spotify's page-zoom setting; this is the only Spotify setting the extension can change, and only when you press the button. |
| Pause all fixes | Off | One switch at the top of the fixes card. It removes every injected rule, makes the runtime patches inactive, stops the Home scroll class and disconnects the offscreen-animation observer, while keeping every individual choice. The icon and panel stay available, and a paused banner in every tab offers **Resume all fixes**, which restores the same combination. | None. It only removes rules and classes this extension added; Spotify itself is unchanged. |

The panel remembers your choices in `localStorage["perf-adviser:state"]`. Selector health is a read-only table; the guided bisect stores its run in `localStorage["perf-adviser:bisect"]` so a reload does not lose it.

## Results

The package is tuned for the common case: a blurred theme (Lucid) on Home. In a test where the pointer rested on a Home card and the Rotating Cover Art snippet was installed, the recommended preset measured **27.7 → 72.0 fps (+44.3 fps, 2.6×)**; the card-button fix alone accounted for most of it. Those are synthetic scroll numbers from one machine, and your client may differ.

Full tables and caveats - scroll, hover/`:has()`, idle overhead - are in [docs/MEASUREMENTS.md](MEASUREMENTS.md).

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
- CSS counts (`:has()`, blur, rule count) are **signals**, not measured fps. Only the profiler attributes real main-thread time.
- **Runtime patches depend on Chromium's `:has()` invalidation** (measured on Chromium 151). If a future version removes that cost, the patch becomes unnecessary rather than harmful.
- The tooltip fix is Home-specific by design. Applying it globally would also hide Marketplace install/remove buttons, which reuse the same container class.
- **Measure needs a visible window.** A hidden or minimized Spotify window stops delivering animation frames, so there is nothing to average. The run aborts after about 1.5 s, keeps your previous result, reopens the panel and says why.
- **Offscreen animations are collected at moments, not continuously.** An animation that a script starts between two refreshes keeps running until the next one. Watching continuously would need a dedicated `MutationObserver`, which this switch deliberately does not add.
- **The new diagnostics are heuristics.** Author check thresholds (callback ms/s, intervals/s) come from a handful of measured extensions on one machine; they flag a smell, not a proven frame cost. A broad body observer with a zero measured callback still fails the observer check, because the registration is the risk. The bisect assumes every listed extension starts enabled, needs a reload per Marketplace toggle, finds one culprit per run, and can only say **inconclusive** when the cost needs a combination of extensions. Snippets and themes are not toggled by it. The **Open Marketplace → Installed** shortcut matches the Marketplace manifest name against the card titles; an extension installed by hand has no card there, so the banner lists it as not found instead.
- **Selector health knows only the selectors this build uses.** A new Spotify rename outside that registry will not be listed; the matching fix simply does nothing.
- **The slow-frame recorder is not a DevTools trace.** Longer or more detailed investigations still need the profiler or DevTools.

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

Performance Adviser is MIT-licensed. See the root [LICENSE](../LICENSE).
