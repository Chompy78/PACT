# D-GH-2026-09-01-session-seal — the session seal AMENDS the existing lock, it does not add a second one

**Status:** Phase 1 **APPLIED TO PRODUCTION 2026-09-01** (Supabase `piuprrrnaotrtxucrtsb`, migration
`session_seal_amend_locked_history`) · branch `claude/everything-on-main-kx82ur` · Phase 2 (tool UI)
in progress.

Post-apply verification: 35 characters / 461 log events / 49 awards all unchanged; both new functions
present; the protected projection covers `sessionSeal`; **still 4 triggers on `characters`, none
added**, and no stray trigger from the withdrawn design; 0 seals exist, so the amendment is inert
until one is placed. Supabase advisor: no ERROR-level findings. The two new functions appear under the
pre-existing `authenticated_security_definer_function_executable` warning class that ~35 existing
functions in this schema already trigger by design — no new class of finding. Noted for a future task,
not fixed here: `pact_enforce_locked_history` and `pact_enforce_ap_budget_consistency` are trigger
functions that are nonetheless RPC-executable (harmless — calling one outside a trigger errors at
once — and pre-existing, but worth revoking). **Done 2026-09-01** (migration
`revoke_execute_on_trigger_functions`): EXECUTE revoked from `authenticated` and PUBLIC on both.
Revoking EXECUTE does not stop a trigger firing — a trigger runs as part of the statement, not as a
client call — verified on a throwaway Postgres 16 before applying, and the callable RPCs
(`award_ap`, `seal_character_history`, `award_ap_and_seal`) still have EXECUTE.
Plan + three cold reviews: `docs/plans/2026-09-01-session-seal-cold-review.md`.
Builds on `D-GH-2026-09-01-undo-barrier-shared` (step 1).
Amends `D-GH-2026-08-10-campaign-ap-log-integrity`.

## Context

The owner wanted a per-session lock: *"each session, there is an undo lock put in place… it must apply
to both sheets so anything already bought can't be unselected."*

### The correction this record exists to make

**The first draft of this work was built on a false premise, and the premise survived three cold
reviews because none of the reviewers had repo access.** That draft — and the plan, changelog and
migration comments written alongside it — asserted that no server-side protection of character history
existed, and that the browser was therefore the integrity boundary.

That was wrong. `pact_enforce_locked_history()` has existed since 2026-08-10
(`sql/migrations/2026-08-10-campaign-ap-log-integrity.sql`, also in `sql/rls-policies.sql`). For a
campaign-bound character it already freezes everything at or before the last non-discretionary,
non-`noLock` `award` event, comparing a projection of the protected events and rejecting any write
that shortens or rewrites them.

It was found by a read-only pre-flight against the live schema immediately before applying the
migration — listing existing triggers on `characters` — which is the one check that would have caught
it at any point. The research gap was mine: greps targeted `award_ap` and `dm_edit_character_log`, and
never asked "what triggers already exist on this table".

**Two consequences beyond the embarrassment.** First, the original design would have added a *second*
prefix-protection trigger beside the first — precisely the hand-written-mirror drift `AGENTS.md` names
as this project's recurring failure. Second, and worse, that second trigger compared **raw JSONB
events** where the existing one deliberately compares a **six-field projection**; the original earned
that projection through three review-found bugs (see its revision note). A raw comparison rejects a
save merely because an event gained a cosmetic field. It would have shipped to production and started
refusing legitimate saves.

### What was still genuinely missing

The existing lock does not cover what the owner asked for:

1. **The DM Console's "Award AP" writes only `characters.ap`** plus a ledger row — never a LOG event.
   So the actual award button locks nothing at all, then or now.
2. **The award boundary skips solo characters** (`if NEW.campaign_id is null then return NEW`), which
   owner decision I2 requires.
3. **The boundary moves and is implicit.** It is wherever the last qualifying award happens to sit; a
   seal is placed deliberately, at a moment the DM chooses, and stays there.

### Measured 2026-09-01: the existing lock has never actually fired in production

