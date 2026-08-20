# D-GH-2026-08-10-campaign-ap-log-integrity

## Context

`feat/campaign-ap-budget-enforce` (2026-08-09) shipped a **client-side** gate: CharGen and Live Sheet
refuse to push a campaign-bound cloud save once `compute().remaining < 0`. Real, but bypassable — a raw
PostgREST `PATCH` on `characters.stats` skips the UI entirely, and `characters.stats` (the whole LOG,
including every purchase's frozen cost) is client-writable by the character's owner. The only genuinely
server-authoritative number is `characters.ap` (DM-granted, via `award_ap()`).

The user asked other AIs for ideas via a written problem statement (`z-cold/` on the `zcold` branch —
see `pact-ap-overspend-problem.txt` and the seven review files it produced: DeepSeek, Kimi, and four
others — exact filenames, all in `z-cold/old/` on the `zcold` branch, added 2026-08-20: `PACT-AP-Budget-
Enforcement-Review.txt`, `PACT-AP-overspend-hardening-summary.txt`, `PACT_AP_Enforcement_Review.md`,
`PACT_AP_overspend_hardening_AI_threat_model.txt`, `pact DeepSeek ap.txt`,
`pact-ap-integrity-ai-guidance.txt`, `pact-ap-overspend-analysis.txt`). All seven converged on rejecting a full SQL reimplementation of `compute()`'s pricing (drift
risk, violates the engine.js-only rule) and on a narrow frozen-cost-sum consistency trigger as a viable,
compliant backstop. One review (`PACT_AP_overspend_hardening_AI_threat_model.txt`) proposed a materially
different, stronger idea: instead of trying to verify costs are *correct* (impossible server-side without
re-deriving pricing), make it structurally impossible to *rewrite already-committed history* — protect
provenance, not correctness.

Synthesized into three options (N1/N2/N3) and presented to the user: N1 (frozen-cost-sum trigger), N2
(append-only locked history), N3 (Supabase Edge Function running the real `engine.js`, deferred to the
task board — `feat/ap-edge-function-validation` — since `compute()`/`economy()` only sum frozen costs
rather than re-deriving them, so it would not give a stronger correctness guarantee than N1 for
locked/in-play characters; its value is DRY/maintainability, not a bigger boundary).

## Options considered for N2's exact boundary

N2 as first scoped ("nothing in the LOG can ever change once locked") turned out to conflict with two
real, already-shipped features, confirmed by reading the code directly rather than assumed:

- **Live Sheet's `undo()`** (`PACT-Live-Char-Sheet.html`) does `LOG.pop()` — removes the trailing event.
  Always available, not gated on "hasn't synced yet."
- **CharGen's `replacePatchSlot()`** (identity/stats/hdProf/economy slot edits) deletes the old event for
  a slot from wherever it sits and appends a fresh one at the end — reorders the log.
