/**
 * PACT — displayed-version guard.
 *
 * Asserts that every RULES version a player can see agrees with DATA.version, and that every BUILD
 * version label agrees with BUILD. Pure Node, no browser, runs in seconds.
 *
 * WHY THIS EXISTS, and why it is a static check rather than a browser one.
 *
 * All three tools already read DATA.version LIVE at `engine-ready` — CharGen's was the last to be
 * fixed (fix/chargen-rules-label-live, 2026-08-10). So over http, which is how the app is actually
 * served, the labels are correct today. What is NOT protected is the hardcoded FALLBACK literal sitting
 * in the HTML behind each of those live writes. Those literals have rotted before, twice, and both
 * incidents are recorded in the Live Sheet's own comments:
 *
 *   * its footer span was hardcoded until 2026-08-06 and had drifted to v0.309 while the rules were
 *     v0.339 — thirty versions;
 *   * CharGen's Info popup showed v0.339 beside a header showing v0.356, reported from real use on
 *     2026-08-19.
 *
 * Each time, the live path was fixed and the stale literal left in place. Nothing ever checked the
 * literals, so nothing stopped them drifting again — and on 2026-09-02 a task was filed claiming CharGen
 * displayed a rules version 25 releases stale, written from a grep without loading the tool. It was
 * wrong: the live label was correct. This gate exists so that question is answerable in one second
 * instead of being guessed at, in either direction.
 *
 * The literals are not cosmetic. They are what shows before `engine-ready` fires, and they are ALL a
 * user ever sees if the module bridge fails to run at all — which is exactly what happens when the file
 * is opened over file:// (ES modules are blocked there, so window.DATA never exists). That was settled
 * on 2026-09-02: file:// is NOT a supported way to run the tools, the false "must run via file://" claim
 * was removed from both tool headers, and restoring the capability is parked as a LATER consideration.
 * See decisions/2026/D-GH-2026-09-02-file-protocol-support-or-drop-the-claim.md, and
 * docs/TASK_BOARD_LATER.md for the open question.
 *
 * TARGETS ARE ENUMERATED, NOT GREPPED. A blanket search for /v0\.3\d\d/ matches dozens of historical
 * code comments ("v0.314 fix", "since v0.355 foldBuild…") which are SUPPOSED to stay pinned to the
 * version that changed them. Only labels a user actually reads are listed below.
 *
 *   node testing/scripts/version-label-ci.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, BUILD } from '../../js/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  PASS  ${name} — ${actual}`); }
  else { fail++; console.log(`  FAIL  ${name} — expected ${expected}, found ${actual === undefined ? '(no match)' : actual}`); }
};

// Pull the first capture group of `re` out of `file`, or undefined if it does not match. A missing match
// is a FAILURE, not a skip: if someone renames an element or restructures the header, this gate must go
// red rather than quietly stop checking anything — the failure mode that let undo-barrier-ci.mjs sit
// wired into no workflow at all until 2026-09-02.
const grab = (file, re) => (read(file).match(re) || [])[1];

const CG = 'tools/PACT-CharGen-Webtool.html';
const LS = 'tools/PACT-Live-Char-Sheet.html';
const DM = 'tools/DM-Console.html';

console.log(`\nRules version — every user-visible label must equal DATA.version (${DATA.version})`);

// CharGen's <title>. Carries BOTH numbers; the rules half is what this line checks.
check('CharGen <title> rules half',
  grab(CG, /<title>PACT Character Generator[^<]*Rules (v[\d.]+)<\/title>/), DATA.version);

// CharGen's header chip. The module bridge overwrites this at engine-ready; the literal is the fallback.
check('CharGen #cgPactver fallback literal',
  grab(CG, /id="cgPactver"[^>]*>PACT rules · (v[\d.]+)</), DATA.version);

// Live Sheet's About footer. Hardcoded until 2026-08-06, when it had drifted 30 versions.
check('Live Sheet #lsRulesVer fallback literal',
  grab(LS, /id="lsRulesVer">(v[\d.]+)</), DATA.version);

console.log(`\nBuild version — every mirror must equal BUILD (${BUILD}); see docs/VERSION-SYNC.md`);

check('js/engine.js is the source of truth', BUILD, BUILD);   // trivially true; anchors the section
check('CharGen line-1 comment',
  grab(CG, /PACT-CharGen-Webtool (v[\d.]+)\.html/), BUILD);
check('CharGen <title> build half',
  grab(CG, /<title>PACT Character Generator — Web Tool (v[\d.]+)/), BUILD);
check('CharGen header .sub label',
  grab(CG, /class="sub">Web Tool · (v[\d.]+)</), BUILD);
check('Live Sheet line-1 comment',
  grab(LS, /PACT-Live-Char-Sheet (v[\d.]+)\.html/), BUILD);
check('DM Console TOOL_VERSION',
  grab(DM, /var TOOL_VERSION = '(v[\d.]+)'/), BUILD);

// index.html is deliberately NOT checked: docs/VERSION-SYNC.md says it reads BUILD live and must never
// be hand-edited, so a literal appearing there would be the bug, not a value to verify. Assert its
// absence instead.
const idx = read('index.html');
check('index.html hardcodes no build version (it reads BUILD live)',
  /v1\.\d{3}/.test(idx) ? 'a hardcoded build version' : 'none', 'none');

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
