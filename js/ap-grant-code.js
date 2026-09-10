// PACT — AP grant-code encode/decode. DM Console mints one ("dmMakeGrant"); Live Sheet both mints
// ("makeGrant") and redeems ("redeemGrant") one.
//
// A tamper-EVIDENT (not secret — same posture as js/engine.js's signPayload()/verifyPayload(), see
// D-GH48), obfuscated code a DM can hand a whole party at once: "here's N AP, from me," pasted into
// each player's own sheet rather than the DM opening every character individually. XOR-obfuscated with
// a fixed key and checksummed so a mis-typed or altered code is caught rather than silently
// misredeemed — NOT encrypted: anyone reading this file's source can decode any grant code. That is an
// accepted, deliberate limitation, not a gap to close here — the worst a player who reads this file
// gains is granting THEMSELVES an arbitrary amount of AP, which their own client already lets them
// fabricate a dozen easier ways (their local build is untrusted state by construction; `ap` is the only
// server-authoritative figure, and DM-RPC-authoritative at that — see AGENTS.md's Persistence section
// and the Security audit task in docs/TASK_BOARD_NEXT.md). This module is a copy/paste-typo guard for a
// legitimate DM's own generosity, not a security boundary.
//
// Previously two byte-for-byte copies (DM-Console.html, PACT-Live-Char-Sheet.html) with no shared
// module and no comment acknowledging the duplication, no test coverage of either copy, and DM Console
// only ever encoding what Live Sheet alone decoded — found 2026-09-10 full-system audit. Had the key or
// hash algorithm ever drifted between the two copies, DM-generated grant codes would have silently
// stopped redeeming for players (or the reverse), with nothing to catch it. Bridged into both tools'
// engine module bridge (D-GH26-style — local module, no CDN dependency) the same way MUT/DATA/compute
// already are.

const AP_GRANT_KEY = 'DragonReachForgePACT';

/** A small non-cryptographic checksum (djb2 xor variant) — just enough to catch a mis-typed or
 *  corrupted code, not to resist a deliberate forgery (see this file's header). */
export function apHash(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) h = (((h * 33) >>> 0) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** A short id stamped onto each grant so a sheet can refuse redeeming the same code twice
 *  (see redeemGrant()'s call site: LOG.some(e => e.grantId === o.id)). */
export function makeGrantId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Encode a grant payload object ({a: amount, n: note, d: date, id: grantId}) into a "PACTAP:…" code. */
export function apEncodeGrant(o) {
  const pl = JSON.stringify(o);
  const c = pl + '|' + apHash(pl);
  const u = encodeURIComponent(c);
  let x = '';
  for (let i = 0; i < u.length; i++) {
    x += String.fromCharCode(u.charCodeAt(i) ^ AP_GRANT_KEY.charCodeAt(i % AP_GRANT_KEY.length));
  }
  return 'PACTAP:' + btoa(x);
}

/** Decode a "PACTAP:…" code back to its payload object.
 *  @returns the payload object; `null` if the string isn't a grant code at all or fails to parse;
 *  `{bad:true}` if it IS shaped like one but the checksum doesn't match (altered/corrupted) — kept
 *  distinct from `null` so the caller can tell "not a grant code" from "a broken one" (see redeemGrant()). */
export function apDecodeGrant(code) {
  if (!code || code.indexOf('PACTAP:') !== 0) return null;
  try {
    const x = atob(code.slice(7));
    let u = '';
    for (let i = 0; i < x.length; i++) {
      u += String.fromCharCode(x.charCodeAt(i) ^ AP_GRANT_KEY.charCodeAt(i % AP_GRANT_KEY.length));
    }
    const c = decodeURIComponent(u);
    const p = c.lastIndexOf('|');
    if (p < 0) return null;
    const pl = c.slice(0, p), sig = c.slice(p + 1);
    if (apHash(pl) !== sig) return { bad: true };
    return JSON.parse(pl);
  } catch (e) { return null; }
}
