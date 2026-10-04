# D-GH-2026-10-01-creation-lock-integrity — a finished character stays finished

Status: Active. Part 1a (CharGen reload fix) shipped on `claude/epic-meitner-f8vldf`; the campaign-move
rule below (L1) is decided and lands with the server guard (Part 2 of
`docs/plans/2026-10-01-creation-lock-integrity.md`). **Partly supersedes
`D-GH-2026-09-01-campaign-move-clears-creation`** (see Decision 2).

## Context

On 2026-10-01 the DM found that only two of the six "Amble" characters were creation-locked. Live data and
`character_backups` showed four had lost their lock — and three their DM-set creation limit, one its name —
between 26 Aug and 17 Sep. Every lost version was a whole-log rebuild: events renumbered from 1, CharGen's
fixed category order, one timestamp.

Reproduced in Chromium: finish creating in CharGen, reload — the lock is gone, same character id.
`_cgBoot()` restored the autosave / Live Sheet handoff verbatim (through `_cgApplyEnvelope()`), then the boot
seed called `replaceWholeLogFromBuild(_domReadBuild())` anyway. The form has no control for
`creationLocked` / `creationUnlocked` / `creationLockConfig`, so every reload deleted them.

A cold review of the fix plan (fresh subagent, 26 findings) also showed that F2 — "only a move to a
*different* campaign clears the lock", agreed earlier the same day — still leaves a detour: leave Amble, join
any other campaign (including one the player runs as DM), buy at creation prices, rejoin Amble.

## Options

**Reload fix:** I1 carry the lost events across each rebuild path (the random-roll patch's approach, which
had already failed once); **I2** stop rebuilding a restored log, and make the remaining rebuild paths merge
rather than rewrite; I3 forbid whole-log rebuilds on any character with history.

**Campaign moves:** F2 clear the lock only on a move to a different campaign; **L1** never clear the lock on
a campaign move — the new DM reopens creation explicitly if they want it.

## Decision

1. **I2.** Part 1a: the boot seed runs only when nothing was restored. The remaining rebuild paths (roll,
   `#b=` link, legacy imports) follow in Part 1b.
2. **L1 (owner, 2026-10-01).** A campaign move never clears `creationLocked`. This **replaces the "locks go"
   half** of `D-GH-2026-09-01-campaign-move-clears-creation` for the finished-creation lock. Whether the DM's
   ceiling figure should still be cleared on a move is to be settled in Part 2's design (that decision's
   "one table's number must not govern another" reasoning still applies to the figure).
3. Server-side: lock-family events become append-only for campaign characters, and only a DM can append
   `creationUnlocked` or a ceiling (Part 2, D1).

## Why

- The reload bug is the root cause; fixing the one place that destroys the log beats patching each
  symptom, and a regression test pins it.
- L1 makes "only your DM can reopen creation" — the promise the Finish-creating dialog already makes —
  actually true. F2 could be bypassed by any player able to create their own campaign.
- A new DM loses nothing: `dm_reopen_creation()` already exists and is one click in DM Console.

## Status

Part 1a done (tests: new `chargen-flows-e2e.mjs` section fails on the old code, passes on the new; engine
parity 73/0). Interim end-of-log locks applied to the four unlocked Amble characters (AP unchanged). Parts
1b, 3 (history repair with DM sign-off) and 2 (server guard + L1) to follow, in that order.

## Addendum — 2026-10-04

- **Second cause found:** Skylar (2 Oct) and Archer (3 Oct) lost their interim locks *after* the reload fix
  shipped — a stale local copy (pre-lock `seq`) pushed over the newer cloud save. Root cause still open; the
  server guard (D1) is now prioritised ahead of Part 1b (owner decision **P1**).
- **Q1 (owner):** lock points are judged on **current-rules prices** (`compute(foldBuild(LOG)).total`), not
  the stored ledger, which held stale prices (Skylar's Proficiency +3 recorded at 4 AP vs 18; Moss's Wild
  Shape at 0). This moved Moss's crossing to 8 Sep (Wild Shape) and gave Skylar 14 AP in-play.
