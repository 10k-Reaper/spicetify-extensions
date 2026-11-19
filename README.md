# Spicetify Extensions

A collection of Spicetify extensions maintained by
[10k-Reaper](https://github.com/10k-Reaper). Each extension keeps its own
install path, documentation, and license.

## Extensions

### [Performance Adviser](docs/perf-adviser.md)

Finds what makes Spotify's Home page stutter and applies reversible CSS fixes.

To use: install it from the Spicetify Marketplace, or follow the install steps
in [docs/perf-adviser.md](docs/perf-adviser.md).

### [Liquid Lyrics Revival](revived/liquid-lyrics-revival/README.md)

Word-by-word synced lyrics, fullscreen lyrics, romanization, and an expandable
sidebar card.

To use:
- Download [`liquid-lyrics-revival.js`](https://raw.githubusercontent.com/10k-Reaper/spicetify-extensions/main/revived/liquid-lyrics-revival/liquid-lyrics-revival.js).
- Copy it into your Spicetify extensions folder (`%appdata%\spicetify\Extensions\` on Windows, `~/.config/spicetify/Extensions/` on Linux/macOS).
- Run `spicetify config extensions liquid-lyrics-revival.js` and `spicetify apply`.
- Restart Spotify.

## Revived extensions

- **[Liquid Lyrics Revival](revived/liquid-lyrics-revival/README.md)** is a fork
  of [NMWplays/Liquid-Lyrics](https://github.com/NMWplays/Liquid-Lyrics), kept on
  Spicetify and based on the upstream `spicetify` branch (fork commit
  `d5a453d`). The original project, design, and code are by NMW.

> [!WARNING]
> Do not install Liquid Lyrics Revival alongside NMW's original
> `liquid-lyrics.js`. Both files use the same `window.__liquidLyricsLoaded` guard
> and the same storage keys, so whichever loads first wins and the second one
> does nothing.

## Licensing

This repository has two license scopes:

- Root-level files (`perf-adviser.js`, the root `README.md`, `manifest.json`,
  `docs/`, `tests/`, and `scripts/`) are MIT-licensed. See [LICENSE](LICENSE).
- `revived/liquid-lyrics-revival/` is AGPL-3.0. See
  [its LICENSE](revived/liquid-lyrics-revival/LICENSE) and
  [NOTICE.md](revived/liquid-lyrics-revival/NOTICE.md).

Each license applies only to its own scope.
