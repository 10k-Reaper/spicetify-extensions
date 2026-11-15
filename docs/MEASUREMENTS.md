# Measurements

All numbers below were taken on one machine, with the extension loaded in the
user's normal Spicetify setup. They are medians of paired or interleaved runs,
not absolute promises: your hardware, theme and installed snippets will change
the result. The panel measures your own client.

Test conditions unless noted otherwise: Windows 11, Spotify **1.3.8.620**
(Chromium 151), Spicetify **2.46.4**, Lucid theme, 1922 x 1080 viewport, 8 s
synthetic scroll of Home, pointer parked on a card play button with its tooltip
mounted, three interleaved rounds in one session.

## Scroll performance

| Active fixes | Median FPS | p95 frame | Slow frames (>33 ms) | Tooltip style writes / 8 s | Long tasks / 8 s |
|---|---|---|---|---|---|
| None | 27.7 | 138.9 ms | 23.9 % | 1,331 | 47 |
| Header blur only | 29.2 | 138.9 ms | 21.8 % | 1,252 | 45 |
| Card button only | 66.2 | 20.9 ms | 3.4 % | 386 | 12 |
| Rotating cover only | 33.5 | 131.9 ms | 18.3 % | 1,345 | 45 |
| Header + card | 72.0 | 20.9 ms | 3.3 % | 387 | 13 |
| Header + card + cover pause (opt-in) | 104.8 | 14.0 ms | 2.1 % | 388 | 12 |

In that scenario - pointer resting on a Home card, rotating-cover snippet
installed - the recommended preset's header + card row measured **+44.3 fps
(2.6x)** over no fixes.

What the table means:

- The card-button fix is the largest single win here: it cuts tooltip style
  writes from ~1,331 to ~386 per 8 s and long tasks from 47 to 12.
- The cover pause adds most of its gain **after** the card fix (+32.8 fps on top
  of header + card), because the tooltip churn otherwise hides it. On its own it
  measured only +5.8 fps.
- The header fix is small on its own (+1.5 fps, within noise) but adds +5.8 fps
  on top of the card fix. It stays in the preset because it is low risk and
  fixes the visible ghosting of scrolling content through the header.
- The rotation in this test came from the **Rotating Cover Art** snippet, not
  from Spotify. Disabling that snippet removes the same cost without the
  override; the toggle is a fallback.

A separate paired test with the card fix already on measured **+37.1 fps**
(median) when the rotating cover was paused.

## Hover cost and idle `:has()` rules

Hover numbers are easy to misattribute. If the pointer enters a control from a
different region - the player bar, another shelf - Chromium first clears that
region's hover state and restyles the page. The result then describes the
region change, not the control. The protocol here parks the pointer at a
nearby non-interactive point outside the target, waits, then enters. Each row
is a median of three rounds in one session, runtime patch on vs off, with the
**Made for you** shelf in view.

| Target | Runtime patch on | Runtime patch off |
|---|---|---|
| **Made for you** card title | 378 elements, ~80 ms | 951 elements, ~195 ms |
| Player bar play/pause | 381 elements, ~80 ms | 938 elements, ~162 ms |
| Top-bar icon | 7 elements, ~49 ms | 7 elements, ~68 ms |
| Home filter chip | 4 elements, ~63 ms | 4 elements, ~64 ms |
| Shelf heading | 3 elements, ~60 ms | 3 elements, ~61 ms |
| "Show all" | 3 elements, ~49 ms | 3 elements, ~65 ms |

"Elements" is the largest style recalculation in the hover trace and is the
stable column. The millisecond figure is all style time in the same window and
moves with Spotify's cover animations, so compare it only within a row. The
whole table is one page and one session; a quieter or busier Home changes the
counts a little.

What this means:

- A top-bar icon, a filter chip, a shelf heading and **Show all** were never
  the problem: their hovers restyle 3-7 elements.
- The expensive hovers are the wide card box and the player bar. Parking idle
  `:has()` rules cuts their restyle scope by about 2.5x (951 -> 378 and
  938 -> 381). It does **not** remove the hitch: entering a card still runs one
  main-thread task over 40 ms (~50 ms in the profile) and a ~40 ms layout
  pass, with the patch on or off. The extension's own script time in these
  traces is 0.2-2 ms.
