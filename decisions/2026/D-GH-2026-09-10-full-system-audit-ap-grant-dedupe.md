# D-GH-2026-09-10-full-system-audit-ap-grant-dedupe — AP grant-code logic moves into a shared module

**Status:** Adopted, implemented on `claude/fervent-clarke-6yv9o9` (a full-system audit session — see
`docs/sessions/2026-09-10-full-system-audit.md`).

## Context

The AP grant-code feature (a DM mints one "PACTAP:…" code and pastes it once for a whole party; each
player redeems it into their own sheet) was implemented as two byte-for-byte identical copies of
`_AK`/`_apHash`/`_apEnc`/`_grantId` in `tools/DM-Console.html` and `tools/PACT-Live-Char-Sheet.html`
(Live Sheet also carried `_apDec`, since DM Console only ever encodes). Found during a background
dead-code/hygiene review: no shared module, no comment acknowledging the duplication (unlike the
`foldBuild`/`activeEvents`/`economy` tool-local adapters elsewhere in these same files, which are
explicitly commented as intentional per-tool parity copies, D-GH37), and — confirmed by grepping
`testing/` — **zero test coverage** of either copy. Had the shared key or hash algorithm ever drifted
between the two files (a fix or tweak landing in only one), DM-generated grant codes would have silently
stopped redeeming for players, or the reverse, with no gate to catch it either way.

## Options

- **A1 — Extract into a shared `js/` module, bridged into both tools the same way `DATA`/`compute`/
  `MUT` already are.** Matches this project's established pattern for logic that must not drift between
  tools (AGENTS.md's Architecture section).
- **A2 — Leave the duplication, but add a comment on both copies plus a differential test** that fails
  if the two ever diverge. Cheaper, but the drift risk (someone edits one copy without checking the
  other) remains structurally possible; the comment only helps someone who reads it first.
- **A3 — Do nothing.** The duplication is a maintenance risk, not a currently-live bug (both copies were
  identical at the time of the audit) — defensible to leave for a dedicated task.

## Decision

**A1.** New `js/ap-grant-code.js`, exporting `apHash`, `makeGrantId`, `apEncodeGrant`, `apDecodeGrant` —
pure functions, no DOM, no tool-specific state. Bridged into both tools' existing "ENGINE BRIDGE — local
modules ONLY" `<script type="module">` block (the same CDN-independent bridge `js/character-store.js`
already uses in Live Sheet, and `js/engine.js`/`MUT`/etc. use in both) — not the cloud bridge, since this
has no Supabase/CDN dependency and must keep working fully offline. DM Console's `dmMakeGrant()` and Live
Sheet's `makeGrant()`/`redeemGrant()` are now thin wrappers calling `window.apEncodeGrant`/
`window.apDecodeGrant`/`window.makeGrantId`, unchanged in every other respect (same prompts, same
clipboard behaviour, same redemption dedup via `grantId`).

## Why

**A1 over A2/A3.** The actual risk here — silent, hard-to-notice divergence between two copies of a
security-adjacent-looking but not-actually-secret algorithm — is exactly the class of drift this
project's own Architecture section exists to prevent for `MUT`/`DATA`/`compute()`, and the mechanism
(a shared module, bridged via the existing engine-ready pattern) already exists and is proven; there was
no reason to invent a lighter-weight alternative (A2) when the real fix costs about the same effort and
removes the risk by construction rather than by vigilance. A3 was rejected because the audit's whole
premise was that vigilance-dependent risks are exactly the ones worth closing when found, not re-filing.

**Not a security fix — said plainly, so it isn't mistaken for one.** This module's own header states the
obfuscation is tamper-EVIDENT, not secret (same posture as `js/engine.js`'s `signPayload()`/
`verifyPayload()`, D-GH48): anyone reading the source can decode any grant code. That was already true
before this change and remains true after it — the fix is DRY/maintainability (one implementation, one
place a bug can be fixed, one thing to test), not a widened security boundary. The real boundary for AP
remains server-side and DM-RPC-authoritative, per AGENTS.md's Persistence section and the still-open
security-audit task in `docs/TASK_BOARD_NEXT.md`.

## Verified

New `testing/scripts/ap-grant-code-ci.mjs` (13 assertions, previously zero coverage existed): round-trip
encode/decode, checksum tampering detected as `{bad:true}` distinct from "not a grant code" (`null`),
malformed input never throws, and — the one that matters most for this refactor — **a grant code minted
by the exact pre-refactor duplicated algorithm still decodes correctly, and re-encoding the same payload
reproduces that pre-refactor code byte-for-byte**, pinning that the extraction changed nothing observable
and any code a DM already pasted into a chat stays redeemable. `dm-console-ui-e2e.mjs` and
`economy-ui-e2e.mjs` (which load both tools in a real browser) stayed green throughout, confirming the
module bridge itself didn't break tool boot.
