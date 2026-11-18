#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Guard for the Spicetify build: liquid-lyrics.js must stay a self-contained
// classic script. Spicetify loads extensions as classic scripts, so
// `import.meta`, top-level `import`, and top-level `export` break the whole file.
//
// Usage: node scripts/verify-classic-script.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "liquid-lyrics.js");
const source = readFileSync(target, "utf8");
const failures = [];

// `vm.Script` parses the source as a classic script. It rejects import.meta
// and top-level import/export, while still allowing dynamic import() at runtime.
try {
  new vm.Script(source, { filename: target });
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

// Give a precise line number for the most common regression.
const importMeta = /\bimport\.meta\b/.exec(source);
if (importMeta) {
  const line = source.slice(0, importMeta.index).split("\n").length;
  failures.push(`import.meta found at line ${line}`);
}

if (failures.length) {
  console.error("FAIL: liquid-lyrics.js is not a valid Spicetify classic script.");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("Run `node --check liquid-lyrics.js` for the raw parser error.");
  process.exit(1);
}

const lines = source.split(/\r?\n/).length;
console.log(
  `OK: liquid-lyrics.js parses as a classic script (${Buffer.byteLength(source)} bytes, ${lines} lines).`,
);
console.log("No import.meta, top-level import, or top-level export found.");