- The trigger is the card box, not the title text. Entering the title and
  entering a blank part of the same card produce the same ~377-element restyle
  and the same task, so moving the hover effect to a narrower target does not
  help.

A realistic sweep across three card titles and the shelf heading (two rounds
per sweep, ~206 frames) still shows the residual:

| Runtime patch | p95 frame | Worst frame | Frames >33 ms | Frames >50 ms |
|---|---|---|---|---|
| On | 27.7-34.7 ms | 76-90 ms | 6-13 | 6 |
| Off | 55.5 ms | 118 ms | 17-20 | 8-10 |

The patch roughly halves the number of slow frames, but it cannot make a card
enter smooth, because the remaining cost is Spotify's own card-hover
re-render. Nine CSS-only candidates were measured and rejected: rewriting
`:hover > *` (five variants), parking all 141 hover-combinator rules,
containment on the shelf/grid/card/tippy roots, `content-visibility` on cards,
blocking the cover videos, and pausing the rotating-cover animation. None
changed the frames or the task.

With the patch on, 160-162 idle `:has()` rules are parked and 11-12 stay live
because they currently match, including the empty-search-field rule. The
engine's scans settle at 11-12 in the first ~10 s and then stay flat. The
track-peek mirror rewrites its two global anchors to classes; it was verified
by selector inspection, not end to end, because track-peek itself was failing
in that session (see the report).

**Retraction.** Earlier versions of this page reported 118-160 ms of style
recalc for one top-bar hover, falling to 83-93 ms with the patch, a
1,050-1,100-element restyle, and a 4 s top-bar sweep of 563-649 ms. Those
figures came from starting the pointer on the player bar; they measured the
region change, not the icon, and are retracted. The earlier "card hover worst
frame ~49 ms, 7 ms with the patch" claim is retracted too: with the corrected
protocol the card hitch is still there with the patch on.

## Idle overhead

With the extension loaded but every fix off (kill switch on), versus a reload
where the extension file was blocked at the network layer, 45 s idle windows,
three alternating pairs:

| State | Script time / 45 s | Task time / 45 s | Style time / 45 s | Heap |
|---|---|---|---|---|
| Extension loaded, fixes off | 0.117 s | 40.7 s | 16.4 s | 124.5 MB |
| Stock (extension blocked) | 0.015 s | 41.4 s | 18.7 s | 124.9-200.7 MB |

**Why task time is high in both rows.** These columns come from Chromium's CDP
`Performance` counters. `TaskDuration` is every main-thread task the renderer
ran in the window, and Spotify's own playback UI, animations and timers keep the
main thread busy; ~40 s of work in a 45 s window is normal for both the loaded
and the blocked client. It is not extension work. The extension's own share is
the `ScriptDuration` column: about 0.1 s per 45 s (~2.5 ms/s), and the ~0.7 s
difference between the two task-time columns is within reload-to-reload noise.

With the kill switch on it registers no repeating timers, observers or animation
frames; only three passive scroll/wheel/touchmove listeners, and the profiler
wrappers are installed only during a recording. The CSS/animation inventory is
read when you open the panel or start a measurement, never on a timer.

With **Runtime CSS patches** on, it adds two `MutationObserver`s (body and head),
`focusin`/`popstate`/history listeners, and a short burst of scans while the page
loads and stylesheets arrive. Those scans settle: in a measured session the
engine ran 11-12 scans in the first ~10 seconds and none afterwards, and parked
rules are only re-checked when a mutation or navigation could affect them.

## New diagnostics (Part B)

These are opt-in debugging aids, not performance fixes. Each has a test driver in
`tests/`; run them with plain Node (Puppeteer + a local Chrome). The live numbers
below were taken on the same machine on 2026-11-14, Spotify 1.3.8.620.

### Slow-frame recorder and page navigation timing

Both share one `PerformanceObserver` (`long-animation-frame` where available,
`longtask` otherwise) and keep a 30-entry ring buffer. With both off the observer
is disconnected; there is no timer and no polling.

Navigation cost is defined as:

