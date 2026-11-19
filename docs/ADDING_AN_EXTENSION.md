# Adding a revived extension

This checklist is for adding a community-maintained fork of an NMWplays
extension to this repository. Each revived extension lives under
`revived/<name>/` and stays self-contained.

## 1. Check the license first

- Read the upstream `LICENSE` before copying anything.
- If the upstream license is copyleft, keep it. Do not relicense the fork under
  the repository's root MIT license.
- Keep the upstream copyright notice and author credit in the source header and
  in the extension's own `LICENSE`.
- If the license is unclear or missing, stop and ask before importing the code.

## 2. Create the folder

Use a kebab-case folder name:

```text
revived/<name>/
  <name>.js
  README.md
  preview.png
  LICENSE
  NOTICE.md
```

Use a distinct `.js` filename from the upstream extension. A different name
avoids two files fighting over the same DOM IDs and globals if both are
installed. Do not rename DOM IDs, CSS classes or variables, `localStorage`
keys, or globals such as `__liquidLyricsLoaded` unless you have checked what
that breaks.

## 3. Write NOTICE.md

Record:

- the original project, author, and source repository
- the upstream branch and the exact commit the fork started from
- the fork's license
- every modification made in this fork, in enough detail for AGPL-style change
  marking
- where the fork is now maintained

## 4. Add the manifest entry

Only the repository-root `manifest.json` is read by Marketplace. Add one object
to the array:

```json
{
  "name": "Extension Name",
  "description": "One or two sentences.",
  "preview": "revived/<name>/preview.png",
  "main": "revived/<name>/<name>.js",
  "readme": "revived/<name>/README.md",
  "authors": [
    { "name": "NMW", "url": "https://github.com/NMWplays" }
  ],
  "tags": ["revived"]
}
```

All paths are relative to the repository root. Do not use raw GitHub URLs in
the manifest. Keep the `revived` tag and add topic tags that describe the
extension.

## 5. Update the READMEs

- In the extension's README, document installation, migration from the original
  file name, and the fact that the original and the revived build should not be
  installed together when they share a guard or storage keys.
- Add the extension to the **Extensions** list and the **Revived extensions**
  section in the repository root `README.md`.
- Keep the upstream project and NMW credited.

## 6. Validate

Run the repository validator before committing:

```bash
node scripts/validate-manifest.mjs
```

It checks the manifest shape, required fields, every referenced path, and that
each extension's main file parses as a classic script without `import.meta` or
top-level `import`/`export`. Also run:

```bash
node --check revived/<name>/<name>.js
```

## 7. Do not copy unrelated code

Do not pull code from another project, including SpotiKit, unless the user has
confirmed the license allows it and the source is credited. A license that is
compatible in one direction may not be compatible in the other.

## 8. Commit in small steps

Keep the subtree import, the file rename, the link updates, the manifest entry,
and the documentation changes separate where practical. Do not move or rename
the root `perf-adviser.js`; existing Marketplace installs fetch it from the
repository root.