Checked while verifying the EXECUTE revoke, and worth recording because it corrects the emphasis of
everything above. Of the 6 campaign-bound characters, **all 6 carry an `award` event and all 6 of those
are `noLock:true`** — CharGen's creation-budget award. **Zero characters, campaign-bound or solo, carry
a locking award.** Meanwhile **49 real DM awards** have gone through `award_ap()` into `characters.ap`,
which never touches the LOG.

So `pact_enforce_locked_history()` has been live since 2026-08-10 and has **never locked anything**. The
mechanism is real and correct; it simply has no trigger in practice, because the only path that writes a
locking `award` event is the Live Sheet's own in-sheet "+ Award AP" button, which nobody has used on a
campaign character. The DM Console — the button a DM actually presses — writes only the column.

This does not change the design, but it sharpens why the seal is the thing that makes it real, and it
means the regression tests in the SQL harness protect a code path that has not yet run against live
data. It also makes the first live seal genuinely the first exercise of this trigger.

## Options

- **A1 — the AP award itself is the seal.** Rejected: AP already reaches a character by two paths
  feeding the same spendable total, so an award in the log too would double it.
- **A2 — seal the Undo button only.** Fails the un-select requirement outright.
- **A3 — CharGen read-only once sealed.** Blocks forward progress; wrong product.
- **A4 — a `sealed_through_event_id` column.** Raised by two reviewers, recommended by neither. Stores
  derived state beside an event-sourced log.
- **A5 — a new `sessionSeal` event with its own new trigger.** *(drafted, then withdrawn)* — a second
  overlapping trigger, with a stricter comparison than the one it sat beside.
- **A6 — a `sessionSeal` event that AMENDS the existing trigger.** *(chosen)*

## Decision

Three surgical changes to what already exists, rather than anything new:

1. **`sessionSeal` joins the protected projection** (`pact_ap_ledger_protected`), so a seal cannot
   itself be deleted or reordered.
2. **The boundary becomes the later of** the existing award boundary and the last seal.
3. **The seal half applies to solo characters too.** The award half keeps its campaign-only scope
   exactly as before.

Plus the entry points that had no equivalent: `seal_character_history()` (DM for a campaign character,
owner for a solo one), atomic and idempotent `award_ap_and_seal()`, and `sessionSeal` on
`dm_edit_character_log()`'s allow-list with any smuggled AP value stripped.

**The owner's three rulings still collapse into one invariant** — *the protected prefix may not be
altered; anything may be appended after it* — because J1 corrections append, K3 description edits can
be made to append (the engine replays `name` and appearance patches as last-wins assignment), and the
rule names no author, so it covers both tiers. That is what makes an amendment sufficient where an
exception list would not be.

## Why this is safe against the 35 live characters

Measured 2026-09-01: **zero** characters carry a `sessionSeal`. So change (1) alters no existing
protected set, and (2) and (3) are no-ops until somebody deliberately places the first seal. The award
boundary's behaviour is byte-for-byte unchanged — asserted directly by regression tests, not argued.

`js/engine.js` carries two floors, deliberately. `undoFloor()` is the client's, and is broader: it also
treats `dmEdit` and `creationLocked` as barriers and (matching the Live Sheet's original hand-written
check) does not exempt `noLock` awards. `sealedFloor(events, opts)` mirrors the server exactly,
including the campaign-only scope of the award half. `sealedFloor <= undoFloor` for every shape — the
client always refuses at least as much as the server, which is the safe direction; the reverse would
mean rejecting a save the UI had called legal.

## Verification

- `engine-parity-ci.mjs` **73/0** · `undo-barrier-ci.mjs` **37/0** · `tool-pricing-ci.mjs` **184/0**.
- `testing/sql/session-seal-test.sql` — **32 assertions, exit 0**, against a real Postgres 16. Its
  first section is the one that matters: **regression tests proving the 2026-08-10 award boundary is
  unchanged** — pre-award history still unrewritable, still unable to shrink, `cat:'patch'` still
  exempt, appends still allowed, solo characters still outside the award half. Then the new behaviour:
  both authorisation tiers, a sealed solo character protected, the seal itself unremovable, J1 and K3
  appends allowed, the later-of-award-and-seal boundary, idempotent retries.
- The **rollback** was applied to a live test database and verified to restore the 2026-08-10 bodies
  **without removing the pre-existing award protection** — the failure mode that matters most, since a
  naive rollback that dropped `trg_pact_locked_history` would strip protection older than this work.

