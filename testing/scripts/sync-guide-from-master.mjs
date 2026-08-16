#!/usr/bin/env node
/**
 * sync-guide-from-master.mjs — transfer pact-guide's canonical guide into this repo's served copy.
 *
 * WHY THIS EXISTS
 * ---------------
 * `docs/PACT-Players-Guide.html` is NOT a byte-copy of pact-guide's master. The served copy carries
 * three PACT-repo-specific <head> tags that the master has no reason to know about:
 *
 *     <link rel="manifest">, <link rel="icon">, <link rel="apple-touch-icon">
 *
 * They are what make the served guide part of the installable PWA (manifest + service-worker scope
 * are pinned to /PACT/). A plain `cp` from the master silently drops all three, and
 * docs/VERSION-SYNC.md's transfer procedure never mentioned them — so every hand-copy has been one
 * undocumented manual step away from breaking the live guide. This script removes that step.
 *
 * It is idempotent: re-running against an already-synced file changes nothing.
 *
 * USAGE
 *   node sync-guide-from-master.mjs <path-to-pact-guide/PACT-Players-Guide.html> [--check]
 *
 * --check   verify only; report what would change and exit 1 if the served copy is out of sync.
 *
 * Exit 0 = synced (or already in sync). Exit 1 = --check found drift, or a sanity check failed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVED = join(HERE, '..', '..', 'docs', 'PACT-Players-Guide.html');

// The PACT-repo-only <head> tags, in the order the served copy has carried them.
const PWA_LINKS =
  '<link rel="manifest" href="/PACT/manifest.json">' +
  '<link rel="icon" type="image/png" href="../assets/icons/PACT_favicon.png">' +
  '<link rel="apple-touch-icon" href="/PACT/icons/apple-touch-icon.png">';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const masterPath = argv.find(a => !a.startsWith('--'));

if (!masterPath) {
  console.error('usage: node sync-guide-from-master.mjs <pact-guide/PACT-Players-Guide.html> [--check]');
  process.exit(2);
}
if (!existsSync(masterPath)) {
  console.error(`master not found: ${masterPath}`);
  process.exit(2);
}

const master = readFileSync(masterPath, 'utf-8');
const version = (master.match(/content-version:\s*(v[\d.]+)/) || [])[1] || null;

// ---- sanity checks on the master before we let it near the served copy ----------------
if (!/^<!doctype html>/i.test(master.trim())) {
  console.error('refusing: master does not start with <!doctype html> — wrong file?');
  process.exit(1);
}
if (!version) {
  console.error('refusing: master carries no content-version marker — wrong file?');
  process.exit(1);
}
if (master.includes('rel="manifest"')) {
  console.error('refusing: master already carries PWA links — it should not. Check the source file.');
  process.exit(1);
}

// ---- build the served copy -------------------------------------------------------------
if (!master.includes('<head>')) {
  console.error('refusing: no <head> in master — cannot place PWA links');
  process.exit(1);
}
const built = master.replace('<head>', '<head>' + PWA_LINKS);

const current = existsSync(SERVED) ? readFileSync(SERVED, 'utf-8') : null;
const currentVersion = current ? (current.match(/content-version:\s*(v[\d.]+)/) || [])[1] : null;

console.log(`master  : ${masterPath}  (${version})`);
console.log(`served  : docs/PACT-Players-Guide.html  (${currentVersion || 'absent'})`);

if (current === built) {
  console.log('\nalready in sync — nothing to do');
  process.exit(0);
}

if (checkOnly) {
  console.log(`\nOUT OF SYNC: served copy would change (${currentVersion || 'absent'} -> ${version})`);
  if (current && !current.includes('rel="manifest"')) {
    console.log('  ! served copy is MISSING its PWA <head> links — a plain cp has already stripped them');
  }
  process.exit(1);
}

writeFileSync(SERVED, built);
console.log(`\nsynced: ${currentVersion || 'absent'} -> ${version}, PWA <head> links preserved`);
console.log('next: run testing/scripts/guide-price-check.mjs against the served copy, then commit.');