```
cost = settle + blocking
settle  = route change -> end of the last long frame that started inside the 2 s window
blocking = sum of blockingDuration of those frames
```

It deliberately excludes download and first-paint time. A route change with no
long frames records cost 0, which is a result, not a missing sample.

| Check | Observed |
|---|---|
| Recorder support | `long-animation-frame` on this Chromium |
| Buffer | 30 entries; older entries dropped |
| Navigation listener | attached after the retry fix (live `lag.nav.subscribed === true`) |
| Live route push `/` -> `/search` -> `/` | `/search` cost **347.5 ms**, 3 frames, **39.3 ms** blocking |
| Scripted test `/playlist/*` | cost **370.4 ms** |
| Scripted test `/search` | cost **0** |

The live route was changed with `Spicetify.Platform.History.push`, which is a
synthetic route change; it exercises the same listener a real navigation uses.
An earlier live run recorded nothing because the listener was subscribed before
`Spicetify.Platform.History.listen` existed. That is fixed by a short retry at
load; the panel warns if it never attaches.

### Selector health

Fifteen selectors and variables this extension depends on, checked when the
panel opens. Statuses: **OK** (matched on its expected route), **N/A here**
(wrong route or the owning extension is not installed), **NOT SEEN** (expected
here but not matched), **STALE** (matched on an earlier Spotify version, not on
this one). The Spotify version comes from `Spicetify.Platform.version`, with the
user-agent as a fallback, and the last healthy version is kept in
`localStorage["perf-adviser:selector-health"]`. The test covers all four
statuses and version persistence.

### Author check: calibration and thresholds

Author mode is installed at load and records the registration itself (no
callbacks wrapped until a check runs). Live load on this client: **780
registrations, 64.5 ms of one-off wrapper time**. Inventory per source was
readable for every extension that loaded after Perf Adviser, including 34
five-minute intervals from `dwp-now-playing-bar.js`.

Six Home checks (6 s synthetic scroll + 3 s idle, 9.1 s recorded):

| Source | Callback ms/s | Interval/s | Observer check | Overall |
|---|---|---|---|---|
| `where-now-playing.js` | **50.57** (611 calls, 462.5 ms) | 0 | PASS (1 scoped observer) | FAIL (callback) |
| `dwp-now-playing-bar.js` | 0 | 0 (34 x 300,000 ms) | PASS (0 observers) | PASS |
| `syncify.bundle.js` | 0 | 0 | PASS (6 scoped observers) | PASS |
| `quickQueue.js` | 0 | 0 | FAIL (document subtree, `attributes[aria-rowindex]`) | FAIL (observer) |
| `upcomingSong.js` | 0 | 0 | FAIL (body subtree, childList) | FAIL (observer) |
| `playlist-icons.js` | 0 | 0 | FAIL (20 body subtree childList) | FAIL (observer) |

Thresholds were chosen from those samples, not from a target frame budget:

| Rule | Pass | Warn | Fail | Why |
|---|---|---|---|---|
| Callback time | < 8 ms/s | 8-25 ms/s | > 25 ms/s | The only non-zero live source measured 50.6 ms/s (~5 % of wall time during the synthetic scroll); every other source measured 0. 8 and 25 bracket that gap with room for noise. 8 ms/s is still under 1 % of one core. |
| Interval rate | <= 2/s | <= 10/s | > 10/s | A 20 ms fixture interval measures ~50/s; real 5-minute intervals measure 0. 2/s allows a 500 ms poll, 10/s flags a 100 ms poll. |
| Forced read | - | - | any read > 2 ms | Provisional. The live sources produced none; the fixture proves the detector fires. Recalibrate if real clients show sub-2 ms forced reads that matter. |
| Broad observer | - | attribute observer without filter | any subtree observer on `document`/`body`/`documentElement` | A registration smell, not proof of cost: `playlist-icons.js` failed this with 0 ms measured. |

These are heuristics from one machine and one theme. They are quoted in the
panel and in the README; they are not a Spicetify or Marketplace certification.
The test fixture (a 20 ms interval that burns 4 ms plus a broad body observer)
measures 200 ms/s and 451 interval calls, and fails every check as intended.

