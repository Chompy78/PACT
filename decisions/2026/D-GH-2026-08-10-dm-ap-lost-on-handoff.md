# D-GH-2026-08-10-dm-ap-lost-on-handoff — a real, signed-in user's DM AP silently read as 0 after switching tools

Status: **Active**, 2026-08-10.

## Context

Found live, not in a test: a real Amble campaign character (Kaelen Dawnbreaker, owned by the reporting
user's own account) showed 53 DM AP correctly in both the Live Sheet and DM Console. Moving from the
Live Sheet to CharGen via the normal "⇆ Open in CharGen" handoff (the character's real owner switching
tools — not the DM-only `?viewChar=` copy route, a separate, unrelated, intentionally-disconnected
mechanism from `feat/chargen-dm-view`), CharGen showed **"🛡 0 AP — DM only"**.

## Root cause

`_cgAdoptEnvelopeBinding(d)` (`tools/PACT-CharGen-Webtool.html`) is the single function both boot paths
that need to re-resolve DM AP call: a Live Sheet → CharGen handoff (`_cgConsumeHandoff`) and a plain
page reload's autosave restore (`_cgRestoreAutosave`). It used to gate its DM-AP refresh call
(`refreshServerAp(d.id)`) on `window._cloudSignedIn`:

```js
if(S && window._cloudSignedIn && navigator.onLine && d.id){ /* fetch real AP */ }
```

`window._cloudSignedIn` is set by the `'campaign-ready'` event listener itself — and that listener
**synchronously resets it to `false` the instant it fires**, only flipping it back to `true` later, once
its own *separate* async session check (`updateAuth(session)`, fed by `onSessionChange`/an initial
`currentSession()` call elsewhere) resolves. `_cgAdoptEnvelopeBinding` already waits for `'campaign-ready'`
before proceeding (a prior fix, `fix/campaign-binding-survives-reload` — see the comment still in place
above this one) — but waiting for that event only guarantees the bridge *objects* exist, not that the
*auth check* has finished. On both boot paths, if the DM-AP refresh runs before that second, independent
resolution completes, `window._cloudSignedIn` is still stale-`false` even for a genuinely signed-in user
— the guard fails, `ap` stays `0`, and `refreshServerAp` is never called.

Critically, `_cgResolveDmApStatus(ap, campaignId)` — called right afterward — sets `window._dmApStatus`
to `'active'` based purely on whether the *campaign* fetch (`getCampaign(campaignId)`) succeeds, which
does **not** depend on `_cloudSignedIn` at all (the real Supabase auth token travels with the request
regardless of that app-level flag). So the two pieces of state end up inconsistent: `_dmApStatus` correctly
says `'active'`, while `window._dmAp` is silently stuck at `0` — which is exactly what produces the
`"🛡 0 AP — DM only"` label (`_apSourceHTML`'s `active && ignorePlayerAp` branch, spendable = `0 + dmAp`
with `dmAp` wrongly `0`).

## Decision

Ask the auth bridge directly instead of trusting the flag: `await window._authBridge.currentSession()`,
the same pattern `_cgConsumeViewChar()` already uses for the exact same reason. This has no dependency on
whether a second, independent listener has already run by this point — it just asks "is there a session
right now?" and gets an authoritative answer.

```js
var _session = A && await A.currentSession();
if(S && _session && navigator.onLine && d.id){ /* fetch real AP */ }
```

`window._authBridge` is set in the same module, at the same time, as `window._campaignBridge`/
`window._syncBridge` — all before `'campaign-ready'` fires — so it's safe to use right after the existing
wait, with no new synchronization needed.

## Why this shape, not an alternative

- **Not**: wait for `window._cloudSignedIn` to become `true` with a retry/poll loop. Would work, but adds
  a second asynchronous wait with its own timeout-tuning question, for state a direct call already answers
  immediately and authoritatively.
- **Not**: gate `_cgResolveDmApStatus`'s `_dmApStatus` resolution on the same flag instead, so both pieces
  of state fail together instead of disagreeing. Rejected — it would turn a genuinely-signed-in user's DM
  AP into a permanent `'unavailable'` on the same race, trading a wrong-but-active `0` for a stuck warning
  banner; the real fix is to make the *read* itself reliable, not to make the two failure paths agree.

## Verification

`testing/scripts/tool-pricing-ci.mjs`: new check reproduces the exact race directly — bridges already
present (so the `'campaign-ready'` wait is a no-op, matching the real timing), `window._cloudSignedIn`
forced stale-`false`, `currentSession()` mocked to return a real session. **Confirmed this test fails
without the fix** (`["active", 0]`, reproducing the live bug exactly) and passes with it (`["active", 53]`)
— verified by hand-reverting just the fix (keeping the new test) and re-running before committing, not
assumed. 126/0 overall (was 125/0). `engine-parity-ci.mjs` unaffected, 30/0 — display/timing only, no
`compute()`/`DATA.version` change.

**Not independently re-verified against the real Kaelen record in this session** (the live report is what
surfaced the bug, not a re-test after the fix) — the reporting user can confirm by reloading the same
Live Sheet → CharGen handoff.

## Related

- `fix/campaign-binding-survives-reload` (comment still in place above this fix) — the prior, related race
  this shares a call site with (waiting for the bridge to exist at all), fixed separately from this one
  (waiting for the auth check specifically).
- `feat/chargen-dm-view` (`D-GH-2026-08-10-chargen-dm-view`) — the *other*, unrelated `?viewChar=` copy
  route that was initially (mis)diagnosed as the cause before the actual reproduction steps (character
  owner using the normal Live Sheet ⇆ CharGen switch) were confirmed against the user's real click path.
