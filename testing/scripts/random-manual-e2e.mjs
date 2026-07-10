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
import { fileURLToPath } from 'node:url';

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
// js/supabase-client.js does `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'`
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
  await page.route('https://esm.sh/@supabase/supabase-js@2', (route) =>
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
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start in time')), 8000);
    const onData = (d) => {
      if (String(d).includes('Serving HTTP')) { clearTimeout(t); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  try {
    await ready;
  } catch (e) {
    child.kill(); // don't leak a bound port on startup failure
    throw e;
  }
  return child;
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
async function switchToLiveSheetViaButton(page) {
  const before = await page.evaluate(() => {
    const b = window.readBuild();
    return { species: b.species, originClass: b.originClass, hd: b.hd, total: window.compute(b).total };
  });
  await page.getByRole('button', { name: /Open in Live Sheet/ }).first().click();
  await page.waitForURL(/PACT-Live-Char-Sheet\.html/);
  await page.waitForFunction(() => typeof window.compute === 'function');
  await page.waitForFunction(() => typeof window.foldBuild === 'function' && window.foldBuild(null).hd >= 1);
  await dismissNamesModalIfOpen(page);
  const after = await page.evaluate(() => {
    const b = window.foldBuild(null);
    return { species: b.species, originClass: b.originClass, hd: b.hd };
  });
  const mismatches = ['species', 'originClass', 'hd'].filter((k) => before[k] !== after[k]);
  return { ok: mismatches.length === 0, before, after, mismatches };
}

async function switchToCharGenViaButton(page) {
  const before = await page.evaluate(() => {
    const b = window.foldBuild(null);
    return { species: b.species, originClass: b.originClass, hd: b.hd };
  });
  await page.getByRole('button', { name: /Open in CharGen/ }).first().click();
  await page.waitForURL(/PACT-CharGen-Webtool\.html/);
  await page.waitForFunction(() => typeof window.compute === 'function');
  await page.waitForFunction(() => (window.readBuild() || {}).hd >= 1);
  const after = await page.evaluate(() => {
    const b = window.readBuild();
    return { species: b.species, originClass: b.originClass, hd: b.hd };
  });
  const mismatches = ['species', 'originClass', 'hd'].filter((k) => before[k] !== after[k]);
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
  }

  return report;
}

// ---------- main ----------
async function main() {
  await ensurePactSymlink();
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

        const toLiveSheet = await switchToLiveSheetViaButton(page);
        if (!toLiveSheet.ok) iterResult.notes.push(`switch to Live Sheet lost data: ${JSON.stringify(toLiveSheet.mismatches)} (before=${JSON.stringify(toLiveSheet.before)} after=${JSON.stringify(toLiveSheet.after)})`);

        const advReport = await advanceCharacter(page, rng, state, LEVELS_PER_CHAR);
        log(`advancement: levelsGranted=${advReport.levelsGranted} purchases=${advReport.purchasesApplied}/${advReport.purchasesAttempted} softWarnAccepted=${state.softWarnAccepted} softWarnDeclined=${state.softWarnDeclined} hardBlocked=${state.hardBlocked}`);
        if (advReport.invariantFailures.length) iterResult.notes.push(...advReport.invariantFailures);

        // Round-trip back to CharGen — the reverse direction of the same handoff feature,
        // now carrying the leveled-up character (HD > 1) instead of a fresh one.
        const toCharGen = await switchToCharGenViaButton(page);
        if (!toCharGen.ok) iterResult.notes.push(`switch back to CharGen lost data: ${JSON.stringify(toCharGen.mismatches)} (before=${JSON.stringify(toCharGen.before)} after=${JSON.stringify(toCharGen.after)})`);

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
