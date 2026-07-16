/*
  random-manual-e2e.mjs

  Headless UI regression harness for character generation + advancement (REV-11).

  Drives the REAL tool UI in a browser — species/class selects, ability +/- steppers,
  skill/tool checkboxes, the "⇆ Open in Live Sheet" / "⇆ Open in CharGen" one-click
  switch buttons (D-GH38), the Live Sheet's "+ Award AP" / "Level up" / buy-panel tiles —
  using this script's OWN random choices. It never calls the app's built-in
  `randomizeBuild()` roll-a-random-character function; every purchase is a real click,
  select, or checkbox toggle that a human could make, and results are read back out of
  the same DOM/engine state the UI shows the player.

  Also drives DM Console's real, cloud-independent roster flow: the finished character is
  exported via the same envelope the app's own Save button builds (`_cgEnvelope()`), dropped
  onto DM Console's real `<input type=file>` (drag/drop's underlying control), and the
  rendered roster row is read back and cross-checked against the source tool's own
  species/class/HP/AC/AP-available — this is the one place DM Console's `dmAnalyze()` could
  drift from `js/engine.js` even though both now go through the same bridge (D-GH36/D-GH37),
  because the drift risk here is envelope-shape, not computation. DM Console's cloud/campaign
  features (sign-in, award AP, campaign rules) are NOT exercised — they need a live Supabase
  session/roster, not just the CDN stub — see docs/TASK_BOARD.md for that as future work.

  ---- The oracle (why this can catch more than "the DOM agrees with itself") ----
  Every tool bridges the SAME js/engine.js onto `window`, so a naive check like "the displayed
  AP equals economy().available" is self-referential: if compute()/economy() itself is wrong,
  every UI surface agrees on the WRONG number and the check passes anyway. This harness also
  runs a genuinely independent oracle, on the real random LOG each iteration generates
  (not just the 20 static parity fixtures):
    1. Node-vs-browser agreement — the SAME js/engine.js source, freshly imported into this
       Node process (a separate module instantiation from the browser's), fed the browser's
       real LOG, must produce identical economy()/compute(foldBuild()) output. Catches any
       state that leaked into the browser's long-lived module instance across purchases.
    2. Dual-entry-point agreement — foldBuild(LOG)+compute() and rebuildStateFromEvents(null,
       LOG) are two separately-documented engine entry points that both replay the same LOG;
       they must agree with each other (computed in the SAME Node process, so this isolates
       divergence between the two entry points from the Node-vs-browser question above).
    3. Spec-independent spend reconciliation — a HAND-WRITTEN summation of the LOG's own
       recorded buy/buyoff/names costs (written from the engine's documented behaviour, not by
       calling economy()/`_spendCost()`) must match economy().spent. This is the one check
       that can catch a bug in economy()'s own categorization logic, which (1) and (2) cannot
       — they'd both reproduce the same bug identically since they call the same function.
    4. compute() purity — calling compute(b) twice on the same build must return identical
       results, and must not mutate `b` — catches any hidden shared-state/mutation bug.
  See checkEngineInvariants() below. Failures are reported with the `[oracle]` prefix.

  Requires the `playwright` package to be resolvable (either `npm i -D playwright`
  in a scratch dir on NODE_PATH, or a global install — this sandbox has one at
  `npm root -g`). Chromium must be installed for Playwright.

  Usage:
    node testing/scripts/random-manual-e2e.mjs [--iterations N] [--levels N] [--seed N] [--headed] [--keep-open]

  Exit code is non-zero if any invariant fails across any iteration.
*/
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// CJS require honors NODE_PATH (unlike ESM's static `import`), so this resolves a
// globally-installed `playwright` without needing a local node_modules/ in the repo.
const { chromium } = createRequire(import.meta.url)('playwright');

// ---------- CLI args ----------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v === undefined ? true : v;
}
const ITERATIONS = parseInt(argVal('iterations', '3'), 10);
const LEVELS_PER_CHAR = parseInt(argVal('levels', '3'), 10);
const SEED = parseInt(argVal('seed', String(Date.now() & 0xffffffff)), 10);
const HEADED = !!argVal('headed', false);
const KEEP_OPEN = !!argVal('keep-open', false);

// ---------- seeded RNG (mulberry32) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pickN = (rng, arr, n) => {
  const pool = arr.slice();
  const out = [];
  n = Math.min(n, pool.length);
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
};
const chance = (rng, p) => rng() < p;
const int = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

function log(msg) { console.log(`[e2e] ${msg}`); }

