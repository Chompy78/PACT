# D-GH-2026-10-05-server-freeze-stage1 — a locked character's priced history cannot be rewritten by a client (D2 + E1), stage 1

**Status:** **APPLIED to the live PACT database on 2026-10-10** (migration `server_freeze_d2_e1_stage1`, one apply, owner-approved). Verified afterwards: four of the five live function bodies are byte-identical to the migration file and `pact_enforce_locked_history` equals it minus three comment lines; security advisors show nothing new; the Postgres logs show no refused save since. A real campaign-character save by a player has not been observed yet. **Stage 2** (drop the temporary exempt list) is still to do, once the newest CharGen is live in shipped clients.
(cold-reviewed by two API reviewers and a no-context judge; triage recorded there).

## Context

Between 26 Aug and 3 Oct several Amble characters lost their creation locks, one got a −11 AP refund by lowering two ability scores after the lock, and another had an ability raise reversed.
The server only protected flat purchases, awards and seals — and only up to the last award or seal. `pact_ap_ledger_protected()` excluded every `buy` with `cat='patch'`, so a priced
patch event (Hit Dice, ability scores, proficiencies, spellcasting…) could be lowered, re-priced to 0 or deleted by any client, even after a seal (proved on a Docker copy of the live rules). The
owner decided **D2** (a campaign character's history before its lock is frozen), **E1** (priced patch events freeze completely once locked, awarded or sealed; no-AP slots stay editable) and **O1** (players are
frozen; a DM can only append, through the existing append-only DM routes).

## Decision

One migration, **functions only, no data change**, `sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql` (rollback alongside):
1. **E1, fail-closed on field names.** Every field of a `buy`/`patch` event is protected **except** a permanent no-AP list (`appearance`, `houseRules`, `gold`) and, for stage 1 only, a **temporary** list of fields the
   creation tool still rewrites after a lock until phase 2b ships (spellcasting, innate spells, martial binding, dabbler cantrips, species, origin classes, size, lineage). The two lists are separate functions so a temporary
   entry cannot quietly become permanent; stage 2 deletes the temporary list. Only the protected fields plus the event's `type`, `cat`, `cost`, `gp`, `days` are compared, so a deleted or nulled field and any cost change always trip it.
2. **D2.** For a campaign character that is *currently* locked (last `creationLocked` after the last `creationUnlocked`) the lock is a freeze boundary like a seal. A DM reopening creation lifts the lock boundary
   (never a seal or award boundary). Solo characters are not covered (no DM; the owner decides).
3. Everything else untouched: the species freeze, the ability-score ratchet, the creation-lock guard, the AP-budget check, grants, stored rows.

**Why fail-closed.** A future priced slot added to the client would otherwise be silently unprotected — the exact failure the trigger exists to prevent. The cost of the other failure (an honest save refused until a list is updated) is
loud, visible and one line to fix. (Both API reviewers and the judge reached this independently from opposite sides.)

**Threat model, stated plainly.** The client stamps its own AP costs and the server cannot re-price, so this protects against **accidents, stale copies and client bugs**, not a determined cheater who appends free purchases after the lock.

## Evidence (all repeatable)

- **Docker rehearsal** (`testing/scripts/creation-lock-guard-test/run-freeze.sh`, in CI as `freeze-rehearsal`): 61 cases. Before: **36 attacks work today**; after the migration: **61/61 pass**; the rollback restores byte-identical
  definitions and the attacks work again. One case per patch key, including an unknown future key (refused).
- **Backup-replay audit** (`backup-replay-audit.mjs`): 573 saved states of 42 characters → **457 real old→new saves**. The old rule refuses 3; the new rule refuses 27; **24 are refused only by the new rule, and all 24 are rewrites of
  history after a lock** — priced events re-stamped or edited in place, logs rebuilt in a different order by the "rebuild from form" bug, and four admin repair writes on 2026-10-04 (which rewrote history on purpose and would, like Anders'
  and Caspian's, need the trigger disabled for one transaction). No refused save is a flow the current clients make.
- **Round-trip audit** (`roundtrip-audit.mjs`, real Chromium, both tools): every live character the rule would freeze loads and saves with its frozen history untouched, in the Live Sheet, in CharGen, and after a harmless CharGen edit
  — including a stress mode that treats every locked character as campaign-bound and synthetic Live-Sheet-origin variants. **It found a real defect first:** opening a locked campaign character that began in the Live Sheet moved its
  "Imported budget" award from the top of the log to the end (the "protect history" guard followed seals and awards but not the lock) — which the freeze would have refused. Fixed in `fix/chargen-post-lock-2b1-refusals` (#579, merged).

## Status and next steps

- **Applying this is the owner's call.** When applied: add the migration to the `\ir` lists in `testing/sql/session-seal-test.sql` and `testing/sql/rls-baseline-test.sql`, fold the changed functions and helpers into `sql/rls-policies.sql`, run the Supabase
  advisors, watch the logs. Until then the baseline correctly describes production.
- Stage 2 (a later migration) deletes `pact_patch_temp_exempt_keys()` once the creation tool buys spellcasting, innate spells and identity changes the proper way (phase 2b; 2b-1 already refuses them after the lock). Until then those slots can still be rewritten in place.
- Known residual, unchanged by this: a DM has no in-app way to rewrite sealed history (only a privileged database write) — by design (O1).

## Stage 2 (prepared 2026-10-11, NOT applied)

`sql/migrations/2026-10-11-server-freeze-stage2.sql` makes `pact_patch_temp_exempt_keys()` return an empty list: the eight temporarily exempt fields are protected from then on. One line, functions only, with a rollback that restores the stage-1 list exactly. Precondition met: the newest CharGen (refusals + in-play spellcasting purchases) has been live since v1.599. Rehearsed on Docker (61/61, exact rollback; CI `freeze-rehearsal`). Still to do before applying: re-run `backup-replay-audit.mjs --stage2` and `roundtrip-audit.mjs --stage2` against a fresh read-only export and confirm nothing a current tool does is refused. The apply is the owner's decision.