### Two harness defects found and fixed rather than left standing

- Identity was set with `set_config(..., true)` — transaction-local — so two authorisation cases ran
  with a NULL user and reported PASS while testing nothing.
- The allow-list rejection case was being refused by the authorisation check, not the allow-list.

## Known-unstable, unrelated

`tool-pricing-ci.mjs` intermittently reports `harness — CharGen never became ready for the version
check` and aborts early. Seen three times today, once *before* any change was made; passes on re-run. A
readiness race in the harness, not a product defect. Worth its own task.

## Phase 2 — what shipped 2026-09-01

- **CharGen `retractFlatEvent()` refuses a splice inside the sealed prefix**, returning false so
  `onChecklistToggle()` puts the tick back. This — not `undo()` — is the path the owner's requirement
  was really about: un-ticking a checkbox removes the purchase with no undo involved.
- **`_cgLockSealedControls()`** disables sealed checkboxes and appends a **visible** `🔒 sealed` marker.
  Visible rather than a `title` tooltip because a disabled input fires no hover or focus event in any
  browser, making a tooltip unreachable by keyboard and touch (M365 Copilot review point). It only
  re-enables boxes it disabled itself, so it cannot undo the stat-cap/caster-gate disabling.
- **Live Sheet Import and Reset refuse on a sealed character**, explaining why and pointing at "New
  character". Both keep the character's id, so on a sealed character they are writes the server would
  reject anyway — better refused where the reason can be given.
- **DM Console gains both controls**: an "and lock history" tick on the award form, and a standalone
  "🔒 Lock history" button. The tick routes through `award_ap_and_seal()` — one atomic call, not two
  jobs — with a fresh idempotency key per click.

Verified in a real browser (`tool-pricing-ci.mjs`, 189/0): a sealed purchase cannot be retracted and
says why; one made after the seal still retracts freely; undo refuses to cross a seal; an unsealed
character is wholly unaffected; and `sealedFloor <= undoFloor` holds across log shapes.

### Phase 2, second pass — the two gaps closed

- **CharGen's whole-build paths are guarded.** 🎲 Randomise refuses on a sealed character (at both the
  panel and the roll, since the panel is reachable by more than one route), and a file load refuses
  only when it would keep the current character's id — a file carrying a *different* id is a different
  character and switches to it harmlessly. "New Character" is deliberately unguarded: `applyBuild({})`
  mints a fresh id, so it detaches rather than overwrites.
- **A seal rejection no longer retries for ever.** This was a real bug in the obvious implementation:
  `saveCharacter()`'s catch-all leaves a failed push dirty "and will retry", but a seal rejection can
  never succeed — the server is refusing this *history*, not this *attempt*. Left alone it would spin
  on every 3-second autosave and pin the sync chip at "unsaved" permanently. `isSealRejection()` now
  classifies it and `_sealBlocked` stops further pushes. That set is **in-memory and page-lifetime, never
  persisted**, because reloading is the remedy — persisting it could strand a character whose seal was
  later rolled back, the same failure the 2026-08-10 `base_updated_at` guard already learned.
- **Both tools explain it once** and pause cloud autosave: the player's work is not discarded (it stays
  on screen and in the local save), they are told to export a copy if they want the record, and that
  reloading picks the character up from where the DM sealed it. Deliberately no retry button — nothing
  the page can do will make that write land.

Classifier coverage matters in both directions and is tested that way (`sync-concurrency-ci.mjs`, 20/0):
too loose and an ordinary network failure stops retrying and looks like data loss; too tight and the
tool spins on an impossible save. The AP-budget trigger's rejection is explicitly NOT a seal — it is
retryable once a DM awards more AP.

## Still open

- **The end-to-end refusal has no single integration test.** The server half is proven by
  `testing/sql/session-seal-test.sql` against a real Postgres and the client half by
  `tool-pricing-ci.mjs` in a real browser, but nothing exercises the whole round trip: the stub server in
  `sync-concurrency-ci.mjs` has no error-injection seam, and adding one is a larger change than the
  remaining coverage justifies today. Worth a task.
- **No live end-to-end trial has been run** — no character has actually been sealed in production yet.
