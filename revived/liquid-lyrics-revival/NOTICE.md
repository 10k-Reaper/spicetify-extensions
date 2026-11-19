# NOTICE

## Original project

- Project: Liquid Lyrics
- Author: NMW (<https://github.com/NMWplays>)
- Source: <https://github.com/NMWplays/Liquid-Lyrics>
- Upstream branch: `spicetify`
- Fork point: `d5a453d4c39f80beaa4d800661bf9eed70c8c04a` ("Add SpotiKit move notice", 2026-11-16)
- License: GNU Affero General Public License v3.0 (AGPL-3.0)

## This fork

- Maintainer: 10k-Reaper (<https://github.com/10k-Reaper>)
- Source for the Revival code:
  <https://github.com/10k-Reaper/spicetify-extensions/tree/main/revived/liquid-lyrics-revival>
- Host repository: <https://github.com/10k-Reaper/spicetify-extensions>
- Folder: `revived/liquid-lyrics-revival/`

## Changes made in this fork

In accordance with AGPL-3.0, the modifications are recorded here:

- Rebranded the extension as "Liquid Lyrics Revival".
- Added the AGPL-3.0 SPDX header and NMW copyright credit to the extension bundle.
- Removed the upstream "SpotiKit move notice" modal and its
  `spotikit-move-notice-dismissed` localStorage key.
- Added a classic-script guard. It was later folded into the repository-wide
  `scripts/validate-manifest.mjs` (Node `--check` plus `vm.Script`), and the
  fork-local `scripts/verify-classic-script.mjs` was removed.
- Renamed `liquid-lyrics.js` to `liquid-lyrics-revival.js`.
- Moved the extension into this repository under `revived/liquid-lyrics-revival/`.
- Updated project links to the host repository path
  `revived/liquid-lyrics-revival/`.
- Replaced the Discord header button with a "Report an issue" button that links
  to the host repository's Issues page.
- Pointed the Star on GitHub button at the host repository.
- Updated the README and repository manifest for the monorepo.

The upstream copyright notice and AGPL-3.0 license text are retained in
`LICENSE` and in the extension header.