// ---------- Supabase CDN stub ----------
// js/supabase-client.js does `import { createClient } from 'https://esm.sh/@supabase/supabase-js@<pinned>'`
// — the only external network dependency in the whole app. Engine boot on both tools is
// gated behind that same module graph (see AGENTS.md / D-GH26), so if the CDN is
// unreachable (sandboxed/offline CI), `window.compute` never gets set and everything
// hangs. Supabase itself is optional (the app runs fully offline against localStorage —
// see docs/SUPABASE-SETUP.md), so we stub the client with a chainable no-op Proxy: it
// answers any method call (`.auth.getSession()`, `.from(...).select().eq()`, `.rpc(...)`,
// `.channel(...)`) with an empty, awaitable result, letting the real app code (engine,
// UI, character logic — the thing under test) load and run untouched.
const SUPABASE_STUB_MODULE = `
function makeStub(finalResult) {
  const handler = {
    get(_t, prop) {
      if (prop === 'then') return (resolve) => resolve(finalResult);
      if (prop === 'catch') return () => makeStub(finalResult);
      if (prop === 'finally') return (cb) => { try { cb && cb(); } catch (e) {} return makeStub(finalResult); };
      return makeStub(finalResult);
    },
    apply() { return makeStub(finalResult); },
  };
  return new Proxy(function () {}, handler);
}
export function createClient() {
  return makeStub({ data: {}, error: null });
}
`;
async function stubSupabaseCdn(page) {
  // Version-agnostic matcher so this keeps intercepting whatever exact version js/supabase-client.js
  // is pinned to (e.g. @2.110.2) without needing an edit here on every pin bump.
  await page.route(/esm\.sh\/@supabase\/supabase-js@/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: SUPABASE_STUB_MODULE })
  );
}

// ---------- static server ----------
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const PARENT_DIR = path.dirname(REPO_ROOT);
const PACT_LINK = path.join(PARENT_DIR, 'PACT');

async function ensurePactSymlink() {
  if (path.basename(REPO_ROOT) === 'PACT') return REPO_ROOT;
  try {
    const st = await fs.lstat(PACT_LINK);
    if (st.isSymbolicLink() || st.isDirectory()) return PACT_LINK;
  } catch { /* doesn't exist yet */ }
  await fs.symlink(REPO_ROOT, PACT_LINK, 'dir');
  log(`created case-correct symlink ${PACT_LINK} -> ${REPO_ROOT}`);
  return PACT_LINK;
}