- **R (owner):** no mechanics change — drawback AP stays in the creation limit.
- **S1 (owner):** campaign characters' backups are never pruned (the 50-version window lost Archer's history).
- Draft migration `sql/migrations/2026-10-04-creation-lock-guard.sql` (D1 + L1 + S1) — not applied; testing
  approach (decision T) pending. Handoff: `docs/sessions/2026-10-04-creation-lock-restart.md`.

## Addendum — 2026-10-04 (guard applied)

- **T (owner):** testing the guard. A Supabase test branch (the recommended T1) was refused — branching needs
  the Pro plan and this project isn't on it. Owner chose **G1: a throwaway Postgres in Docker**. The
  rolled-back-transaction-on-live option was rejected as unsafe; bringing CI's test database up to date
  stays a separate job (it is missing at least five functions).
- **Applied to live 2026-10-04** as migration `creation_lock_guard` (D1 + L1 + S1), after
  `testing/scripts/creation-lock-guard-test/run.sh` showed the attacks succeed without it and are refused
  with it (22 cases), the DM tools still work, a move keeps the lock, and campaign backups are kept. All six
  Amble characters re-checked as locked afterwards.
- **Fidelity limit, stated plainly:** the Docker test omits RLS, the AP-budget / player-AP-ceiling / basic-mode
  triggers and real Supabase Auth; the live `snapshot_character()` and
  `pact_campaign_move_clears_creation()` were compared to the repo's versions by reading (same logic, comments
  differ). The post-apply Postgres log skim was not possible.
- **Anders (owner):** his lock goes straight after the Forgery kit (85 AP), the first purchase over the
  limit + drawbacks of 84. Psychic Blades T3 therefore becomes an in-play purchase (gold and downtime). Not yet
  applied to his live log (Part 3).
- **New rule (owner), logged as task `fix/no-purchase-refunds`:** nothing bought can be un-bought for AP
  except drawbacks; dumping below 10 at creation stays; after the lock nothing purchased can be removed or
  lowered. Found via Caspian's and Skylar's lock-check copies. The live `pact_enforce_locked_history()` already
  refuses lowering an ability score once a campaign character has an award — the engine rule is the missing half.

## Addendum — 2026-10-04 (stale-copy cause fixed)

- **Cause (found by reading the code; reproduced in `sync-concurrency-ci.mjs`, not yet seen in a real browser
  against the cloud):** two local stores per tool — the tool's own autosave, and `js/sync.js`'s record carrying
  `base_updated_at`. A reload restored the first while a background reconcile refreshed the second.
- **Owner decisions L2 + L3:** fix it by provenance (the autosave records the cloud version it came from and
  the sync layer pins it on restore), in both CharGen and the Live Sheet — not by a time limit alone.
- **The owner's 8-hour timeout was NOT built as a clock.** A copy whose base is recorded is checked against the
  cloud row directly, so age adds nothing (a current copy is not made stale by sitting still); a copy with no
  recorded base cannot be proven, so it is refused immediately, which is stricter than 8 hours. An age-based
  rule for unprovable copies was tried and dropped: `reconcile()` overwrites the record's edit time with the
  newer row's, so it fails in exactly the case it is for.
- **Cost, stated plainly:** every existing autosave is "legacy" (no `cloudBase`), so each returning player sees
  one "this copy is out of date — reload" refusal per character if a cloud row exists, and one ☁ Cloud → Load
  fixes it. Nothing is overwritten either way.

## Addendum — 2026-10-04 (the block never existed in CharGen)

- **Finding:** the creation-ceiling block shipped in Live Sheet only. CharGen never called `wouldExceedCeiling()` (0
  call sites), contradicting the 2026-08-30 plan's "Done when" #2. Of the six Amble characters the four that overspent
  are CharGen characters; the two Live Sheet ones kept a working block. An earlier statement in this work — that the
  block "lives in the tools and was switched off when the limit was missing" — was true only of Live Sheet.
