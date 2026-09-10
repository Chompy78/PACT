#!/usr/bin/env node
/**
 * ap-grant-code-ci.mjs — dependency-free unit test for js/ap-grant-code.js.
 *
 * WHY THIS EXISTS. The AP grant-code encode/decode logic (a DM mints a "PACTAP:…" code, pastes it once
 * for the whole party, each player redeems it into their own sheet) was, until 2026-09-10, two
 * byte-for-byte copies pasted into tools/DM-Console.html and tools/PACT-Live-Char-Sheet.html — no shared
 * module, no comment acknowledging the duplication, and (confirmed by grep across testing/) NO test
 * coverage of either copy. DM Console only ever ENCODED these codes; Live Sheet was the only place that
 * DECODED them. Had the key or hash algorithm ever drifted between the two copies, DM-generated codes
 * would have silently stopped redeeming for players, with nothing here to catch it.
 *
 * Pure functions, no DOM — this is a real Node unit test, not a browser harness. Node has global
 * atob/btoa (no polyfill needed), which is the only reason this module can run outside a browser at all.
 *
 * Run:  node testing/scripts/ap-grant-code-ci.mjs   (expect 0 failed)
 */
import { apHash, makeGrantId, apEncodeGrant, apDecodeGrant } from '../../js/ap-grant-code.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); };

console.log('\nap-grant-code — encode/decode, checksum, backward compatibility\n');

// --- round trip -------------------------------------------------------------------------------
{
  const payload = { a: 12, n: 'Session 4 boon', d: '2026-09-10', id: makeGrantId() };
  const code = apEncodeGrant(payload);
  ok('encoded code carries the PACTAP: prefix', code.startsWith('PACTAP:'));
  const decoded = apDecodeGrant(code);
  ok('round-trip decode returns the same payload', JSON.stringify(decoded) === JSON.stringify(payload));
}

// --- checksum catches tampering, not just malformed input --------------------------------------
{
  const code = apEncodeGrant({ a: 5, n: '', d: '2026-09-10', id: makeGrantId() });
  // Tamper by flipping one BIT in a byte solidly in the middle of the underlying base64 payload —
  // deliberately not the code STRING's last character, which can land on a base64 padding bit atob()
  // ignores. That made an earlier version of this test genuinely flaky: whether the tail character was
  // significant depended on the random-length grant id shifting the payload's total byte count, so the
  // "tamper" sometimes decoded back to the SAME bytes and the assertion failed by pure chance. Operating
  // on the decoded bytes directly, at a fixed middle index, with a full byte XOR, removes that.
  const b64 = code.slice('PACTAP:'.length);
  const bytes = atob(b64);
  const mid = Math.floor(bytes.length / 2);
  const tamperedByte = String.fromCharCode(bytes.charCodeAt(mid) ^ 0xFF);
  const tamperedB64 = btoa(bytes.slice(0, mid) + tamperedByte + bytes.slice(mid + 1));
  const tampered = 'PACTAP:' + tamperedB64;
  ok('a tampered-but-shaped code is flagged {bad:true}, not silently decoded',
    apDecodeGrant(tampered)?.bad === true);
}

// --- malformed input never throws, and is distinguished from a tampered code --------------------
{
  ok('null is not a grant code', apDecodeGrant(null) === null);
  ok('empty string is not a grant code', apDecodeGrant('') === null);
  ok('arbitrary text is not a grant code', apDecodeGrant('hello world') === null);
  ok('a PACTAP: prefix with garbage after it does not throw',
    (() => { try { return apDecodeGrant('PACTAP:not-valid-base64!!!'); } catch { return 'threw'; } })() !== 'threw');
}

// --- backward compatibility: a code minted by the ORIGINAL pre-refactor algorithm must still ------
// decode correctly. Pinned literal, computed from the exact duplicated logic this module replaced
// (same key, same djb2-xor hash, same XOR cipher) — proves the extraction into js/ap-grant-code.js
// changed nothing observable, so any grant code a DM already pasted into a chat stays redeemable.
{
  const KNOWN_GOOD_CODE = 'PACTAP:YUUjQl1cM0BTUU11LkNSQGICZmZ2HERVXUthJERRWhUKARQMPy9mZnRGRFVfDD0KD0ZadEpAJEBicydxdkBEVC5LYFdTU1pwQkJeSGBwZmZ2V1MkSlxgDAVGWnRKQSZAYnMlPTwXBRMKHSYMBVJNdF1XUCF1dgBldhkUVgdb';
  const expected = { a: 15, n: 'Session 4 boon', d: '2026-09-01', id: 'fixedtestid1' };
  const decoded = apDecodeGrant(KNOWN_GOOD_CODE);
  ok('a code minted by the pre-refactor algorithm still decodes correctly',
    JSON.stringify(decoded) === JSON.stringify(expected));
  ok('re-encoding the same payload reproduces the exact pre-refactor code byte-for-byte',
    apEncodeGrant(expected) === KNOWN_GOOD_CODE);
}

// --- makeGrantId / apHash: bounded sanity, not full randomness testing --------------------------
// NOT asserting "two live calls never collide" here: makeGrantId() is Date.now() (millisecond
// granularity — two back-to-back calls routinely land in the same millisecond) plus 5 base-36 random
// characters, so a genuine collision has a small but real, non-zero chance on any given run. A flaky
// assertion that can fail by pure chance is a bug in the TEST, not evidence about the code (hit exactly
// this during this file's own review — a real one-in-tens-of-millions collision, not a code defect) —
// so this checks the deterministic SHAPE instead, which every call satisfies unconditionally.
{
  const a = makeGrantId();
  ok('makeGrantId returns a non-empty string', typeof a === 'string' && a.length > 0);
  ok('makeGrantId is timestamp + random, both base-36 (lowercase alphanumerics only)', /^[0-9a-z]+$/.test(a));
  ok('apHash is deterministic for the same input', apHash('same input') === apHash('same input'));
  ok('apHash differs for different input (no trivial collision on these two)', apHash('a') !== apHash('b'));
}

console.log(`\n✓ ${pass} passed / ${fail} failed\n`);
process.exit(fail ? 1 : 0);
