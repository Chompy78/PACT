#!/usr/bin/env node
/**
 * sync-autosave-toggle-ci.mjs — the gate for setAutosaveEnabled() (js/sync.js, D-GH-2026-08-08-
 * universal-autosave-toggle, Part B3).
 *
 * WHY THIS EXISTS. `/code-review ultra` on the B3 branch caught two real bugs in setAutosaveEnabled()
 * before merge, neither of them hypothetical:
 *
 *  1. characters.updated_at is bumped by an unconditional BEFORE UPDATE trigger (schema.sql
 *     trg_characters_updated_at, no column filter) — so toggling autosave alone still moves the
 *     server's updated_at forward. Without re-pinning base_updated_at/_pageBase to that new value,
 *     THIS PAGE'S very next real save presented the now-stale old base, pushCharacter()'s optimistic-
 *     concurrency guard refused it, and the UI reported "changed on another device" for no reason
 *     other than the user flipping their own checkbox.
 *  2. Toggling autosave on a character with no local cache yet (a brand-new build, never edited/
 *     saved/loaded this device) silently no-opped — the optimistic write only ran `if (before)`.
 *     getAutosaveEnabled() kept reading the DB default forever and the toggle UI visibly snapped back
 *     to checked on its next render — the user's explicit "off" choice was discarded, not merely
 *     delayed.
 *
 * Both were fixed in the same change; this script proves it DIFFERENTIALLY (fails on the pre-fix
 * source, passes on the current one) rather than just asserting current behaviour is correct, which
 * would prove nothing about whether it was ever broken. See testing/scripts/sync-concurrency-ci.mjs's
 * own header for why that principle matters here specifically.
 *
 * A minimal in-process fake Supabase stands in for the real client — no network, no Supabase project
 * needed. It reproduces exactly the one behaviour these bugs depend on: an UPDATE bumps updated_at
 * even when the caller didn't ask it to.
 *
 * Run:  node testing/scripts/sync-autosave-toggle-ci.mjs        (expect 0 failed; exits non-zero otherwise)
 * Uses only Node built-ins — no npm, no browser, no network. See docs/HOW-TO-WORK.md.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'pact-autosave-toggle-'));
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// --- the stubbed world: one server row, localStorage per profile, a real BEFORE-UPDATE-style trigger ---
writeFileSync(join(dir, 'world.js'), `
export const server = { row: null, clock: 100 };
const stamp = () => new Date(1700000000000 + (++server.clock) * 1000).toISOString();
export function makeLS(){ const m = new Map(); return {
  getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k) }; }

// Mirrors the real Supabase client's shape closely enough for js/sync.js's own calls: chainable
// .from().update()/.insert()/.select() with .eq()/.maybeSingle(). The one load-bearing behaviour:
// EVERY successful update/insert bumps updated_at, matching the real DB's unconditional trigger --
// this is the exact mechanism bug (1) above depends on.
export function makeSupabase(){
  return { from(table){
    return {
      update(patch){
        let filters = {};
        const chain = { eq(col,val){ filters[col]=val; return chain; },
          select(cols){ return (async () => {
            if (!server.row || server.row.id !== filters.id) return { data: [], error: null };
            if ('updated_at' in filters && server.row.updated_at !== filters.updated_at) return { data: [], error: null };
            Object.assign(server.row, patch);
            server.row.updated_at = stamp();
            return { data: [{ ...server.row }], error: null };
          })(); } };
        return chain;
      },
      insert(row){
        return { select(cols){ return (async () => {
          server.row = { ...row, updated_at: stamp(), ap: 0 };
          return { data: [{ ...server.row }], error: null };
        })(); } };
      },
      select(cols){
        let filters = {};
        const chain = { eq(col,val){ filters[col]=val; return chain; },
          maybeSingle: async () => {
            if (!server.row || server.row.id !== filters.id) return { data: null, error: null };
            return { data: { ...server.row }, error: null };
          } };
        return chain;
      }
    };
  } };
}
`);

async function buildAndRun(syncSrcPath) {
  writeFileSync(join(dir, 'supabase-client.js'),
    `import { makeSupabase } from './world.js';\nexport const supabase = makeSupabase();\nexport function withKeepalive(fn){ return fn(); }\n`);
  writeFileSync(join(dir, 'auth.js'),
    `export async function currentUser(){ return {id:'me'}; }\nexport async function currentSession(){ return {user:{id:'me'}}; }\nexport function onSessionChange(){}\nexport function onAuthChange(){}\n`);
  // character-store.js imports signPayload/verifyPayload from engine.js -- stubbed, since signing is
  // orthogonal to what this script tests (saveCharacter() is always called with {sign:false} equivalents
  // via the tools; the module bridge just needs to resolve).
  writeFileSync(join(dir, 'engine.js'),
    `export function signPayload(x){ return {}; }\nexport function verifyPayload(){ return {ok:true}; }\n`);
  writeFileSync(join(dir, 'character-store.js'), readFileSync(join(REPO, 'js/character-store.js'), 'utf8'));

  let src = readFileSync(syncSrcPath, 'utf8');
  // Inject a Node-safe navigator/localStorage the same way sync-concurrency-ci.mjs's harness does --
  // real Node has no `navigator` global, and this file's own module scope needs its own localStorage
  // per run (a fresh one per buildAndRun call, so pre-fix/post-fix runs don't share state).
  src = src.replace("import { supabase, withKeepalive } from './supabase-client.js';",
    "import { supabase, withKeepalive } from './supabase-client.js';\nconst navigator = { onLine: true };\nconst localStorage = (await import('./world.js')).makeLS();");
  writeFileSync(join(dir, 'sync-under-test.mjs'), src);

  const mod = await import(pathToFileURL(join(dir, 'sync-under-test.mjs')).href + `?t=${Date.now()}${Math.random()}`);
  const { server } = await import(pathToFileURL(join(dir, 'world.js')).href);
  return { mod, server };
}

async function runScenario(syncSrcPath, label) {
  console.log(`\n${label}`);
  const { mod, server } = await buildAndRun(syncSrcPath);
  server.row = null; server.clock = 100;

  const results = {};

  // Bug 1: toggle on an already-saved character, then a real edit-save must not get a false conflict.
  const id1 = 'aaaaaaaa-1111-4111-8111-111111111111';
  await mod.saveCharacter({ id: id1, name: 'X', kind: 'chargen', stats: { LOG: [], SEQ: 1 }, campaignId: null });
  await mod.setAutosaveEnabled(id1, false);
  const res1 = await mod.saveCharacter({ id: id1, name: 'X', kind: 'chargen', stats: { LOG: [1], SEQ: 2 }, campaignId: null });
  results.noFalseConflict = res1.conflict !== true && res1.synced === true;

  // Bug 2: toggle a never-cached character; the choice must survive, including through the eventual
  // first real save (not silently reset back to the column default).
  const id2 = 'bbbbbbbb-2222-4222-8222-222222222222';
  await mod.setAutosaveEnabled(id2, false);
  results.persistsBeforeFirstSave = mod.getAutosaveEnabled(id2) === false;
  const res2 = await mod.saveCharacter({ id: id2, name: 'Y', kind: 'chargen', stats: { LOG: [], SEQ: 1 }, campaignId: null });
  results.firstSaveSucceeds = res2.synced === true;
  results.survivesFirstSave = mod.getAutosaveEnabled(id2) === false;

  return results;
}

const preFix = execSync(`git -C ${REPO} show HEAD:js/sync.js`, { encoding: 'utf8' });
const preFixPath = join(dir, 'sync-pre-fix.js');
writeFileSync(preFixPath, preFix);

const pre = await runScenario(preFixPath, 'Against HEAD (may be pre-fix or post-fix depending on when this runs):');
const post = await runScenario(resolve(REPO, 'js/sync.js'), 'Against the working tree (should always be the fixed version):');

ok('toggling autosave off then saving does NOT produce a false conflict', post.noFalseConflict);
ok('toggling a never-cached character persists the choice before any save', post.persistsBeforeFirstSave);
ok('the first real save after a pre-save toggle still succeeds', post.firstSaveSucceeds);
ok('after the first save, the toggle choice is not silently reset', post.survivesFirstSave);

// Differential proof: this only means something if the CURRENT HEAD (the pre-fix commit at the time
// this test was written) actually fails these checks. If a future reader runs this against a HEAD that
// already contains the fix, `pre` will legitimately also pass -- that's fine, it just means the
// differential leg is no longer exercising the bug, not that the test is broken.
const preFailedSomething = !pre.noFalseConflict || !pre.persistsBeforeFirstSave || !pre.survivesFirstSave;
console.log(`\n(differential leg against HEAD: ${preFailedSomething ? 'reproduced the bug, as expected at write-time' : 'HEAD already has the fix'})`);

rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
