#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Validates the repository manifest and every extension it points at.
// Plain Node, no dependencies.
//
// Checks:
//   - manifest.json parses and is a non-empty array
//   - required fields are present and non-empty
//   - preview/main/readme paths are relative, inside the repo, and exist
//   - each main file passes `node --check`
//   - each main file parses as a classic script (no import.meta, no
//     top-level import/export), because Spicetify loads extensions that way

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "manifest.json");
const failures = [];

const fail = (message) => failures.push(message);
const isText = (value) => typeof value === "string" && value.trim().length > 0;

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error("FAIL: could not read manifest.json");
  console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!Array.isArray(manifest)) {
  console.error("FAIL: manifest.json must be an array (one object per extension).");
  process.exit(1);
}
if (manifest.length === 0) fail("manifest.json is an empty array.");

const required = ["name", "description", "preview", "main", "readme"];
const names = new Set();

function checkClassicScript(file, display) {
  const source = readFileSync(file, "utf8");
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });

  if (checked.status !== 0) {
    const detail = (checked.stderr || checked.stdout || "")
      .trim()
      .split(/\r?\n/)
      .slice(0, 3)
      .join(" | ");
    fail(`${display}.main: node --check failed${detail ? `: ${detail}` : "."}`);
    return;
  }

  try {
    new vm.Script(source, { filename: file });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`${display}.main: not a classic script: ${message}`);
    return;
  }

  const importMeta = /\bimport\.meta\b/.exec(source);
  if (importMeta) {
    const line = source.slice(0, importMeta.index).split("\n").length;
    fail(`${display}.main: import.meta found at line ${line}.`);
  }
}

manifest.forEach((entry, index) => {
  const label = `manifest[${index}]`;

  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    fail(`${label}: must be an object.`);
    return;
  }

  for (const key of required) {
    if (!isText(entry[key])) fail(`${label}.${key}: required non-empty string.`);
  }

  if (isText(entry.name)) {
    if (names.has(entry.name)) fail(`${label}.name: duplicate "${entry.name}".`);
    names.add(entry.name);
  }

  if (entry.authors !== undefined) {
    if (!Array.isArray(entry.authors)) {
      fail(`${label}.authors: must be an array.`);
    } else {
      entry.authors.forEach((author, authorIndex) => {
        if (author === null || typeof author !== "object" || Array.isArray(author)) {
          fail(`${label}.authors[${authorIndex}]: must be an object.`);
          return;
        }
        if (!isText(author.name)) {
          fail(`${label}.authors[${authorIndex}].name: required non-empty string.`);
        }
        if (author.url !== undefined && !isText(author.url)) {
          fail(`${label}.authors[${authorIndex}].url: must be a non-empty string.`);
        }
      });
    }
  }

  if (entry.tags !== undefined) {
    if (!Array.isArray(entry.tags) || !entry.tags.every(isText)) {
      fail(`${label}.tags: must be an array of non-empty strings.`);
    }
  }

  for (const key of ["preview", "main", "readme"]) {
    if (!isText(entry[key])) continue;

    const file = resolve(root, entry[key]);
    const rel = relative(root, file);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      fail(`${label}.${key}: must stay inside the repository (${entry[key]}).`);
      continue;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      fail(`${label}.${key}: file not found: ${entry[key]}`);
      continue;
    }
    if (key === "main") checkClassicScript(file, label);
  }
});

if (failures.length) {
  console.error("FAIL: manifest validation failed.");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const count = manifest.length;
console.log(`OK: ${count} extension${count === 1 ? "" : "s"} validated.`);
console.log("All main files parse as classic scripts; no import.meta, top-level import, or top-level export.");
