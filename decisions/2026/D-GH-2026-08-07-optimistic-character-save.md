# D-GH-2026-08-07-optimistic-character-save — guarding cloud saves against silent clobbering

**Status:** Accepted, shipped 2026-08-07 · **Branch:** `claude/get-ready-i52ojw` (task branch
`fix/optimistic-character-save`) · **Supersedes nothing; corrects its own task's premise.**

## Context

`pushCharacter()` wrote with a bare `.update({name, kind, stats}).eq('id', rec.id)` — no concurrency
guard. The entire event log lives in the `stats` blob, so the later writer replaced the earlier writer's
**whole history**. Two devices on one character destroyed each other silently.

The fix looked simple: `characters.updated_at` is already maintained by a `BEFORE UPDATE` trigger, so
guard on the last value the server confirmed. Getting there took four iterations, three of which were
only found because the fix was exercised against a live project. The iterations are the decision.

## The four things that were wrong, in order

**1. The client did not keep the server's value.** `saveCharacter()` stamps `updated_at` with the local
clock on every edit, so a guard written against it would never match and *every* save would look like a
conflict. Hence a separate `base_updated_at` — the server's word, carried across local edits, never
re-stamped locally.

**2. `0 rows updated` means two different things.** Either the row does not exist yet (insert) or it
exists and someone wrote first (conflict). Inserting in the second case collides on the primary key, so
an existence check decides between them.

**3. The base was read from the wrong place — and this is the subtle one.** `initSync()` runs
`syncAll()` on every page load and reconnect; `reconcile()`'s adopt branch refreshed `base_updated_at`
**in localStorage**. But the content a save sends comes from the open tool's **in-memory build**, which
`reconcile()` never touches and cannot update. So a background sync handed a stale page a *fresh* base;
the next save presented that base with old content, the guard matched, and the newer version was
overwritten. **Observed in production:** a character went 43 AP spent → 47 → back to 43 across two
separate browser profiles, with the guard active throughout.

Note the shape of this: an earlier round of the *same fix* had added `base_updated_at` to those adopt
sites, closing a visible bug (the first save after a fresh load ran unguarded) and opening an invisible
one. **A guard that looks like it works is worse than no guard**, because it is trusted.

*Decision:* the base travels with the **copy the page is holding** — an in-memory `_pageBase` map
written only by `loadCharacter()` (this page took this copy) and `applyServerMeta()` (this page's own
push succeeded), never by a background `reconcile()`. A page with no pin falls back to the stored value
and pins it from then on, so nothing regresses for callers that never load.

**4. There was no way out of a refused save.** After a refusal the local record is dirty and newer, so
`reconcile()` took its push branch, the guard refused it, `catch { /* retry later */ }` swallowed it, and
`loadCharacter()` returned the same stale local record. "☁ Cloud → Load" handed the user their own copy
forever — and the conflict message told them to use exactly that control.

*Decision:* "retry later" was the wrong frame. A refused push can **never** succeed, because the server
has moved and this copy's base never will. `reconcile()` now reports `{behind:true}`, and
`loadCharacter(id, {onBehind})` **asks** before discarding anything, adopting the server row only on an
explicit yes. Omitting the callback leaves behaviour unchanged — `syncAll()` and the campaign-rules
refresh call through the same function and must never be able to bin a user's work unasked.

## The premise that was wrong: "no automated gate can reach this"

The task and the original PR both asserted this could only be verified by hand, because the
dependency-free suite cannot sign in to Supabase. **That was false, and it cost real data.** Supabase is
not what needs testing — what matters is the *order of local reads and writes around a conditional
update*. `testing/scripts/sync-concurrency-ci.mjs` stubs the server, gives each simulated profile its own
`localStorage`, and replays the production sequence against the real `js/sync.js`, using Node built-ins
only. Defects 3 and 4 are both caught by it.

Two properties of that gate are deliberate:

- **It is differential.** It also runs the scenario against a reverted copy of `sync.js` and fails if the
  bug does *not* reproduce there. A regression test that passes on the broken version proves nothing. If
  it can no longer build the reverted copy it fails loudly rather than going quietly green.
- **Its timestamps are real ISO instants.** An earlier version used `'T1'`/`'T2'` placeholders;
  `Date.parse` turns those into `NaN`, so `isNewerInstant()` always returned false, `reconcile()` always
  adopted, and the recovery check passed for entirely the wrong reason. **A stub that is not faithful in
  the dimension under test agrees with you instead of checking you** — that is what let defect 4 through.

**The prescribed manual test was also wrong.** It said "open it in two tabs (Live Sheet in both is
easiest)". Two tabs in one browser profile *share localStorage*, which is not the case the guard is
about; the real case is two profiles or two devices. The manual pass is now scoped to what no gate can
judge — the wording of the conflict message and the button's state.

## Consequences

- After a refused save, that page keeps being refused until it loads the character again. Correct: its
  content is behind, and re-loading is the only honest way forward.
- `loadCharacter()` gained an options parameter. Existing call sites are unaffected by omission.
- Anything storing a per-character base must now ask "whose copy is this?", not "what does storage say?"

## Status

Accepted. Verified by `sync-concurrency-ci.mjs` (12/0), `engine-parity` (29/0), `tool-pricing` (67/0),
both tools booting with zero console errors, and a manual two-profile pass covering the dialogs.