async function startServer(port) {
  const child = spawn('python3', ['-m', 'http.server', String(port), '--directory', PARENT_DIR], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError = null;
  child.on('error', (e) => { spawnError = e; });

  // Poll the port with a real request instead of scanning stdout for "Serving HTTP" —
  // Python block-buffers stdout when it's piped (as it always is here), so on some
  // hosts that line never arrives within a useful window even though the server is
  // already accepting connections (bit us in CI, not locally, where buffering
  // happened to flush promptly).
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (spawnError) { child.kill(); throw spawnError; }
    try {
      const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
      await res.body?.cancel();
      return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill(); // don't leak a bound port on startup failure
  throw new Error('server did not start in time');
}

// ---------- dialog policy ----------
// PACT's Live Sheet uses window.prompt (Award AP amount + note) and window.confirm
// (soft-warning purchases) and window.alert (hard-blocked purchases / errors).
// We dispatch on the dialog's own message text rather than pre-queuing, since a
// random click may or may not trigger a dialog at all.
function wireDialogs(page, state) {
  page.on('dialog', async (dialog) => {
    const msg = dialog.message();
    try {
      if (/Award how many AP\?/.test(msg)) {
        await dialog.accept(String(state.awardAmount ?? 0));
      } else if (/What for\?/.test(msg)) {
        await dialog.accept(state.awardNote ?? 'Automated random advancement test');
      } else if (/^This purchase raises a rules warning/.test(msg)) {
        if (chance(state.rng, state.acceptSoftWarnProb)) {
          state.softWarnAccepted++;
          await dialog.accept();
        } else {
          state.softWarnDeclined++;
          await dialog.dismiss();
        }
      } else if (/^⛔ Purchase blocked/.test(msg)) {
        state.hardBlocked++;
        await dialog.accept();
      } else if (dialog.type() === 'confirm') {
        log(`[unexpected confirm] ${msg} -> dismissing`);
        await dialog.dismiss();
      } else {
        log(`[unexpected dialog] ${dialog.type()}: ${msg} -> accepting`);
        await dialog.accept();
      }
    } catch (e) {
      log(`dialog handler error: ${e.message}`);
    }
  });
}

// ---------- Phase 1: engine invariants (the independent oracle — see file header) ----------

// Hand-written from the engine's OWN documented behaviour (js/engine.js's `_spendCost`/`economy`
// comments), NOT by calling either — this is the one check that can catch a bug in economy()'s
// own categorization logic, since every other check here ultimately calls that same function.
function independentSpend(LOG) {
  let spent = 0;
  for (const e of LOG || []) {
    if (!e) continue;
    if (e.type === 'buy' && e.cat !== 'drawback') spent += Number(e.cost) || 0;
    else if (e.type === 'buyoff') spent += Number(e.cost) || 0;
    else if (e.type === 'names') spent += Number(e.cost) || 0;
    // award / buy-drawback / anything else: not spend (drawbacks refund via `earned`, not `spent`)
  }
  return spent;
}

const deepClone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const deepEqualJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// compute() purity: same input twice -> same output, and the input itself must be untouched.
// Runs entirely in this Node process (fresh engine import) — no browser involved.
//
// r1/r2 each get their OWN clone (never the same object, and never the caller's `build`), so a
// mutation during call 1 can't taint call 2's determinism comparison. Mutation is tested
// separately via a THIRD, dedicated clone: snapshot it, hand it to compute(), then compare —
// this is the only way to actually detect a mutation, since compute() must be given a real
// object it could mutate (an earlier version of this function called compute() with a fresh
// deepClone() every time and then compared the ORIGINAL `build` against itself, which can never
// differ because `build` was never passed to compute() at all — a tautological check that could
// never fire).
function checkComputePurity(ENGINE, build, label) {
  const notes = [];
  const r1 = ENGINE.compute(deepClone(build));
  const r2 = ENGINE.compute(deepClone(build));
  if (!deepEqualJSON(r1, r2)) notes.push(`[oracle:${label}] compute() is not deterministic on the same input (two calls differed)`);
  const probe = deepClone(build);
  const before = deepClone(probe);
  ENGINE.compute(probe);
  if (!deepEqualJSON(before, probe)) notes.push(`[oracle:${label}] compute() mutated its input build object`);
  return notes;
}

// Node-vs-browser + spec-independent spend reconciliation. Safe for BOTH tools: economy(LOG) is
// a pure function of the LOG alone, so this never depends on whether readBuild()/foldBuild() are
// in sync with the DOM.
//
// window.economy has a DIFFERENT signature per tool: CharGen calls the engine's array-parameter
// API directly onto window (economy(events)); Live Sheet shadows window.economy with its own
// classic-script INDEX-based wrapper (economy(uptoIdx) -> window._engineFold.economy(eventsUpTo(
// uptoIdx))) for its time-travel/scrub UI (see AGENTS.md). Passing this check's LOG array to Live
// Sheet's wrapper as if it were an index silently produces an empty replay. Resolve the RAW,
// array-parameter engine function explicitly (window._engineFold on Live Sheet, window directly
// on CharGen) so this check is fed the exact same LOG on both sides regardless of which tool.
async function checkEconomyAgreement(ENGINE, page, label) {
  const notes = [];
  const pageSide = await page.evaluate(() => {
    const raw = window._engineFold || { economy: window.economy };
    const log = typeof LOG !== 'undefined' ? LOG : [];
    const eco = raw.economy(log);
    return { LOG: log, spent: eco.spent, earned: eco.earned, available: eco.available };
  });
  const nodeEco = ENGINE.economy(pageSide.LOG);
  if (nodeEco.spent !== pageSide.spent) notes.push(`[oracle:${label}] economy().spent: browser=${pageSide.spent} vs fresh-Node-import=${nodeEco.spent} (same LOG — state leaked into the browser's engine instance?)`);
  if (nodeEco.earned !== pageSide.earned) notes.push(`[oracle:${label}] economy().earned: browser=${pageSide.earned} vs fresh-Node-import=${nodeEco.earned}`);
  if (nodeEco.available !== pageSide.available) notes.push(`[oracle:${label}] economy().available: browser=${pageSide.available} vs fresh-Node-import=${nodeEco.available}`);
  const spec = independentSpend(pageSide.LOG);
  if (spec !== pageSide.spent) notes.push(`[oracle:${label}] spend reconciliation: independently-summed LOG cost=${spec} vs economy().spent=${pageSide.spent} (a real economy()/spend-categorization logic bug, not a wiring bug)`);
  return notes;
}

// Live-Sheet-only (LOG is that tool's authoritative build source, so foldBuild(LOG) is meaningful
// there): cross-check the two documented engine entry points that both replay a LOG —
// foldBuild()+compute() and rebuildStateFromEvents() — against each other AND against the browser.
//
// Resolves the RAW, array-parameter foldBuild explicitly (window._engineFold on Live Sheet,
// window directly on CharGen) rather than the tool's own `foldBuild(null)` convention — the same
// array-vs-index hazard as window.economy (see checkEconomyAgreement above): were this function
// ever reused for a tool whose window.foldBuild is index-based AND doesn't happen to have
// eventsUpTo(null)===LOG by coincidence, `foldBuild(null)` could silently mean something other
// than "the LOG this check just read." Explicit resolution removes that assumption entirely.
async function checkFoldRebuildAgreement(ENGINE, page, label) {
  const notes = [];
  const pageSide = await page.evaluate(() => {
    const raw = window._engineFold || { foldBuild: window.foldBuild };
    const log = typeof LOG !== 'undefined' ? LOG : [];
    const b = raw.foldBuild(log);
    const r = window.compute(b);
    return { LOG: log, budget: b.budget, total: r.total, remaining: r.remaining };
  });
  const nodeBuild = ENGINE.foldBuild(pageSide.LOG);
  const nodeResult = ENGINE.compute(nodeBuild);
  const nodeRebuild = ENGINE.rebuildStateFromEvents(null, pageSide.LOG);
  if (nodeResult.total !== pageSide.total) notes.push(`[oracle:${label}] compute(foldBuild(LOG)).total: browser=${pageSide.total} vs fresh-Node-import=${nodeResult.total}`);
  if (nodeResult.remaining !== pageSide.remaining) notes.push(`[oracle:${label}] compute(foldBuild(LOG)).remaining: browser=${pageSide.remaining} vs fresh-Node-import=${nodeResult.remaining}`);
  if (nodeBuild.budget !== pageSide.budget) notes.push(`[oracle:${label}] foldBuild(LOG).budget: browser=${pageSide.budget} vs fresh-Node-import=${nodeBuild.budget}`);
  if (nodeRebuild.total !== nodeResult.total) notes.push(`[oracle:${label}] dual-entry-point mismatch: rebuildStateFromEvents(null,LOG).total=${nodeRebuild.total} vs foldBuild(LOG)+compute().total=${nodeResult.total} (same Node process, same LOG)`);
  if (nodeRebuild.remaining !== nodeResult.remaining) notes.push(`[oracle:${label}] dual-entry-point mismatch: rebuildStateFromEvents(null,LOG).remaining=${nodeRebuild.remaining} vs foldBuild(LOG)+compute().remaining=${nodeResult.remaining}`);
  if (nodeRebuild.budget !== nodeBuild.budget) notes.push(`[oracle:${label}] dual-entry-point mismatch: rebuildStateFromEvents(null,LOG).budget=${nodeRebuild.budget} vs foldBuild(LOG).budget=${nodeBuild.budget}`);
  return notes;
}

// Runs the whole oracle for one tool/moment. `fullCrossCheck` additionally runs the
// foldBuild/rebuildStateFromEvents comparison — only meaningful where LOG is the build's
// authoritative source (Live Sheet), not where a DOM-driven readBuild() is (CharGen mid-edit).
// The fold path resolves the raw array-parameter foldBuild explicitly (see
// checkFoldRebuildAgreement's comment) — not `window.foldBuild(null)` — so this stays correct
// even if a future caller ever passes `fullCrossCheck: true` for a tool whose window.foldBuild
// isn't already the tool-current-state convention this happens to coincide with today.
async function checkEngineInvariants(ENGINE, page, label, { fullCrossCheck = false } = {}) {
  const notes = [];
  const build = await page.evaluate((useFold) => {
    if (!useFold) return window.readBuild();
    const raw = window._engineFold || { foldBuild: window.foldBuild };
    return raw.foldBuild(typeof LOG !== 'undefined' ? LOG : []);
  }, fullCrossCheck);
  notes.push(...checkComputePurity(ENGINE, build, label));
  notes.push(...(await checkEconomyAgreement(ENGINE, page, label)));
  if (fullCrossCheck) notes.push(...(await checkFoldRebuildAgreement(ENGINE, page, label)));
  return notes;
}

// ---------- CharGen: random manual build ----------
async function randomizeCharGen(page, rng) {
  await page.goto(`${page.__baseUrl}/PACT/tools/PACT-CharGen-Webtool.html`);
  await page.waitForFunction(() => typeof window.compute === 'function');
  await page.waitForSelector('#total');

  // Species (skip the "(none)" placeholder ~90% of the time)
  if (chance(rng, 0.9)) {
    const opts = await page.locator('#spec option').evaluateAll((os) => os.map((o) => o.value).filter((v) => v !== '(none)'));
    if (opts.length) await page.selectOption('#spec', pick(rng, opts));
  }
  // Origin class
  if (chance(rng, 0.9)) {
    const opts = await page.locator('#oclass option').evaluateAll((os) => os.map((o) => o.value).filter((v) => v !== '(none)'));
    if (opts.length) await page.selectOption('#oclass', pick(rng, opts));
  }
  // Size — only a real, visible choice for species where it's actually choosable
  // (e.g. Gnome + Medium second origin); otherwise the app hides the control and
  // fixes the size itself, so there's nothing for a human to click.
  if (await page.locator('#charsize').isVisible().catch(() => false)) {
    await page.selectOption('#charsize', pick(rng, ['Small', 'Medium']));
  }
  // Hit Dice: keep at level 1 — advancement is exercised in the Live Sheet phase.
  await page.selectOption('#hd', '1').catch(() => {});

  // Ability score steps: click +/- via accessible names, checking budget after each
  // click and undoing (real Undo button) if it pushes the build into a hard warning.
  const ABILS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const stepsPerAbil = Object.fromEntries(ABILS.map((a) => [a, int(rng, 0, 4)]));
  for (const a of ABILS) {
    for (let i = 0; i < stepsPerAbil[a]; i++) {
      await page.getByRole('button', { name: `Increase ${a}` }).click();
      const ok = await buildIsClean(page);
      if (!ok) { await clickUndo(page); break; }
    }
  }

  // Vigor / Grit — random ranks, backed off one step at a time if a rank exceeds this
  // build's CON-mod cap (a real, commonly-hit rule warning, not just a budget issue).
  for (const id of ['hardy', 'tough']) {
    let target = int(rng, 0, 3);
    await page.selectOption(`#${id}`, String(target)).catch(() => {});
    while (target > 0 && !(await buildIsClean(page))) {
      target--;
      await page.selectOption(`#${id}`, String(target)).catch(() => {});
    }
  }

  // Saving throws, skills, tools, instruments — check a random legal-looking subset,
  // backing off any pick that introduces a hard warning or blows the budget.
  await randomCheckSubset(page, '.saveck', rng, int(rng, 1, 2));
  await randomCheckSubset(page, '.skillck', rng, int(rng, 2, 4));
  await randomCheckSubset(page, '.toolck', rng, int(rng, 0, 2));
  await randomCheckSubset(page, '.instck', rng, int(rng, 0, 1));

  // Languages
  await page.selectOption('#languages', String(int(rng, 1, 3))).catch(() => {});
  if (!(await buildIsClean(page))) await page.selectOption('#languages', '1').catch(() => {});

  const final = await page.evaluate(() => {
    const b = window.readBuild();
    const r = window.compute(b);
    const hardWarnings = r.warnings.filter((w) => !window.isAdvisory(w));
    return { total: r.total, budget: r.budget, remaining: r.remaining, status: r.status, hardWarnings, name: b.name };
  });
  return final;
}

async function buildIsClean(page) {
  // Keeps the randomized build inside its AP budget AND free of hard rule warnings
  // (advisory notes like "no Ki-using ability" are fine — that's the one thing
  // isAdvisory() itself excludes from "hard").
  return page.evaluate(() => {
    const r = window.compute(window.readBuild());
    const hard = r.warnings.filter((w) => !window.isAdvisory(w));
    return r.remaining >= 0 && hard.length === 0;
  });
}

async function clickUndo(page) {
  const undo = page.locator('#undoBtn');
  if (await undo.isEnabled().catch(() => false)) await undo.click();
}

async function randomCheckSubset(page, selector, rng, n) {
  const count = await page.locator(selector).count();
  if (!count) return;
  const indices = pickN(rng, Array.from({ length: count }, (_, i) => i), n);
  for (const i of indices) {
    const box = page.locator(selector).nth(i);
    if (await box.isDisabled().catch(() => false)) continue;
    await box.check({ force: false }).catch(() => {});
    if (!(await buildIsClean(page))) await box.uncheck().catch(() => {});
  }
}

// ---------- CharGen <-> Live Sheet: the real one-click "switch tool" button (D-GH38) ----------
// Replaces the old download-a-file/import flow as the primary way a player moves a
// character between the two tools, so this is what the harness drives too: a real
// click, a real navigation, and a same-origin localStorage handoff — the app's own code,
// not a script-side shortcut.
//
// Field list is curated (not a full deep-diff of the whole build): primitives + simple string
// arrays that both readBuild() (CharGen, DOM-driven) and foldBuild(null) (Live Sheet, LOG-driven)
// share and populate the same way. Deliberately excludes fields with legitimately different
// internal shapes between the two representations (armour, traditions, freeSub, customProfs, …) —
// diffing those would risk false positives, not real signal. Was 3 fields (species/originClass/hd);
// this catches a lossy handoff on any of the ~20 fields below instead.
const PORTABLE_PRIMITIVE_FIELDS = ['species', 'species2', 'originClass', 'originClass2', 'hd', 'profBonus', 'hardy', 'tough', 'languages', 'wornArmour', 'martiallyBound', 'lineage', 'extraClasses', 'gold', 'size', 'sorcery', 'ki', 'attune'];
const PORTABLE_ARRAY_FIELDS = ['racialTraits', 'boons', 'drawbacks', 'arts', 'masteries', 'saves', 'skills', 'tools', 'instruments', 'toolExpertise', 'expertise', 'customProfs'];

function portableSnapshot(b) {
  const out = {};
  for (const k of PORTABLE_PRIMITIVE_FIELDS) out[k] = b[k];
  for (const k of PORTABLE_ARRAY_FIELDS) out[k] = (b[k] || []).slice().sort();
  out.stats = Object.assign({ STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, b.stats || {});
  return out;
}
function diffPortableFields(before, after) {
  const mismatches = [];
  for (const k of PORTABLE_PRIMITIVE_FIELDS) if (before[k] !== after[k]) mismatches.push(k);
  for (const k of PORTABLE_ARRAY_FIELDS) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) mismatches.push(k);
  for (const k of Object.keys(before.stats)) if (before.stats[k] !== after.stats[k]) mismatches.push(`stats.${k}`);
  return mismatches;
}

async function switchToLiveSheetViaButton(page) {
  const before = portableSnapshot(await page.evaluate(() => window.readBuild()));
  await page.getByRole('button', { name: /Open in Live Sheet/ }).first().click();
  await page.waitForURL(/PACT-Live-Char-Sheet\.html/);
  await page.waitForFunction(() => typeof window.compute === 'function');
  await page.waitForFunction(() => typeof window.foldBuild === 'function' && window.foldBuild(null).hd >= 1);
  await dismissNamesModalIfOpen(page);
  const after = portableSnapshot(await page.evaluate(() => window.foldBuild(null)));
  const mismatches = diffPortableFields(before, after);
  return { ok: mismatches.length === 0, before, after, mismatches };
}

async function switchToCharGenViaButton(page) {
  const before = portableSnapshot(await page.evaluate(() => window.foldBuild(null)));
  await page.getByRole('button', { name: /Open in CharGen/ }).first().click();
  await page.waitForURL(/PACT-CharGen-Webtool\.html/);
  await page.waitForFunction(() => typeof window.compute === 'function');
  await page.waitForFunction(() => (window.readBuild() || {}).hd >= 1);
  const after = portableSnapshot(await page.evaluate(() => window.readBuild()));
  const mismatches = diffPortableFields(before, after);
  return { ok: mismatches.length === 0, before, after, mismatches };
}

// Several actions (import, leveling into new spell slots, some feature buys) can
// (re)open the "name your spells & languages" modal, which blocks every other click
// on the page until closed — exactly what a human would have to do too.
async function dismissNamesModalIfOpen(page) {
  if (await page.locator('#namesOv').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Skip for now' }).click().catch(() => {});
  }
}

// Undo-then-redo must be a true round trip: the folded build after undo+redo must be
// identical to the build right before undo was called. Previously entirely unchecked.
// Calls undo()/redo() directly (not a DOM click) — Live Sheet has TWO Undo buttons on the page
// (desktop toolbar + mobile action bar), both wired to the exact same onclick="undo()", so a
// role-based click would be Playwright-strict-mode-ambiguous; calling the function they both
// invoke exercises identical app code without that ambiguity.
//
// Compares the FOLDED BUILD, not raw LOG length/contents: undo() permanently drops any trailing
// `rulesSnapshot` events (sync-written metadata, never redo-restorable by design — see
// D-GH-2026-07-13-campaign-rules-snapshot) before it even reaches the real undo target, so LOG
// length/shape after a genuine undo+redo round trip can legitimately differ from before. Since
// `rulesSnapshot` is engine-inert (never read by `foldBuild()`/`_replay()`), the folded build is
// the correct, drop-immune invariant — it's unaffected by whether snapshot events happen to be
// present, absent, or mid-drop, and this also means no LOG-length pre-check is needed to skip a
// no-op undo (award-locked / empty LOG): the build is trivially unchanged in that case too.
async function checkUndoRedoRoundTrip(page, rng, label) {
  const notes = [];
  if (!chance(rng, 0.6)) return notes; // sampled, not every level — keep the advancement loop light
  const before = await page.evaluate(() => window.foldBuild(null));
  await page.evaluate(() => window.undo());
  await page.waitForTimeout(30);
  await page.evaluate(() => window.redo());
  await page.waitForTimeout(30);
  const after = await page.evaluate(() => window.foldBuild(null));
  if (!deepEqualJSON(after, before)) notes.push(`[oracle:${label}] undo/redo round trip: folded build differs after undo-then-redo (should be identical to the build right before undo)`);
  return notes;
}

// ---------- Live Sheet: advancement via real buy-panel clicks ----------
async function advanceCharacter(page, rng, state, levels) {
  const report = { levelsGranted: 0, purchasesAttempted: 0, purchasesApplied: 0, invariantFailures: [] };

  for (let lvl = 0; lvl < levels; lvl++) {
    await dismissNamesModalIfOpen(page);
    const delta = await page.evaluate(() => window.levelDelta(window.foldBuild(null).hd));
    if (delta <= 0) { log('at HD cap — stopping advancement'); break; }

    // "+ Award AP" — real button, prompt()-driven
    state.awardAmount = delta;
    state.awardNote = `Automated random advancement test — level ${(await page.evaluate(() => window.foldBuild(null).hd)) + 1}`;
    const logBefore = await page.evaluate(() => LOG.length);
    await page.getByRole('button', { name: '+ Award AP' }).click();
    await page.waitForFunction((n) => LOG.length > n, logBefore, { timeout: 3000 }).catch(() => {});
    await dismissNamesModalIfOpen(page);

    // "Level up → Hit Die N" tile — buys the actual HD increase
    const hdBtn = page.locator('#buy .ib:not(.dis)', { hasText: 'Level up → Hit Die' }).first();
    if (await hdBtn.count()) {
      await hdBtn.click();
      await dismissNamesModalIfOpen(page);
      report.levelsGranted++;
    } else {
      report.invariantFailures.push(`level ${lvl}: no affordable "Level up" tile found`);
    }

    // Spend the rest of the award on random buy-panel tiles — real clicks, our RNG
    // choosing WHICH tile, not the app rolling anything.
    let attempts = 0;
    const maxAttempts = 25;
    while (attempts < maxAttempts) {
      attempts++;
      const apLeft = await page.locator('#apFloatN').innerText().then(Number).catch(() => 0);
      if (!(apLeft > 0)) break;

      const tiles = await page.locator('#buy .ib:not(.dis)').all();
      if (!tiles.length) break;
      const tile = pick(rng, tiles);
      const before = await page.evaluate(() => LOG.length);
      report.purchasesAttempted++;
      await tile.click().catch(() => {});
      await page.waitForTimeout(50); // let dialog-driven render settle
      await dismissNamesModalIfOpen(page);
      const after = await page.evaluate(() => LOG.length);
      if (after > before) report.purchasesApplied++;
    }

    // Invariants after this level's spending pass
    const inv = await page.evaluate(() => {
      const b = window.foldBuild(null);
      const r = window.compute(b);
      const eco = window.economy(null);
      return { apLeft: eco.available, hp: r.hp, ac: r.ac, hd: b.hd };
    });
    const apFloatShown = await page.locator('#apFloatN').innerText().then(Number).catch(() => NaN);
    if (inv.apLeft < 0) report.invariantFailures.push(`level ${lvl}: AP available went negative (${inv.apLeft})`);
    if (!Number.isNaN(apFloatShown) && apFloatShown !== inv.apLeft) {
      report.invariantFailures.push(`level ${lvl}: displayed AP (${apFloatShown}) != economy().available (${inv.apLeft})`);
    }
    const trayText = await page.locator('#tray').innerText().catch(() => '');
    log(`  level ${lvl + 1}: HD=${inv.hd} HP=${inv.hp} AC=${inv.ac} AP-left=${inv.apLeft} tray="${trayText.slice(0, 60).replace(/\n/g, ' ')}"`);

    report.invariantFailures.push(...(await checkUndoRedoRoundTrip(page, rng, `livesheet-lvl${lvl + 1}`)));
  }

  return report;
}

// ---------- DM Console: real drag-and-drop import + roster verification ----------
// DM Console's roster view needs no cloud/auth at all — files land in localStorage via a
// plain <input type=file> (#fileInput), read by `handleFiles()` -> `dmAnalyze()`. That's the
// only DM Console surface this harness drives; award-AP/campaign-rules are cloud-gated and
// out of scope here (see file header).
async function exportCurrentCharGenCharacter(page) {
  return page.evaluate(() => {
    const envelope = window._cgEnvelope();
    const b = window.readBuild();
    const r = window.compute(b);
    const eco = window.economy(LOG);
    return {
      envelope,
      expected: { species: b.species, originClass: b.originClass, hd: b.hd, hp: r.hp, ac: r.ac, available: eco.available },
    };
  });
}

async function readDmRosterRow(page) {
  return page.evaluate(() => {
    const headerCells = Array.from(document.querySelectorAll('#thead th[data-key]'));
    const keys = headerCells.map((th) => th.getAttribute('data-key'));
    const tr = document.querySelector('#tbody tr.data');
    if (!tr) return null;
    const cells = Array.from(tr.querySelectorAll('td')).slice(1); // skip the expand-chevron <td>
    const row = {};
    keys.forEach((k, i) => { row[k] = cells[i] ? cells[i].textContent.trim() : undefined; });
    return row;
  });
}

async function testDmConsole(context, baseUrl, exported) {
  const report = { ok: true, notes: [] };
  const page = await context.newPage();
  try {
    // DM Console's module bridge also imports auth.js/campaign.js/dm.js, which pull in the
    // same esm.sh Supabase import as the other two tools — needs its own stub, since
    // page.route() is per-page, not per-context.
    await stubSupabaseCdn(page);
    await page.goto(`${baseUrl}/PACT/tools/DM-Console.html`);
    await page.waitForFunction(() => typeof window.compute === 'function');

    // Real drag-drop's underlying control — same file input a human's file picker uses.
    await page.setInputFiles('#fileInput', {
      name: 'e2e-character.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported.envelope)),
    });
    await page.waitForSelector('.card[data-id]', { timeout: 5000 });

    // Card view (the default) — smoke-check it rendered species/class without throwing.
    const cardText = await page.locator('.card[data-id]').first().innerText().catch(() => '');
    if (!cardText.includes(exported.expected.species || '')) {
      report.notes.push(`card view missing species "${exported.expected.species}": "${cardText.slice(0, 120)}"`);
    }

    // Table view has the "AP Avail" column the card strip doesn't show — switch via the
    // real "▦ Table view" toggle button, then read the row back keyed by column, not
    // position, so it stays correct regardless of which columns are hidden.
    await page.getByRole('button', { name: /Table view/ }).click();
    await page.waitForSelector('#tbody tr.data', { timeout: 5000 });
    const row = await readDmRosterRow(page);
    if (!row) {
      report.notes.push('no roster row rendered in table view after import');
    } else {
      const exp = exported.expected;
      if (row.species && !row.species.includes(exp.species)) report.notes.push(`species mismatch: roster "${row.species}" vs source "${exp.species}"`);
      if (row.class && !row.class.includes(exp.originClass)) report.notes.push(`class mismatch: roster "${row.class}" vs source "${exp.originClass}"`);
      if (row.hp !== undefined && Number(row.hp) !== exp.hp) report.notes.push(`HP mismatch: roster ${row.hp} vs source ${exp.hp}`);
      const acShown = Number((row.ac || '').split('/')[0].trim());
      if (!Number.isNaN(acShown) && acShown !== exp.ac) report.notes.push(`AC mismatch: roster ${acShown} vs source ${exp.ac}`);
      const availShown = Number((row.available || '').replace('+', '').trim());
      if (!Number.isNaN(availShown) && availShown !== exp.available) report.notes.push(`AP-available mismatch: roster ${availShown} vs source ${exp.available} (dmAnalyze()/engine bridge drift)`);
    }

    // Smoke-test the two overlay buttons and the column-visibility toggle — real clicks,
    // just confirming they open/close and don't throw against this imported character.
    for (const btnName of [/Skill Matrix/, /AP Ledger/]) {
      await page.getByRole('button', { name: btnName }).click();
      const opened = await page.waitForSelector('#ov.on', { timeout: 2000 }).then(() => true).catch(() => false);
      if (!opened) report.notes.push(`overlay "${btnName}" did not open`);
      await page.locator('#ovX').click().catch(() => {});
    }
    await page.locator('#colBtn').click();
    await page.locator('#colPanel input[data-k="earned"]').check().catch(() => {});
    const earnedShown = await page.waitForSelector('#thead th[data-key="earned"]', { timeout: 2000 }).then(() => true).catch(() => false);
    if (!earnedShown) report.notes.push('"AP Earned" column did not appear after enabling it via the column toggle');

    report.ok = report.notes.length === 0;
  } catch (e) {
    report.ok = false;
    report.notes.push(`exception: ${e.message}`);
  } finally {
    await page.close();
  }
  return report;
}

// ---------- main ----------
async function main() {
  await ensurePactSymlink();
  // A completely separate module instantiation of the SAME js/engine.js source the browser
  // bridges onto window — this is what makes the Phase-1 oracle checks (see file header)
  // independent rather than self-referential.
  const ENGINE = await import(pathToFileURL(path.join(REPO_ROOT, 'js', 'engine.js')).href);
  const port = 8000 + (SEED % 500);
  const server = await startServer(port);
  const baseUrl = `http://localhost:${port}`;
  log(`serving ${PARENT_DIR} on ${baseUrl} (seed=${SEED}, iterations=${ITERATIONS}, levels=${LEVELS_PER_CHAR})`);

  const results = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: !HEADED });
    for (let i = 0; i < ITERATIONS; i++) {
      const iterSeed = SEED + i * 7919;
      const rng = mulberry32(iterSeed);
      log(`\n=== iteration ${i + 1}/${ITERATIONS} (seed ${iterSeed}) ===`);

      const context = await browser.newContext();
      const page = await context.newPage();
      page.__baseUrl = baseUrl;
      await stubSupabaseCdn(page);
      const state = { rng, awardAmount: 0, awardNote: '', acceptSoftWarnProb: 0.5, softWarnAccepted: 0, softWarnDeclined: 0, hardBlocked: 0 };
      wireDialogs(page, state);

      const iterResult = { seed: iterSeed, ok: true, notes: [] };
      try {
        const genReport = await randomizeCharGen(page, rng);
        log(`generated: ${JSON.stringify({ name: genReport.name, total: genReport.total, budget: genReport.budget, remaining: genReport.remaining })}`);
        if (genReport.remaining < 0) iterResult.notes.push(`char-gen over budget by ${-genReport.remaining} AP`);
        if (genReport.hardWarnings.length) iterResult.notes.push(`char-gen has ${genReport.hardWarnings.length} unresolved warning(s): ${genReport.hardWarnings.slice(0, 3).join(' | ')}`);
        iterResult.notes.push(...(await checkEngineInvariants(ENGINE, page, 'chargen')));

        const toLiveSheet = await switchToLiveSheetViaButton(page);
        if (!toLiveSheet.ok) iterResult.notes.push(`switch to Live Sheet lost data: ${JSON.stringify(toLiveSheet.mismatches)} (before=${JSON.stringify(toLiveSheet.before)} after=${JSON.stringify(toLiveSheet.after)})`);

        const advReport = await advanceCharacter(page, rng, state, LEVELS_PER_CHAR);
        log(`advancement: levelsGranted=${advReport.levelsGranted} purchases=${advReport.purchasesApplied}/${advReport.purchasesAttempted} softWarnAccepted=${state.softWarnAccepted} softWarnDeclined=${state.softWarnDeclined} hardBlocked=${state.hardBlocked}`);
        if (advReport.invariantFailures.length) iterResult.notes.push(...advReport.invariantFailures);
        iterResult.notes.push(...(await checkEngineInvariants(ENGINE, page, 'livesheet', { fullCrossCheck: true })));

        // Round-trip back to CharGen — the reverse direction of the same handoff feature,
        // now carrying the leveled-up character (HD > 1) instead of a fresh one.
        const toCharGen = await switchToCharGenViaButton(page);
        if (!toCharGen.ok) iterResult.notes.push(`switch back to CharGen lost data: ${JSON.stringify(toCharGen.mismatches)} (before=${JSON.stringify(toCharGen.before)} after=${JSON.stringify(toCharGen.after)})`);

        // DM Console: real file-drop import of the same finished character, cross-checked
        // against the source tool's own numbers (see testDmConsole's comment for why).
        const exported = await exportCurrentCharGenCharacter(page);
        const dmReport = await testDmConsole(context, baseUrl, exported);
        log(`DM Console import: ${dmReport.ok ? 'PASS' : 'FAIL'}${dmReport.notes.length ? ' — ' + dmReport.notes.join(' ; ') : ''}`);
        if (dmReport.notes.length) iterResult.notes.push(...dmReport.notes.map((n) => `[dm-console] ${n}`));

        iterResult.ok = iterResult.notes.length === 0;
      } catch (e) {
        iterResult.ok = false;
        iterResult.notes.push(`exception: ${e.message}`);
      } finally {
        if (!KEEP_OPEN) await context.close();
      }
      results.push(iterResult);
    }
  } finally {
    if (browser && !KEEP_OPEN) await browser.close();
    server.kill();
    await once(server, 'exit').catch(() => {});
  }

  log('\n=== summary ===');
  let anyFail = false;
  for (const r of results) {
    const status = r.ok ? 'PASS' : 'FAIL';
    if (!r.ok) anyFail = true;
    log(`  seed ${r.seed}: ${status}${r.notes.length ? ' — ' + r.notes.join(' ; ') : ''}`);
  }
  log(`${results.filter((r) => r.ok).length}/${results.length} iterations passed`);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
