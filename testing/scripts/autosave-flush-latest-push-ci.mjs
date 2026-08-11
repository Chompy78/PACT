#!/usr/bin/env node
/**
 * autosave-flush-latest-push-ci.mjs — the gate for fix/autosave-flush-latest-push
 * (Addendum on D-GH-2026-08-08-chargen-cloud-autosave-flush — decisions/2026/
 * D-GH-2026-08-08-chargen-cloud-autosave-flush.md).
 *
 * WHY THIS EXISTS. `_cgFlushCloudSaveNow()`/`_lsFlushCloudSaveNow()` (tools/PACT-CharGen-Webtool.html,
 * tools/PACT-Live-Char-Sheet.html) exist so a deliberate tool-switch navigation (switchToLiveSheet/
 * switchToCharGen) never abandons a pending cloud autosave on its debounce timer. But when a push was
 * ALREADY in flight at the moment of the switch, `_cgCloudPush()`'s busy branch returned the STALE,
 * already-running push's promise instead of the promise for the RETRY it queues via
 * `_cgCloudSaveAgain` — the retry that actually carries whatever the latest edit was. The flush's
 * `Promise.race` resolved on the stale push, the switch navigated away, and the real retry fired later
 * from a `.finally()` callback with no keepalive, right as the page was tearing down. Found by
 * `/code-review ultra` on the B3 (universal autosave) branch — a pre-existing bug in CharGen's already-
 * shipped push-overlap machinery, freshly replicated into Live Sheet's new B3 autosave scaffolding.
 *
 * Both tools' `_cgCloudPush`/`_cgCloudPushSettled`/`_cgFlushCloudSaveNow` (and Live Sheet's `_ls*`
 * twins) are plain global functions in a classic (non-module) `<script>` block — no DOM/network
 * dependency once `_cgCloudPushOnce`/`_cgAutosaveGate` are stubbed out, so this runs the REAL extracted
 * source in a sandboxed Node context, same "extract real source, stub its dependencies, replay real
 * async sequences" technique sync-concurrency-ci.mjs already established for js/sync.js — just applied
 * to an inline snippet instead of an importable module.
 *
 * DIFFERENTIAL, same discipline as sync-concurrency-ci.mjs: `_cgCloudPush`/`_cgFlushCloudSaveNow` are
 * spliced out (by brace-matched function-body extraction, not line numbers or comment-text matching —
 * robust to either tool's comments differing in wording) and replaced with their literal PRE-FIX
 * bodies, then run through the identical scenario first — it must show the exact bug this fix closes,
 * so a gate that would pass on broken code either way is caught immediately rather than trusted blind.
 *
 * Run:  node testing/scripts/autosave-flush-latest-push-ci.mjs   (expect 0 failed)
 * Uses only Node built-ins — no npm, no browser, no network. See docs/HOW-TO-WORK.md.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'pact-autosave-flush-'));
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); };
let seq = 0;
const freshFile = (name) => `${name}-${++seq}.mjs`;

const TOOLS = [
  { file: 'tools/PACT-CharGen-Webtool.html', prefix: '_cg', label: 'CharGen' },
  { file: 'tools/PACT-Live-Char-Sheet.html', prefix: '_ls', label: 'Live Sheet' },
];

// Extract the push-queue block: from the state-vars line through the pagehide handler's closing
// `});` — the exact span this fix touched. Anchored on stable, literal text (not line numbers).
function extractBlock(src, p) {
  const startMarker = `var ${p}CloudSaveTimer=null`;
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) throw new Error(`${p}: could not find start marker "${startMarker}" — has the file's shape changed?`);
  const pagehideMarker = `window.addEventListener('pagehide',function(){`;
  const pagehideIdx = src.indexOf(pagehideMarker, startIdx);
  if (pagehideIdx < 0) throw new Error(`${p}: could not find the pagehide handler after the state-vars line`);
  const closeIdx = matchingBraceEnd(src, src.indexOf('{', pagehideIdx));
  return src.slice(startIdx, closeIdx + '});'.length - 1 + 2);   // include the trailing "});"
}

// Given the index of an opening '{' in `src`, returns the index of its matching '}' (brace-depth
// counted, ignoring braces inside string/template literals and comments well enough for this file's
// actual style — no braces appear inside this block's own string literals or comments).
function matchingBraceEnd(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('unbalanced braces — could not find a matching close');
}

// Replaces the ENTIRE body of `function <name>(...){ ... }` (found anywhere in `src`, brace-matched)
// with `newBody` (including its own braces). Used to splice in the literal pre-fix implementation for
// the differential leg — robust to comment wording, unlike a text-based revert.
function replaceFunctionBody(src, name, newBody) {
  const sigIdx = src.indexOf(`function ${name}(`);
  if (sigIdx < 0) throw new Error(`could not find "function ${name}("`);
  const openIdx = src.indexOf('{', sigIdx);
  const closeIdx = matchingBraceEnd(src, openIdx);
  return src.slice(0, openIdx) + newBody + src.slice(closeIdx + 1);
}

// The exact pre-fix bodies (literal, not derived from the live file) — this is what shipped before
// today's fix: the busy branch returned the stale in-flight promise directly, and the flush trusted
// _cgCloudPush()'s own return value instead of a dedicated settle-the-whole-queue wait.
function preFixBodies(p) {
  return {
    push: `{\n  if(${p}CloudSaveBusy){${p}CloudSaveAgain=true;return ${p}CloudPushPromise;}\n  ${p}CloudSaveBusy=true;\n  ${p}CloudPushPromise=${p}CloudPushOnce().finally(function(){\n    ${p}CloudSaveBusy=false;\n    if(${p}CloudSaveAgain){${p}CloudSaveAgain=false;${p}CloudPush();}\n  });\n  return ${p}CloudPushPromise;\n}`,
    flush: `{\n  var pending=${p}CloudSaveTimer!=null||${p}CloudSaveBusy;\n  if(${p}CloudSaveTimer!=null){clearTimeout(${p}CloudSaveTimer);${p}CloudSaveTimer=null;}\n  if(!pending) return Promise.resolve();\n  if(!${p}AutosaveGate()) return Promise.resolve();\n  var pushed=${p}CloudPush();\n  if(!pushed) return Promise.resolve();\n  return Promise.race([pushed.catch(function(){}),new Promise(function(res){setTimeout(res,timeoutMs);})]);\n}`,
    // fix/manual-save-queue-bypass: the shape onSaveClick()/onJoinCampaignClick() used before this fix
    // — a raw, uncoordinated call straight to saveCharacter, with no regard for whether an autosave push
    // was already in flight for the same character.
    queuedSave: `{\n  return window._syncBridge.saveCharacter(args);\n}`,
  };
}

// Wraps an extracted (or reverted) block with stubbed dependencies and exports the handles the
// scenario needs. `window`/`navigator` are minimal objects, not the real DOM. `_cgAutosaveGate`/
// `_cgCloudPushOnce` are stubbed — this test is entirely about the promise-orchestration logic around
// them, not the real network write or the real gate conditions (those are covered by tool-pricing-
// ci.mjs / manual QA instead).
function wrapModule(block, p) {
  // The extracted block already DEFINES _cgAutosaveGate/_cgCloudPushOnce (they live in the same span,
  // right alongside the state vars) -- real-DOM-dependent (window._cloudSignedIn, navigator.onLine,
  // real Supabase writes), so their bodies are swapped for stubs here rather than declared a second
  // time (which would be a duplicate-declaration SyntaxError, not a silent shadow, in an ES module).
  block = replaceFunctionBody(block, `${p}AutosaveGate`, '{ return true; }');
  // feat/keepalive-scope-narrowing (A2): _cgCloudPushOnce/_lsCloudPushOnce's real body is still stubbed
  // out (it does real DOM/network work this test has no business exercising), but the stub now routes
  // its fake delayed "network call" through the REAL, unstubbed ${p}KeepaliveWrap — that's the function
  // the narrowing fix actually lives in, so this is what makes the per-attempt keepalive-scoping logic
  // itself part of what's under test, not just faked away along with the network call.
  block = replaceFunctionBody(block, `${p}CloudPushOnce`, `{
    const delay = delays.length ? delays.shift() : 20;
    const idx = calls.length;
    calls.push({ start: Date.now(), end: null });
    return ${p}KeepaliveWrap(function(){
      return new Promise((res) => setTimeout(() => { calls[idx].end = Date.now(); res(); }, delay));
    });
  }`);
  return `
export const calls = [];            // one entry per ${p}CloudPushOnce() invocation: {start, end}
export const directCalls = [];      // one entry per window._syncBridge.saveCharacter() invocation made
                                     // DIRECTLY (i.e. the manual-save path, not the autosave queue's own
                                     // ${p}CloudPushOnce()) -- {start, end}. fix/manual-save-queue-bypass.
export const delays = [];           // per-call delay in ms, shift()ed off; default 20ms once empty
export const directDelays = [];     // same, for directCalls; default 20ms once empty
export const keepaliveSpans = [];   // {startCall, endCall}: one entry per push ATTEMPT that opted into
                                     // keepalive (feat/keepalive-scope-narrowing, A2) -- startCall/endCall
                                     // are both the calls.length snapshot around just that one attempt,
                                     // so a span's own delta (endCall-startCall) being 0 proves it stayed
                                     // narrow (didn't stay open while some OTHER call also ran).
const pagehideHandlers = [];
const window = {
  _syncBridge: {
    withKeepalive: async (fn) => {
      const span = { startCall: calls.length, endCall: null };
      keepaliveSpans.push(span);
      try { return await fn(); } finally { span.endCall = calls.length; }
    },
    // fix/manual-save-queue-bypass: a separate stub/log from ${p}CloudPushOnce()'s (calls) on purpose —
    // the whole point of this scenario is to observe whether a manual save's OWN network call starts
    // while an autosave push's network call is still in flight, so they need independent timelines.
    saveCharacter: (args) => {
      const delay = directDelays.length ? directDelays.shift() : 20;
      const idx = directCalls.length;
      directCalls.push({ start: Date.now(), end: null, args });
      return new Promise((res) => setTimeout(() => { directCalls[idx].end = Date.now(); res({ id: args.id }); }, delay));
    },
  },
  addEventListener: (name, fn) => { if (name === 'pagehide') pagehideHandlers.push(fn); },
};
${block}
export function push(){ return ${p}CloudPush(); }
export function flush(ms){ return ${p}FlushCloudSaveNow(ms); }
export function firePagehide(){ pagehideHandlers.forEach((fn) => fn()); }
export function manualSave(args){ return ${p}QueuedSaveCharacter(args); }
`;
}

// The exact scenario the task names: push A starts (slow), an edit lands while it's in flight (a
// second push() call, marking the retry flag), then — before A resolves — a flush fires (the
// deliberate tool-switch navigation). A correct flush waits for the RETRY (call #2), which carries the
// edit that arrived during A's flight, not just for A itself to settle.
async function runOverlapThenFlush(mod) {
  mod.delays.push(60, 20);   // call 1 (A): 60ms.  call 2 (the retry, B): 20ms.
  const pA = mod.push();
  await new Promise((r) => setTimeout(r, 10));
  mod.push();                       // mid-flight edit -> marks the retry flag, chains onto A
  const flushed = mod.flush(2500);  // the deliberate navigation's flush
  await flushed;
  await pA.catch(() => {});
  return mod.calls;
}

// fix/manual-save-queue-bypass: an autosave push starts (slow), then — while it's still in flight — the
// user clicks the manual "Save to cloud" button. A correct queuedSave() waits for the in-flight autosave
// push to fully settle before dispatching its OWN network call, instead of racing it (see
// _cgQueuedSaveCharacter's own comment for why an unguarded second concurrent write is unsafe).
async function runAutosaveThenManualSave(mod) {
  mod.delays.push(60);        // the in-flight autosave push's own network call: 60ms
  mod.directDelays.push(20);  // the manual save's own network call: 20ms
  const pA = mod.push();      // autosave push starts, busy=true
  await new Promise((r) => setTimeout(r, 10));   // well inside the 60ms autosave window
  await mod.manualSave({ id: 'c1', name: 'Test', kind: 'chargen', stats: {} });
  // The reverted (bypass) leg's manual save resolves in 20ms — well before the still-running 60ms
  // autosave push does — so calls[0].end wouldn't be set yet without also waiting on the autosave
  // push's own promise here. Awaiting it is itself part of what proves the race, not just a cleanup step.
  await pA.catch(() => {});
  return { calls: mod.calls, directCalls: mod.directCalls };
}

for (const { file, prefix: p, label } of TOOLS) {
  console.log(`\n  ${label} — overlapping push, then a flush, then navigate\n`);
  const liveSrc = readFileSync(join(REPO, file), 'utf8');
  const liveBlock = extractBlock(liveSrc, p);
  const bodies = preFixBodies(p);
  const revertedBlock = replaceFunctionBody(
    replaceFunctionBody(liveBlock, `${p}CloudPush`, bodies.push),
    `${p}FlushCloudSaveNow`, bodies.flush,
  );

  const revertedFile = freshFile(`${p}-reverted`);
  writeFileSync(join(dir, revertedFile), wrapModule(revertedBlock, p));
  const reverted = await import(pathToFileURL(join(dir, revertedFile)).href);
  const beforeCalls = await runOverlapThenFlush(reverted);
  // Pre-fix: the flush resolves once call #1 (the stale push it raced against) settles, NOT once
  // call #2 (the real retry carrying the mid-flight edit) does. Assert the bug actually reproduces —
  // a gate that passes on broken code either way proves nothing.
  const bugReproduced = beforeCalls.length < 2 || beforeCalls[1].end == null;
  ok(`${label}: reverted copy resolves the flush BEFORE the retry completes (bug reproduces)`, bugReproduced);

  const liveFile = freshFile(`${p}-live`);
  writeFileSync(join(dir, liveFile), wrapModule(liveBlock, p));
  const live = await import(pathToFileURL(join(dir, liveFile)).href);
  const afterCalls = await runOverlapThenFlush(live);
  ok(`${label}: exactly 2 pushes happened (the original + the one retry the mid-flight edit needed)`,
     afterCalls.length === 2);
  ok(`${label}: the flush waits for the retry (call #2) to actually complete, not just call #1`,
     afterCalls.length === 2 && afterCalls[1].end != null);

  // pagehide/keepalive: fire it mid-flight (a fresh module instance — the one above is already spent),
  // then let a SECOND edit land mid-flight of the retry pagehide's own drain kicks off, forcing a
  // second retry. feat/keepalive-scope-narrowing (A2) means _cgPageHiding/_lsPageHiding stays true
  // across the whole drain, so BOTH retries independently open their own narrow keepalive span (proving
  // the original bug — a retry losing keepalive — stays fixed) as two SEPARATE, zero-delta spans, not
  // one wide span covering the whole chain (the pre-A2 shape). Call #1, already in flight before
  // pagehide fires, gets no span in either design — keepalive can't be retroactively added to an
  // already-dispatched request — so 2 spans (not 3) is itself part of what's asserted.
  const pagehideFile = freshFile(`${p}-pagehide`);
  writeFileSync(join(dir, pagehideFile), wrapModule(liveBlock, p));
  const forPagehide = await import(pathToFileURL(join(dir, pagehideFile)).href);
  forPagehide.delays.push(60, 30, 20);   // call 1: 60ms.  call 2 (retry): 30ms.  call 3 (2nd retry): 20ms.
  forPagehide.push();
  await new Promise((r) => setTimeout(r, 10));
  forPagehide.push();          // mid-flight edit -> marks retry #1, chains onto call 1
  forPagehide.firePagehide();  // sets _cgPageHiding/_lsPageHiding true; queue's already busy, so this
                                // particular push() call itself is a no-op beyond setting the flag
  await new Promise((r) => setTimeout(r, 65));   // call 1 finishes ~t60; call 2 (retry) is now running
  forPagehide.push();          // mid-flight edit during the retry -> marks retry #2, chains onto call 2
  await new Promise((r) => setTimeout(r, 80));   // let call 2 (~t90) and call 3 (~t110) fully resolve
  ok(`${label}: both retries the pagehide drain chains on get their own keepalive span (bug stays fixed)`,
     forPagehide.keepaliveSpans.length === 2);
  ok(`${label}: each span is narrow — opened/closed around just its own push, not the whole drain`,
     forPagehide.keepaliveSpans.every((s) => s.endCall - s.startCall === 0));

  // fix/manual-save-queue-bypass: an in-flight autosave push, then a manual save click. The reverted
  // leg splices in the literal pre-fix ${p}QueuedSaveCharacter body (a raw, uncoordinated
  // saveCharacter() call — what onSaveClick()/onJoinCampaignClick() used to do directly) to prove the
  // race actually reproduces before trusting the live code's fix for it.
  const bypassRevertedBlock = replaceFunctionBody(liveBlock, `${p}QueuedSaveCharacter`, bodies.queuedSave);
  const bypassRevertedFile = freshFile(`${p}-bypass-reverted`);
  writeFileSync(join(dir, bypassRevertedFile), wrapModule(bypassRevertedBlock, p));
  const bypassReverted = await import(pathToFileURL(join(dir, bypassRevertedFile)).href);
  const beforeBypass = await runAutosaveThenManualSave(bypassReverted);
  const raceReproduced = beforeBypass.directCalls[0] && beforeBypass.calls[0] &&
    beforeBypass.calls[0].end != null && beforeBypass.directCalls[0].start < beforeBypass.calls[0].end;
  ok(`${label}: reverted copy's manual save starts BEFORE the in-flight autosave push settles (race reproduces)`,
     raceReproduced);

  const bypassLiveFile = freshFile(`${p}-bypass-live`);
  writeFileSync(join(dir, bypassLiveFile), wrapModule(liveBlock, p));
  const bypassLive = await import(pathToFileURL(join(dir, bypassLiveFile)).href);
  const afterBypass = await runAutosaveThenManualSave(bypassLive);
  ok(`${label}: manual save waits for the in-flight autosave push to settle before its own network call`,
     afterBypass.directCalls[0] && afterBypass.calls[0] && afterBypass.calls[0].end != null &&
     afterBypass.directCalls[0].start >= afterBypass.calls[0].end);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n✓ ${pass} passed / ${fail} failed\n`);
process.exit(fail ? 1 : 0);