- **Owner decisions:** U1 (the lock and limit stay in the event log, protected by the server guard — not moved to
  columns); T1 (DM Console flags campaign characters building with no limit — PR #560); T2/W1/W2 (CharGen refuses
  an over-limit edit, hard; prompts at exactly 0 left); B (cap the roll at the ceiling — second half not built, see the
  plan §8); T3/T4 declined (no automatic lock, no fail-closed default ceiling — both re-create the wrong-number
  lock that started this).
- **Lock rule restated for the record:** the lock is a deliberate act (the player's "Finish creating", or the DM). The
  "crossing purchase" rule (the purchase that takes spend *past* the limit counts as creation and the lock goes straight
  after it) applies only to *reconstructing old histories* locked by the retired automatic tripwire; in the tools as
  they stand a purchase past the limit is refused, so none can cross.

## Addendum — 2026-10-04 (repair and server-freeze decisions)

- **N1 / O1 (owner):** the Amble repair is planned first and written one guarded transaction per character
  (`docs/plans/2026-10-04-amble-lock-repair.md`). **O1: gold and downtime are charged retroactively** — and removed where a
  purchase moves before the lock — using Amble's own economy. Amble has no gold awards, so this is a debt: Skylar's single
  Proficiency +3 (18 AP) becomes 750 gp / 90 days. Owner to confirm the magnitudes.
- **B2 / D2 / E1 (owner):** CharGen records post-lock purchases as appended in-play events (decreases refused); the server
  freezes everything before the lock (D2) and priced patch events after a lock/award (E1). The patch-event hole was found
  by test on the Docker copy of the live rules: `pact_ap_ledger_protected()` excludes `cat = 'patch'`, so after an award a
  player could lower Hit Dice, strip proficiencies, set a stamped cost to 0 or delete the event. That is how Caspian's
  −11 AP refund and Skylar's post-lock "Ability scores −4" got through. Both rules come after the repair.

## Addendum — 2026-10-04 (the Amble repair is done)

- **Rule as applied (S1/Y):** everything up to and including the creation lock is creation; everything after is in play. The lock goes
  right **before** the first purchase whose spend ends past the ceiling (limit + drawback AP), whatever that purchase costs (1 AP or 18). This
  replaces G2's "lock after the crossing purchase". A character that never ends over its ceiling (Caspian) is locked at the end. Multi-step
  bundles (Archer's 8-step Spellcasting) are split per step so the lock can fall inside them.
- **Limits (U2):** every limit is the AP the character earned through chapter 4 (session 4 ended 2026-08-23, when the lock was meant to fire
  and was missed — the root of the mess), summed from `ap_awards`. The log entry records where the figure came from.
- **Gold and downtime (O1/G1):** charged retroactively in full using Amble's "standard" band, removed where a purchase moved before the lock.
  Amble has no gold awards, so every charge is a debt. The party downtime window was widened 60 → 365 days by editing the one declaration
  (a new declaration would have restarted the window).
- **Seal (H2/J1):** after the last repair, a `sessionSeal` was appended to all six. The DM Console award tile cannot seal
  (`feat/dm-console-award-seal`).
- **Safeguards that held:** every write was a single UPDATE guarded by id, `updated_at`, event count, SEQ and the md5 of the candidate;
  pre-write copies kept; the history-lock and AP-budget triggers disabled only for one transaction each (Moss rewrite, Caspian, Anders) and
  verified re-enabled; the forensics scripts were rehearsed against the real triggers in Docker first.
- **Bugs found in the repair tooling, worth remembering:** `foldBuild()` aliases event payloads, so a log with a spellcasting patch plus later
  indexed steps silently rewrites the patch — always fold a deep copy; and "drop repeated records" must be limited to zero-cost `patch` events
  or it eats real step events.
- **Left alone:** Caspian's pre-lock −11 AP ability refund; bare free-subclass picks (N3).