- **Live Sheet's `_shCommitAppearanceField`** mutates an existing `cat:'patch'` event **at the same
  array index** in place (position-stable, unlike CharGen's delete+reappend).

A strict "nothing changes" rule would reject all three. The user pointed out the fix directly: `undo()`
(`PACT-Live-Char-Sheet.html:653`) already refuses to pop a `type:'award'` event unless `disc` is truthy —
`"AP awards lock your history — buys made before an award can't be undone."` That is the exact boundary
this needed, already designed and shipped, just enforced client-side only.

## Decision

Ship two BEFORE UPDATE triggers on `characters` (`sql/migrations/2026-08-10-campaign-ap-log-integrity.sql`),
scoped to campaign-bound characters (`campaign_id is not null`) only:

1. **`pact_enforce_ap_budget_consistency` (N1).** Sums frozen `buy`/`buyoff`/`names` costs and
   `award`/drawback earnings straight off the LOG (never re-derives a price — pure ledger arithmetic, no
   `DATA` reference, so it doesn't duplicate `js/engine.js`'s pricing tables). Rejects a write only if
   that sum both **increases** and **exceeds spendable AP** — a non-regression guard that grandfathers an
   already-over-budget character exactly like the client feature's own stated behaviour. Gated on
   `campaigns.rules->>'enforceApBudget'` (default true, matching the client feature's default).

2. **`pact_enforce_locked_history` (O3 in conversation, "N2" in the original three-way split).** Once a
   character's LOG contains a non-discretionary, non-seed `award` event, everything at-or-before that
   event's index becomes append-only — the exact boundary `undo()` already enforces, made
   server-authoritative. No new `locked_at` column needed: the boundary is derived from the LOG itself on
   every check. `cat:'patch'` events are excluded from the protected set entirely (verified against both
   tools' actual mutation code before writing this, not assumed) — they carry no history-forgery risk on
   their own, and (after the review-fixes below) their cost is also excluded from trigger 1's sum, so
   their exclusion here doesn't leave a gap.

## Why this is NOT the same check as the shipped client gate

Checked directly in `js/engine.js`: `compute()`'s `.total`/`.remaining` **repriced the whole build fresh
under current rules** (a function of `DATA` and whatever's currently on the build) — it is not the frozen
ledger sum. `economy()`'s `.spent` IS the frozen sum. These are documented to diverge (see the task
board's `feat/ap-model-reconcile` entry — Fenwick Copperkettle: frozen spend 47 vs `compute()`'s repriced
40). A SQL trigger can only ever check the frozen-sum side of that divergence without reimplementing
`compute()`'s pricing tables in SQL, which the engine.js-only rule forbids. So `pact_enforce_ap_budget_
consistency` checks a genuinely different, complementary invariant ("did this character historically
spend AP it never had") from the client gate's ("would this reprice over budget today") — not a
server-side mirror of it.

## Verification (round 1)

Applied to the live project (`piuprrrnaotrtxucrtsb`) via `apply_migration`. `get_advisors` (security) came
back clean except: the pre-existing `character_backups` RLS-no-policy finding (predates this change), and
"SECURITY DEFINER executable by authenticated" on both new trigger functions — the same accepted class of
warning every other RPC in this project already carries (`award_ap`, `join_campaign`, ...; "hygiene, not a
fix for a live hole" per the existing comment in `rls-policies.sql`). One genuine finding — `pact_ap_
ledger_protected` missing `set search_path` — was fixed immediately (though only in `rls-policies.sql` at
this point — see finding 3 below).

Both helper functions unit-tested directly against synthetic JSONB (spend/earn arithmetic, patch-event
filtering, patch-reorder not breaking the protected-prefix comparison). The full trigger pair was then
exercised end-to-end against a fully disposable `auth.users`/`profiles`/`campaigns`/`characters` row
(never touching Amble or any real user's data), covering: an over-budget increase (rejected, correct
error message), a within-budget edit (allowed), adding a non-discretionary award, `undo()`-style pop of
the trailing post-award event (allowed), a rewrite of a pre-award event (rejected), and a `cat:'patch'`
appearance edit added then mutated in place across the award boundary (allowed both times). All disposable
rows were deleted afterward and confirmed gone via a follow-up count query.

## Review findings (`/code-review ultra` on PR #401) — all fixed before merge

The per-change checklist's own template calls for `/code-review ultra` on any PR touching `sql/`. Run
against the PR #401 diff at max effort, it surfaced two real, concretely-traced bypasses; fixing the first
one surfaced a third bug during re-verification. All three are fixed in the code as it stands now (not
left as follow-ups) and re-verified live.

1. **`disc`-flip bypass (found by review).** `pact_ap_ledger_protected`'s comparison snapshot omitted
   `disc`. A write that only flipped a locking award's `disc` from absent/false to `true` passed both
   triggers unnoticed (no cost/type/cat change), and then permanently disabled `pact_enforce_locked_
   history` on the *next* write — the boundary-finding query would no longer see that award as
   non-discretionary, so `v_award_idx` would come back null and all protection would silently switch off
   from then on. **Fix:** `disc` is now part of the snapshot, so changing it on a protected event trips
   the same "protected event changed" rejection as any other field.
2. **`cat:'patch'` negative-cost bypass (found by review).** `cat:'patch'` events were (correctly)
   excluded from trigger 2's protected/positional set, but their `cost` still counted in trigger 1's
   spend sum. A rewritten or newly-appended patch event with a large negative cost could offset a
   genuine spend increase elsewhere in the same write, passing the non-regression check on a net figure
   that no longer reflected real spend. **Fix:** `cat:'patch'` costs are now excluded from *both*
   triggers' notion of spend — patch-driven cost changes are covered only by the client-side gate (which
   reprices the whole build via `compute()` and sees patch effects directly), not by this SQL backstop.
   This narrows what trigger 1 covers and is now stated as an explicit scope boundary, not a silently
   dropped case — verified via an adversarial test (real +50 purchase offset by a fabricated -50 patch
   event) that the real overspend is still caught.
3. **Migration file left inconsistent with the live fix (found while re-verifying finding 1).** The
   `set search_path` fix for `pact_ap_ledger_protected` was applied live and to `rls-policies.sql`, but
   the idempotent migration file itself was never updated — so re-running it against a different existing
   install would silently reintroduce the advisor finding. **Fix:** the migration file was rewritten in
   place to match, rather than layered with a second patch file, since the original hadn't been merged yet.
4. **Own finding, surfaced while fixing #1 (not from the review).** Re-checking `disc`'s exact semantics
   led to checking CharGen's own `award`-emitting code, which surfaced a real, separate bug: CharGen's
   creation-budget seed (`_cgSyncSingletonEvent`, `tools/PACT-CharGen-Webtool.html:2539`) sets
   `noLock:true` and never `disc`, and is re-synced via **delete-then-append-at-the-end**, not a stable
   in-place mutation, every time the budget value changes. Without an exclusion, this event would be
   treated as trigger 2's boundary and would churn to the end of the log on every resync — dragging the
   "locked" point forward and freezing ordinary in-progress drafting for any campaign-bound CharGen
   character, essentially from the moment budget was first set. **Fix:** the boundary-finding query now
   also excludes `noLock:true` awards. Confirmed Live Sheet's own award-entry function
   (`award(amount,note,disc)`, `tools/PACT-Live-Char-Sheet.html:601`) and its "Level 1 starting AP" seed
   event never set `noLock`, so genuine play-time award protection is unaffected; `undo()` already treats
   that Live Sheet seed event as its own boundary via the same `disc` check, so trigger 2 stays
   behaviourally consistent with the shipped client there. **Caveat, not fully closed:** if CharGen ever
   gains a path that appends a real (non-`noLock`) `award` event mid-draft, that would need re-review
   before this boundary assumption still holds for CharGen specifically — not verified exhaustively across
   every CharGen code path, only the ones that currently emit `award` events.
5. **Dead code (found by review, cosmetic).** `pact_enforce_ap_budget_consistency` computed
   `v_old_earned` from the OLD log and never read it. Removed; only `v_old_spent` is needed.

## Verification (round 2, after the fixes above)

Corrected functions re-applied live via `apply_migration`; `get_advisors` re-run and came back clean of
the `search_path` finding too (only the same pre-existing/accepted findings remain). New adversarial
tests, each against a fresh disposable row (cleaned up and confirmed gone afterward, same as round 1):
the `disc`-flip attack (now rejected, "protected event changed"), the patch negative-cost offset attack
(now rejected on the real +50 spend, ignoring the fabricated -50 patch), and the CharGen `noLock`-churn
scenario — buy a trait, resync the budget singleton (moves it to the end), then fully rewrite the earlier
trait purchase (now allowed, confirming the churn no longer falsely locks in-progress drafting).

## Known limitations (accepted, not oversights)

- `pact_enforce_ap_budget_consistency`'s `earned` figure counts every drawback-buy's refund regardless of
  whether it was later bought off — exact tracking needs the same FIFO-queue matching `js/engine.js`'s
  `activeEvents()` does for `boughtOff`, more machinery than this backstop needs. This makes `earned`
  occasionally slightly generous, never stingy: it can under-enforce, never wrongly block a legitimate save.
- Neither trigger closes the "self-consistent understated individual costs" gap every reviewer flagged as
  inherent to any sum-only check — a client can still submit a LOG where every cost is understated but
  mutually consistent. True correctness would require server-side execution of `engine.js` itself (N3,
  deferred).
- `cat:'patch'` event costs (identity/stats/economy slot edits, some of which can carry real AP deltas)
  count toward neither trigger after the review fixes above — only the client-side gate (via `compute()`,
  which reprices the whole build and sees patch effects directly) covers patch-driven cost changes. A
  direct-API write that only manipulates patch-slot costs is not caught server-side. Deliberate: the
  alternative (counting patch costs in trigger 1 while exempting patch events from trigger 2's positional
  protection, as the first version of this migration did) is exactly what finding 2 above exploited.
- A player can still legitimately self-award AP via a plain LOG `award` event (not DM-granted) unless the
  campaign sets `ignore_player_ap` — this is a pre-existing trust assumption in the app's own design
  (`characters.ap` + player-logged awards are both counted toward `spendable` by design), not something
  N1/O3 were scoped to close.
- No client-side error-message polish was added for a trigger rejection surfacing through `js/sync.js`'s
  existing generic error handling (`saveCharacter()` already catches and marks the character unsynced
  rather than crashing) — acceptable since this path should be rare (the client-side gate already blocks
  the common case before ever attempting the save); flagged as a possible follow-up if it proves noisy.

## Status

Shipped. Applied directly to the live Supabase project; `sql/rls-policies.sql` updated to match for fresh
installs (no new column/table, so `sql/schema.sql` is unaffected — functions and triggers only, placed
alongside `award_ap()`/`dm_unbind_character()`); `sql/migrations/2026-08-10-campaign-ap-log-integrity.sql`
is the idempotent patch for any other existing install.
