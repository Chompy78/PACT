# Plan — creation-lock integrity: CharGen merge-rebuild (I2), server lock guard (D1 + F2), Amble history repair (G2)

**Date:** 2026-10-01 · **Status:** draft for cold review · **Branch:** `claude/epic-meitner-f8vldf` (to be split per part)
**Related:** `docs/plans/2026-10-01-amble-creation-lock-review.md` (the per-character repair data, DM-approved)

## Goal
A character's "creation finished" lock, its DM-set creation limit, and the order of its purchases must
survive every tool action. Then the six live characters in the "Amble" campaign get correct, backdated
locks that nothing can silently undo.

## Context (self-contained)
- **App:** static vanilla-JS PWA for a tabletop RPG, no build step, no framework. Three browser tools:
  **CharGen** (character builder), **Live Sheet** (play-time sheet), **DM Console**. Backend: Supabase
  (Postgres + row-level security), reached directly from the browser. No server code may live in the repo;
  logic on the server is SQL functions/triggers shipped as migration files.
- **Data model:** a character is an **event log** (`LOG`, an ordered JSON array, plus `SEQ`, the next
  sequence number) stored in `characters.stats`. Everything else (HP, AP spent, prices) is derived at
  runtime by the rules engine `js/engine.js`. Relevant event types: `buy` (a purchase; `cat:'patch'` buys
  are singleton "slots", e.g. ability scores, edited in place), `award` (DM-granted AP), `name`,
  `creationLocked` (creation finished — later purchases are priced in-play), `creationUnlocked` (creation
  reopened), `creationLockConfig{threshold}` (the DM's creation-AP limit), `sessionSeal`.
- **Lock semantics:** last of `creationLocked`/`creationUnlocked` wins. Effects of being locked: own-species
  traits cost more, and in a campaign with the economy on, purchases cost gold and downtime. The lock has no
  effect on purchases made before it (prices are stamped per purchase).
- **Existing server protection:** a trigger (`pact_enforce_locked_history`) refuses a save that rewrites,
  reorders or shrinks any *protected* event (`award`, non-patch `buy`, `buyoff`, `names`, `sessionSeal`,
  `dmRemoveBoon`) at or before the last DM award / session seal. **Lock and limit events are not protected**,
  so a player save may drop them. The client's sync layer recognises the phrase "locked character history"
  in a refusal and shows a reload/recovery path.
- **DM actions** are `security definer` SQL functions that check `is_campaign_dm(campaign)`, e.g.
  `dm_reopen_creation()` appends `creationUnlocked`; `dm_set_creation_ceiling()` appends the limit.
- **Campaign-move trigger** (`pact_campaign_move_clears_creation`, shipped 2026-09-01): whenever
  `campaign_id` changes (join, leave, transfer) it appends a null-limit config + `creationUnlocked`. Owner
  decision of that date: "when a character leaves or joins a campaign, the locks go."

## Verified vs. assumed
**Verified (live data / code, 2026-10-01):**
1. Four live characters lost their lock (and three their DM limit, one its name) between 26 Aug and 17 Sep.
   Every lost version is a **whole-log rebuild**: events renumbered from 1, CharGen's fixed category order,
   one timestamp, no lock/limit events. Not a stale copy (each lost version's newest event = its save time).
2. The only producer of that shape is CharGen's `replaceWholeLogFromBuild()` (it calls
   `buildToEventLog()` → `_buildEventBurst()`), reached from: page boot, random roll, `#b=` share links,
   legacy flat-build files, untagged Live Sheet exports, legacy autosave, New Character.
3. Every *normal* load (cloud, native file, autosave, Live-Sheet handoff, undo/redo) reinstates the saved
   LOG verbatim after `applyBuild()`; the engine's `repriceDraft()` keeps the lock. Random roll has carried
   lock/limit events since 2026-09-01 (live on `main` 1 Sep 19:46 AWST) — yet losses occurred on 3 and
   17 Sep, so at least one other path above is live.
4. A `creationLocked` appended at the **end** of a log changes no AP for any of the six characters
   (engine run, before/after identical). The interim end-of-log locks were applied 2026-10-01; the server
   accepted them.
5. Placing the lock at the G2 points (purchase that crossed the limit counts as creation; lock after it)
   also changes no AP for any of the six; only gold/downtime may change.

**Assumed (to verify during implementation):**
- A. Which rebuild path the players actually hit — likely boot after the browser restored form values.
  The merge approach below makes this moot, but a test will still exercise every path.
- B. `_replay()` in `js/engine.js` ignores unknown event types (needed for F2's new marker event).
- C. In Supabase, the `postgres` role used for the one-off repair can temporarily disable the history
  triggers inside a single transaction (`alter table … disable trigger`), or set `session_replication_role`.

## Proposed approach

### Part 1 — I2: CharGen rebuilds merge instead of rewrite (`js/engine.js`, `tools/PACT-CharGen-Webtool.html`)
1. Add a pure, exported `mergeRebuiltLog(oldLog, freshLog)` to `js/engine.js` (additive API; log plumbing,
   not rules). Algorithm:
   - Identity key per event: patch slot → `_slot`; other `buy`/`buyoff` → `cat` + canonical JSON of
     `payload` (+ occurrence count, so a twice-bought item matches twice); `name`/`award` singletons by type.
   - Walk `oldLog` in order: keep every event whose key still exists in `freshLog` **verbatim** (seq, ts,
     cost, position); for a patch slot whose payload changed, keep the old position and replace the event
     body in place (as `replacePatchSlot()` already does).
   - Keep unconditionally any event CharGen's form cannot represent: `creationLocked`, `creationUnlocked`,
     `creationLockConfig`, `sessionSeal`, `award`, `dmRemoveBoon`, `names`, and anything of unknown type.
   - Drop old purchases absent from `freshLog`; **append** genuinely new fresh events at the end with new
     seq numbers.
   - A singleton whose fresh value is empty (e.g. blank name field at boot) does not overwrite the old one.
2. `replaceWholeLogFromBuild()` uses the merge whenever the build's character id equals the current
   character id and the existing LOG is non-empty; a different/new id still gets a fresh burst.
3. Delete the random roll's special-case carry (`_rollCarry`) — superseded, and a second mirror is the drift
   pattern this project keeps paying for.
4. Keep `_cgBlockedBySeal()` as is (it refuses whole-log rebuilds of sealed characters up front).

### Part 2 — D1 + F2: server guard (`sql/migrations/2026-10-xx-creation-lock-guard.sql`)
5. New `BEFORE UPDATE` trigger `pact_enforce_creation_lock` on `characters`:
   - The ordered list of lock-family events (`creationLocked`, `creationUnlocked`,
     `creationLockConfig`, new `campaignLeft`), stripped of `seq/ts/rules/label`, in OLD must be a **prefix**
     of the same list in NEW — they are append-only. Message contains "locked character history" so the
     existing client recovery path fires.
   - Appending `creationUnlocked` or a `creationLockConfig` is allowed only if `is_campaign_dm(campaign)`,
     or when the caller is the campaign-move trigger (flagged with a transaction-local setting, e.g.
     `set_config('pact.system_edit','on',true)`), or `auth.uid()` is null (service/admin).
   - Appending `creationLocked` is always allowed (player's "Finish creating").
6. **Campaign moves — L1 (owner, 2026-10-01; replaces F2):** a join, leave or transfer **never clears
   `creationLocked`**. The new DM uses `dm_reopen_creation()` if they want the character back in creation.
   Whether the DM's ceiling figure is still cleared on a move is settled in this part's design. Implemented
   inside the same trigger as step 5 (no transaction-wide bypass flag — review finding H4). No
   `campaignLeft` marker is needed any more.
7. After applying: run the Supabase security and performance advisors and skim the logs (repo rule).

### Part 3 — G2: one-off repair of five Amble characters (runs after Parts 1–2 are live)
8. For Anders, Fenwick, Skylar, Moss and Archer: build the new LOG offline with the engine — purchases up to
   and including the crossing purchase, then `creationLocked` (label: backdated, with date), then the
   post-lock purchases in their original relative order. Remove the interim end-of-log lock. Restore the DM
   limits (Fenwick 74, Skylar 76, Archer 68, Moss 79) and Archer's name. Caspian keeps its interim lock only.
9. Dry run: diff full `foldBuild()` + `compute()` output before/after per character; report AP (expected
   unchanged) and gold/downtime owed. **DM signs off before any write.**
10. Write: one transaction; guard each row on its `updated_at` still matching the value read (abort if a
    player saved meanwhile); temporarily disable only the history triggers for these rows' update; re-enable;
    re-read and re-verify. Originals are already captured by the automatic `character_backups` trigger, plus a
    copy kept in the session scratch area.

## Files involved
`js/engine.js` (new export) · `tools/PACT-CharGen-Webtool.html` (`replaceWholeLogFromBuild`, random roll) ·
new migration under `sql/migrations/` · `testing/scripts/` (new merge unit test, CharGen e2e additions,
server guard test) · `testing/expected/` only if `compute()` output changes (it should not) · `CHANGELOG.md`,
`DECISIONS.md` + a `decisions/2026/` record (F2 reverses part of an owner decision of 2026-09-01).

## Out of scope
Rate limits; the Live Sheet (never rebuilds its log); other campaigns' characters (the repair is Amble
only — but a read-only scan of all campaigns for the same loss pattern is a recommended follow-up task);
any change to lock *pricing* rules.

## Alternatives considered
- **I1 — carry lock/limit/name across each rebuild path** (like the random-roll patch): rejected — still
  destroys purchase order, and has already failed once (losses after the roll fix).
- **I3 — forbid whole-log rebuilds on any character with history:** rejected as primary — removes features;
  kept implicitly for sealed characters via `_cgBlockedBySeal()`.
- **Add lock events to the existing protected projection** instead of a new trigger: rejected — that
  projection only guards the prefix up to the last award/seal, and positional rules there would also freeze
  legitimate later appends; lock events need "append-only, DM-only reopen" semantics, which is different.
- **F2 via a server-only column** (`characters.last_campaign_id`): viable, but needs column-level grant
  changes on a table whose grants have drifted before; a log event guarded by step 5 avoids that.

## Risks
- Merge identity keys too loose/strict → duplicate or dropped purchases. Mitigation: unit test over every
  real backup log (≈500) asserting merge(old, rebuild(old)) == old.
- New guard refuses a legitimate client save (e.g. an old open tab) → player sees a refusal. Mitigation:
  reuse the existing recovery message; test the open-stale-tab case.
- Disabling triggers during the repair is a privileged operation. Mitigation: single transaction, five rows,
  `updated_at` guard, re-verify after.
- F2 reverses part of a recorded owner decision — must be logged as a new decision record.

## Verification
- `testing/tests/engine-parity.html` (headless per `docs/HOW-TO-WORK.md`) → **0 failed**.
- New node test: for every LOG in a read-only export of `character_backups`, `mergeRebuiltLog(L,
  burst(fold(L)))` keeps every lock/limit/award/seal event and every surviving purchase's seq/ts/position.
- CharGen e2e (Playwright, existing `chargen-flows-e2e.mjs`): finish creation, then for each rebuild path
  (boot with restored form, roll, `#b=` link, legacy file, Live Sheet export) assert the lock and order
  survive.
- Server test: as a player, removing `creationLocked` or appending `creationUnlocked` is refused; as the DM,
  reopen succeeds; leave + rejoin same campaign keeps the lock; transfer clears it.
- Supabase advisors clean after the migration.
- G2: post-write engine output for all six matches the signed-off dry run exactly.

## Done when
All checks above pass; Parts 1–2 merged to `preview`; G2 applied with DM sign-off; all six Amble characters
show locked with the agreed lock points; CHANGELOG/DECISIONS updated.

---

## Reviewer instructions
1. First line of your response: your model name and settings.
2. Judge logic, clarity, scope and risk — not code you cannot see.
3. Answer: Does this achieve the goal? Which assumptions are shaky? Is there a better alternative for any
   part? What is missing? Is the Verification section objectively checkable? Should this split into
   separate plans (e.g. one per part)?
4. Output a `.md` file named `creation-lock-integrity-review-<model>.md`.

## Review outcome
**Round 1 — 2026-10-01, fresh subagent (no repo access, plan text only).** 6 High / 11 Medium / 9 Low.
Every finding below was checked against the code before being accepted.

- **H1 boot path — ACCEPTED, root cause confirmed and FIXED.** Reproduced in Chromium: finish creating,
  reload → lock gone, same id, log renumbered. `_cgBoot()` restored the autosave/handoff verbatim, then the
  boot seed rebuilt the LOG from the form. Fixed (seed skipped when a LOG was restored) with a regression
  check in `chargen-flows-e2e.mjs` that fails on the old code. Assumption A is resolved.
- **H2 fresh burst over the saved row — PARTLY ACCEPTED.** Untagged/legacy imports go through
  `applyBuild()` without an id, which mints a new one (code comment confirms), so they create a new
  character. `#b=` share links serialise `readBuild()` — whether that carries the id is to be verified in
  Part 1b, with a test.
- **H3 post-lock purchases moved before the lock — ACCEPTED.** The server guard must protect order around
  the last `creationLocked`, not just the lock events. Patch slots need the derived-value approach the
  existing history trigger already uses (they are rewritten in place by design). Pre-existing note:
  CharGen edits a patch slot in place even after the lock — out of scope, logged as a follow-up.
- **H4 transaction-wide flag — ACCEPTED.** Replace the flag with a single trigger that performs the
  campaign-move appends *and* the guard, so no bypass state exists.
- **H5 leave/rejoin detour (Y→Z→Y) — ACCEPTED, needs an owner decision** (threat model): see L below.
- **H6 blocks normal actions — PARTLY ACCEPTED.** CharGen/Live Sheet undo cannot remove `creationLocked`
  already (it is an undo barrier, `undoFloor()`), so that half is moot. Solo characters: the guard applies
  only while a character is in a campaign; with no DM, the owner stays in charge.
- **M6/M7 repair ordering and trigger disabling — ACCEPTED.** Part 3 (repair) runs **before** Part 2
  (guard). No `disable trigger`/`session_replication_role`; instead the repair's update is admitted by a
  narrow check (direct database session with no API JWT claims), which also keeps `character_backups`
  firing.
- **M2 `auth.uid()` null — ACCEPTED** (same fix as M7).
- **M3/M4 campaign checks and forged `campaignLeft` — ACCEPTED.**
- **M1 merge identity keys — ACCEPTED as design input** for Part 1b; M10 assumption B checked:
  `_replay()` skips unknown event types.
- **Verification gaps — ACCEPTED.** Strict-equality merge test; server tests to run against a Supabase
  branch; add a rollback note (restore from `character_backups`).

**Revised order:** Part 1a (boot fix, done) → Part 1b (remaining rebuild paths) → Part 3 (repair, DM
sign-off) → Part 2 (server guard + campaign rule, after decision L).
