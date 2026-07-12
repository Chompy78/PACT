#!/usr/bin/env node
// PACT — headless engine-parity gate (REV-11).
//
// Node port of testing/tests/engine-parity.html's "Run tests (assert)" mode — same fixtures, same
// expected-results.csv, same assertions (including the CG-003/CG-007 special-cases). Kept as a
// deliberately faithful port rather than a rewrite: if the two ever disagree, that's a bug in one of
// them, not an intentional difference. Runs in Node (js/engine.js is a clean ES module, no DOM deps),
// so it can gate a PR without a browser or a headless-browser runner.
//
// Usage: node testing/scripts/engine-parity-ci.mjs   (run from repo root or testing/)
// Exit code 0 = all fixtures pass; 1 = any failure or load error.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, compute, rebuildStateFromEvents } from '../../js/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const EXPECTED_CSV = path.resolve(__dirname, '../expected/expected-results.csv');

async function loadJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function resolveBaseSnapshot(fixture, fixturePath) {
  if (fixture.baseSnapshot) return fixture.baseSnapshot;
  if (fixture.baseSnapshotRef) {
    return loadJson(path.resolve(path.dirname(fixturePath), fixture.baseSnapshotRef));
  }
  throw new Error(`Fixture ${fixturePath} has neither baseSnapshot nor baseSnapshotRef`);
}

// Build-fixture ids are discovered from the directory rather than hardcoded, so a new CG-*
// fixture is picked up automatically — the html test hardcodes its FIXTURES list, but CI
// gains nothing from that rigidity and loses coverage of anything added since. live-sheets/
// and events/ fixture ids are likewise discovered; events/_shared/ (support snapshots, not
// fixtures) is skipped implicitly by the .json-file filter below (it's a directory, not a file).
async function discoverFixtures(subdir) {
  const dir = path.join(FIXTURES_DIR, subdir);
  const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
  return files.map(f => ({ id: f.split('-').slice(0, 2).join('-'), path: path.join(dir, f) }));
}

async function runAll() {
  const rows = [];

  for (const { id, path: p } of await discoverFixtures('builds')) {
    try {
      const build = await loadJson(p);
      const r = compute(build);
      rows.push({
        id, group: 'chargen', path: p,
        total: r.total, warnings: r.warnings.length, remaining: r.remaining,
        firstWarning: r.warnings[0] ?? '', ok: r.remaining >= 0, error: null,
      });
    } catch (e) {
      rows.push({ id, group: 'chargen', path: p, error: e.message });
    }
  }

  for (const { id, path: p } of await discoverFixtures('live-sheets')) {
    try {
      const liveSheet = await loadJson(p);
      const r = rebuildStateFromEvents(liveSheet, []);
      rows.push({
        id, group: 'live-sheet', path: p,
        total: r.total, warnings: r.warnings.length, remaining: r.remaining,
        firstWarning: r.warnings[0] ?? '', ok: r.ok, eventsApplied: r.eventsApplied, error: null,
      });
    } catch (e) {
      rows.push({ id, group: 'live-sheet', path: p, error: e.message });
    }
  }

  for (const { id, path: p } of await discoverFixtures('events')) {
    try {
      const fixture = await loadJson(p);
      const baseSnapshot = await resolveBaseSnapshot(fixture, p);
      const r = rebuildStateFromEvents(baseSnapshot, fixture.events);
      rows.push({
        id, group: 'event-sourcing', path: p,
        total: r.total, warnings: r.warnings.length, remaining: r.remaining,
        firstWarning: r.warnings[0] ?? '', ok: r.ok, eventsApplied: r.eventsApplied, error: null,
      });
    } catch (e) {
      rows.push({ id, group: 'event-sourcing', path: p, error: e.message });
    }
  }

  return rows;
}

async function loadExpected() {
  const text = await readFile(EXPECTED_CSV, 'utf8');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const idx = h => headers.indexOf(h);
  const map = {};
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const id = cols[idx('test_id')].trim();
    map[id] = {
      total: cols[idx('new_engine_ap_total')].trim(),
      warnings: cols[idx('new_engine_warnings')].trim(),
      valid: cols[idx('new_engine_valid')].trim(),
      eventsApplied: cols[idx('new_engine_events_applied')] !== undefined
        ? cols[idx('new_engine_events_applied')].trim() : '',
    };
  }
  return map;
}

function assertRow(row, expected) {
  if (row.error) return { ...row, pass: false, failures: [`load error: ${row.error}`] };

  const exp = expected[row.id];
  if (!exp || exp.total === '') {
    return { ...row, pass: false, failures: [`no expected row in CSV for ${row.id}`] };
  }

  const failures = [];
  const expTotal = Number(exp.total);
  if (row.total !== expTotal) failures.push(`total: got ${row.total}, expected ${expTotal}`);

  const expWarn = Number(exp.warnings);
  if (row.warnings !== expWarn) failures.push(`warnings count: got ${row.warnings}, expected ${expWarn}`);

  // Same fixture-specific assertions as the browser test (testing/tests/engine-parity.html) — kept
  // in lockstep deliberately; if these ever need to diverge, that's a sign the html test needs updating too.
  if (row.id === 'CG-003') {
    if (row.remaining >= 0) failures.push(`remaining should be < 0, got ${row.remaining}`);
    if (!row.firstWarning.startsWith('OVER BUDGET')) failures.push(`first warning should start with "OVER BUDGET", got: "${row.firstWarning}"`);
  }
  if (row.id === 'CG-007') {
    if (row.remaining < 0) failures.push(`remaining should be >= 0, got ${row.remaining}`);
    if (row.firstWarning !== 'Expertise in Athletics needs the skill bought first') failures.push(`first warning mismatch, got: "${row.firstWarning}"`);
  }
  if (row.eventsApplied !== undefined) {
    if (!row.ok) failures.push('ok should be true');
    if (exp.eventsApplied !== '') {
      const expEv = Number(exp.eventsApplied);
      if (row.eventsApplied !== expEv) failures.push(`eventsApplied: got ${row.eventsApplied}, expected ${expEv}`);
    }
  }

  return { ...row, pass: failures.length === 0, failures };
}

async function main() {
  const [actuals, expected] = await Promise.all([runAll(), loadExpected()]);
  const results = actuals.map(row => assertRow(row, expected));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log(`PACT engine parity — engine ${DATA?.version ?? 'unknown'}, ${results.length} fixtures`);
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'} ${r.id} (${r.group})`);
    if (!r.pass) r.failures.forEach(f => console.log(`       - ${f}`));
  }
  console.log(failed === 0 ? `\n✓ ${passed} passed / 0 failed` : `\n✗ ${failed} FAILED / ${passed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('Run failed:', e); process.exit(1); });