### Guided bisect

The bisect does not measure anything new; it drives the existing Home benchmark
(3 x 5 s) and halves the extension list. Two identical runs at the start measure
reload-to-reload noise:

```
noise = max(2 fps, |run1 - run2|, 1.4826 * max(MAD1, MAD2))
```

A change inside that band is repeated once, then attributed to the half that was
not toggled; it is never reported as the culprit. A change outside it narrows
the candidates to the toggled half. A single extension is named only after
toggling it alone moved the metric. A run starts from the assumption that every
listed extension is enabled, excludes snippets and themes, and needs a reload
per Marketplace toggle.

The algorithm test uses supplied FPS values (no reloads): a four-extension run
with one real culprit finds `b` in three rounds, and a pair that only hurts
together ends **inconclusive** instead of naming `x` or `y`. The full live
workflow (multiple toggles and reloads) was not executed; that is a limit of
this report, not of the test.

### Panel scroll

A refresh, a tab switch or a measurement used to reset the panel to the top.
The regression test scrolls Report to 500 px, switches to Bisect (which starts
at 0), switches back (500 px restored), then presses **Measure again** and
checks that Report is still at 500 px. Two causes were found: after
`PopupModal.hide()` the old root is detached and reports `scrollTop 0`, and the
new content is laid out a frame after `display()`, so assigning `scrollTop`
immediately was clamped to 0. The offset is saved before hiding, ignored for a
detached root, and restored immediately and again after layout.

### Idle overhead of the new features

Same build, animations paused, three 10 s `Performance.getMetrics()` windows
each, Home open, after a reload:

| State | Script time / 10 s | Task time / 10 s |
|---|---|---|
| All new features off | 0.004-0.008 s | 0.02-0.37 s |
| Slow-frame recorder + navigation timing on | 0.004-0.007 s | 0.12-0.22 s |

The script difference is below the resolution of the counter; task time moves
by more than that between windows with no setting changed. Author mode off
installs nothing; on, it pays 64.5 ms once at load and one boolean check per
wrapped callback while idle. Nothing is timed until an author check runs.

### Test drivers

| Test | What it proves | Key measured value |
|---|---|---|
| `peek-loop.mjs` | the observer no longer retriggers itself | original fixture: 5,000 callbacks (capped, fail); fixed: 2 callbacks in 300 ms, 4 after removal; CSSOM rewrite 0 records vs 1 control |
| `lag-recorder.mjs` | ring buffer, LoAF entries, clear, report lines | 30-entry cap, entries carry script files |
| `nav-timing.mjs` | 2 s window, normalisation, cost formula | `/playlist/*` 370.4 ms; `/search` 0 |
| `selector-health.mjs` | all four statuses and version persistence | OK / N/A here / NOT SEEN / STALE |
| `author-check.mjs` | inventory, PASS/WARN/FAIL, startup handlers, wrapper survival | fixture 200.04 ms/s, 451 calls / 1,804.6 ms, observer+interval FAIL |
| `bisect.mjs` | halving, noise rule, combination-only case | finds `b`; pair ends inconclusive |
| `panel-scroll.mjs` | scroll survives tab switch and measurement | 500 px preserved |

## Caveats, stated plainly

- These are **rAF frame intervals during a synthetic `scrollTop` sweep**, not a
  real wheel scroll, and the display refreshes above 100 Hz, so absolute FPS can
  exceed 60. Compare rows, not the number itself.
- Home content is lazy-loaded and differs between sessions, which is why all
  conditions were interleaved on **one** page instead of reloading between them.
  Reload-based comparisons on this machine swung by more than 3x on identical
  CSS.
- One machine, one theme setup. Your numbers will differ; the panel measures
  yours.
- The Part B numbers are single-session samples (three metrics windows or six
  author checks), not interleaved medians. The author thresholds and the 2 ms
  forced-read threshold are provisional and documented as such; the bisect was
  tested algorithmically, not through a full live toggle-and-reload run. The
  live navigation sample used `Spicetify.Platform.History.push`, a synthetic
  route change, because clicking Spotify's own nav buttons through CDP did not
  change the route in this session.
