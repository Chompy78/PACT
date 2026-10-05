# Plan — server-side freeze of a locked character's priced history (D2 / E1)

> **Status: DRAFT for cold review (2026-10-04).** Task `feat/server-freeze-at-lock`. Owner decisions already made: **D2**, **E1**, **O1** (below).
> Written to be read with **no access to the repository** — every fact the reviewer needs is stated inline.
> Related: `docs/plans/2026-10-04-chargen-post-lock-purchases.md` (the CharGen side, §7 and §9–11).

## Goal

Make a campaign character's already-bought history impossible to rewrite from a client, even by someone calling the API directly, so that stale
copies, client bugs and tampering can no longer undo a creation lock, refund a purchase, or lower a stamped cost. Only append-only DM routes may add
to it. Ordinary play (appending new purchases, editing appearance and names) must keep working for everyone, and no legitimate save may be
refused.

## Context (all inline — no repo access assumed)

**The app.** PACT is a static, vanilla-JS tabletop-RPG toolkit on GitHub Pages. Its only backend is Supabase (Postgres + auth + row-level
security), reached from the browser. A character is one row in `public.characters`; its data is `stats` (jsonb) = `{ LOG: [events…], SEQ: n, name, … }`.
The **LOG is an event list**; the JS engine derives everything (hit points, AP spent…) by replaying it, so only raw events are stored. `characters.ap` is a
separate integer column (DM-awarded AP) written only by DM-only server functions.

**Event types that matter here.**
- `buy` events with a `cat` (category) and a stamped `cost` (AP). Flat categories (`skill`, `boon`, `tool`, `art`, `feature`, `drawback`, `racial`, …) carry
  `payload.v`. Counter categories (`hd`, `prof`, `abil`, `language`, `vigor`, `grit`, `ki`, `sorcery`, `attune`, `armour`, `wprof`, `freesub`, and the spellcasting
  ones `found`, `rank`, `cantrip`, `slot`, `known`, `dbound`) carry the new level. After the lock a purchase may also carry `gp`/`days` (gold and downtime paid).
- **`buy` with `cat = 'patch'`**: a coalescing "bundle" used by the character-creation tool: `payload.patch` is an object of fields (e.g. `{hd:4}`,
  `{stats:{STR:14,…}}`, `{languages:3}`, `{traditions:[…]}`, `{appearance:{…}}`). Creation-era tool code REWRITES such an event in place when the player edits
  the control. Some patch events carry no AP (appearance text); most carry the AP of the whole slot.
- `award` (DM AP awards; some client-written budget awards carry `noLock:true`), `sessionSeal` (a marker the DM — or a solo owner — appends to freeze
  history up to that point), `creationLocked` / `creationUnlocked` / `creationLockConfig{threshold}` ("the lock family": the player pressing "Finish creating",
  the DM reopening creation, and the DM's creation limit), `name`, `names`, `buyoff`, `dmRemoveBoon`, `dmUnlockDrawback`, `rulesSnapshot`, `econSetting`.
- A **creation lock** is a `creationLocked` event; a character is "currently locked" when the last `creationLocked` is after the last `creationUnlocked`.
  Purchases before it are "creation" purchases (AP only); after it they are "in play" (they also cost gold and downtime when the campaign economy is on).

**The incident that motivates this.** Between 26 Aug and 3 Oct several characters lost their locks and some spent past their limit, because nothing on the
server protected them. One character even got a −11 AP *refund* by lowering two ability scores after the lock (a priced patch event rewritten in place), and
another had an ability raise reversed after the lock. A one-off repair of six live characters was done on 2026-10-04 (all now locked and sealed). This plan is
the durable fix.

**The server today (verified from the live database on 2026-10-04).** Eight triggers fire BEFORE UPDATE on `characters`, in alphabetical order:
`trg_characters_snapshot` (copies the old row into `character_backups`), `trg_characters_updated_at`, `trg_pact_ap_budget_consistency` (refuses raising AP *spent*
above spendable AP for campaign characters), `trg_pact_campaign_move_clears_creation`, `trg_pact_creation_lock_guard`, `trg_pact_enforce_basic_mode`,
`trg_pact_locked_history`, `trg_pact_player_ap_ceiling`. The relevant two:

1. **`pact_enforce_creation_lock()`** (SECURITY DEFINER; the "lock guard", added 2026-10-04): for a campaign character, lock-family events are append-only; a
   player may append only `creationLocked` or a threshold-less `creationLockConfig`; a campaign DM may do anything; a direct database session (no API JWT claims)
   is not checked; solo characters (no campaign) are not checked. Its error text contains the phrase "locked character history" on purpose, because the client
   maps that phrase to a "reload this character" recovery message.
2. **`pact_enforce_locked_history()`** (SECURITY DEFINER; fires for EVERY session, including admin and DMs; no exemption). Pseudocode of what it does:
   ```
   v_seal_idx  = index of the last sessionSeal in OLD.log
   v_award_idx = (campaign characters only) index of the last award that is not a discount and not noLock
   v_idx = greatest(v_seal_idx, v_award_idx);  if v_idx = 0 -> allow
   protected_old = pact_ap_ledger_protected( OLD.log events with index <= v_idx )
   protected_new = pact_ap_ledger_protected( ALL of NEW.log )
   refuse if protected_new is shorter than protected_old
   refuse if any protected_old[i] differs from protected_new[i]      -- positional, over the whole list
   -- plus derived-value rules: species/species2 frozen once set; ability scores in the LAST stats patch may only go up
   ```
   and **`pact_ap_ledger_protected(log)`** returns the events (each with `seq`, `ts`, `rules`, `label` removed) whose type is in
   {`buyoff`, `names`, `award`, `sessionSeal`, `dmRemoveBoon`, `dmUnlockDrawback`} **or** is a `buy` whose `cat` is **not** `'patch'`.
   **That last clause is the hole: every `buy` with `cat='patch'` is excluded**, so after an award or seal a player can still lower Hit Dice, strip a
   proficiency, set a stamped patch cost to 0, or delete the event (proved on a Docker copy of the live rules).
3. The **DM functions** are all SECURITY DEFINER and **append-only**: `dm_edit_character_log` (appends boon/drawback grants, awards, removals, seals, unlocks;
   validates each), `dm_reopen_creation` (appends `creationUnlocked`), `dm_set_creation_ceiling` (appends a limit), `seal_character_history` and
   `award_ap_and_seal` (append a seal). **None of them rewrites or removes an existing event**, so none can conflict with a freeze. There is no DM function
   that rewrites history; the only way to do that today is a privileged database write (which had to temporarily disable the history trigger).

**Client behaviour that matters (verified in code).**
- The creation tool rewrites patch events in place **before** the lock (correct, it is a draft). **After** the lock, as of the current release, it appends in-play
  events instead for: Hit Dice, proficiency bonus, ability scores, languages, vigor/grit, ki, sorcery, attunement, armour, weapon proficiency, free subclass; it
  refuses custom (free-text) proficiencies; and it refuses unticking any purchase or taking a new drawback. **Not yet done** (a separate, planned change): spellcasting
  (`traditions`), innate spells, `martiallyBound`/`dabblerCantrips`, and identity fields — those still rewrite in place after the lock until that change ships.
- Appearance text and names are no-AP and must stay editable at any time; the creation tool still edits the appearance patch event in place after the lock.
- Old browser copies (an installed offline PWA) may run older code for a while; a refused save surfaces as "locked character history… reload".

## Owner decisions already made

- **D2:** for a **campaign** character, nothing **before the lock** may be changed, removed or reordered; events after it may be added. (Solo characters are not
  covered — with no DM, the owner decides, as in the existing lock guard.)
- **E1:** priced `patch` events freeze completely (content, stamped cost, position, existence) once a character is locked **or** has an award/seal. No-AP slots
  (appearance, names) stay editable.
- **O1:** players are frozen; a campaign DM can override only through the existing append-only DM routes (reopen creation, seal, edit log), always leaving a visible
  event. Nothing new for DMs.
- **Staging:** a slot's server rule goes live only when the client can buy that slot the proper (appending) way. Both rules came **after** the data repair.

## Verified vs assumed

**Verified:** the trigger and function text above (read from the live database); the DM functions are append-only; all six campaign characters are sealed;
50 characters exist, 14 locked, 3 locked with no award or seal (all solo); the client rewrites appearance patch events in place; error text routing.
**Assumed (please challenge):** (a) a "priced key" list can classify patch events by content — see approach; (b) positional comparison of the protected list is
still correct once patch events join it; (c) no legitimate client flow rewrites a priced patch event for a locked/sealed campaign character; (d) `character_backups`
(one snapshot per update, kept forever for campaign characters) is a faithful history from which to replay "would the new rule have refused this real save?".

## Proposed approach

1. **Extend `pact_ap_ledger_protected`** to also protect a `buy` with `cat='patch'` **whose `payload.patch` contains at least one *priced key***. Priced keys, in two stages:
   *Stage 1 (client can already append these properly):* `stats`, `hd`, `profBonus`, `languages`, `hardy`, `tough`, `ki`, `sorcery`, `attune`, `armour`, `wornArmour`,
   `weaponProf`, `freeSub`, `customProfs`. *Stage 2 (after the spellcasting/identity client change):* `traditions`, `innate`, `martiallyBound`, `dabblerCantrips`,
   `originClass`, `originClass2`, `species`, `species2`, `size`, `lineage`. A patch event with only non-priced keys (`appearance`, `houseRules`, `gold`) stays unprotected.
   An event mixing keys is protected if any key is priced.
2. **Add the lock boundary (D2)** to `pact_enforce_locked_history`: for a campaign character whose OLD log is *currently locked*, let `v_lock_idx` be the index of the
   last `creationLocked`; set `v_idx = greatest(seal, award, lock)`. Everything protected at or before `v_idx` is then frozen by the existing positional comparison.
   If the character is not currently locked (never locked, or a DM reopened creation), the lock boundary does not apply (the seal/award boundary still does, unchanged).
3. **Keep every existing rule** (species freeze, stat ratchet, creation-lock guard, AP budget) untouched. Ship as **one migration** that `CREATE OR REPLACE`s the two
   functions, plus a **rollback file** that restores today's definitions verbatim. No new trigger, no schema change, no data change.
4. **Rehearse before any live apply**: extend the existing throwaway-Docker harness (it carries snapshots of the live trigger functions) with attack cases and
   regression cases (below). Then run a **backup-replay audit** against `character_backups`: for every consecutive pair (old row → new row) of every real character,
   evaluate the NEW rule and list each refusal; each must be explainable as an illegitimate rewrite, otherwise the rule is wrong.
5. **Client round-trip audit**: for each live character, open it in the real creation tool and the play tool in a headless browser, trigger an autosave, and compare the
   protected projection of the saved log with the original. This catches a client that "normalises" a patch event on load (which would make an honest save refusable).
6. **Rollout** (owner decision, not automatic): apply Stage 1 + D2 first; Stage 2 keys later with the client change; keep the rollback ready; run the Supabase security and
   performance advisors afterwards; watch logs.

## Files involved

`sql/migrations/<date>-server-freeze-d2-e1.sql` (+ `-rollback.sql`); `testing/scripts/creation-lock-guard-test/` (Docker harness: `base.sql`, `triggers.sql`, new
case files, `run.sh`); a new read-only audit script for the backup replay; `CHANGELOG.md`, `DECISIONS.md` decision record, the plan docs. No client code changes.

## Out of scope

Moving the lock to its own column; changing the species/stat-ratchet rules; client changes; solo characters; rate limiting; making DMs able to rewrite history in the app
(they cannot today); retroactively validating stored logs (the rule only compares an old row with a new one).

## Alternatives considered

- **A. A second, separate trigger** for the new rule (isolated, trivially removable) — but the old function already computes the same boundaries; two triggers would compute them
  twice and could disagree. *Leaning against, but open to the reviewer.*
- **B. Protect ALL `patch` events** (simplest) — refuses legitimate appearance edits and no-AP slots. Rejected.
- **C. Protect by `_slot` name** instead of content keys — most boot-time patch events carry no `_slot` (164 of 218 in live data), so it would miss most. Rejected.
- **D. Freeze everything before the lock regardless of type** — also refuses renames and appearance edits. Rejected.
- **E. Let DMs rewrite history through a new function** — out of scope; not requested.

## Risks

1. **False refusals** (highest): an honest save refused because a client rewrites or normalises a protected patch event. Mitigated by the backup-replay and round-trip audits and by
   staging by key. Impact if wrong: a player cannot save a character until they reload (error text guides them) — but a sealed character who needs a legitimate rewrite has no
   in-app route (privileged DB write only).
2. **Positional comparison with patch events**: coalescing clients can legitimately rewrite or reorder UNprotected events; protected ones must only ever append. If some flow
   *inserts* a protected event mid-list, it is refused. Believed fine; needs the audit.
3. **Stale clients** at rollout (cached PWA still rewriting in place). Mitigated by the existing "reload" message; Stage 1 only freezes slots the new client already appends for.
4. **Performance**: two extra JSON scans per update; characters are small (tens of events). Negligible; to be measured.
5. **Rollback**: functions only, no data change — fully reversible by running the rollback file.

## Verification (objectively checkable)

Docker harness, **attacks must succeed before and be refused after**, **legitimate cases must pass both**: lower Hit Dice via rewriting a priced patch event after a seal; delete a
priced patch event; set a stamped patch cost to 0; rewrite a priced patch event after a lock with no seal/award (campaign character); reorder protected events — all refused after.
Allowed after: append any purchase after the lock; edit appearance patch; rename (`name` event); append `award`/`sessionSeal`/`creationUnlocked` via the DM functions; DM
reopens creation then a creation-era priced patch is edited (lock boundary lifted) but a sealed one is still frozen; solo character behaviour unchanged; a never-locked draft
unchanged. Backup-replay audit: report of N transitions evaluated, M refused, every refusal classified. Round-trip audit: zero protected-projection differences across all live
characters. Rollback file restores byte-identical function definitions (checked by `pg_get_functiondef` diff).

## Done when

Migration + rollback + Docker cases merged; both audits recorded with numbers in the plan; advisors clean; decision record written; and the owner has explicitly approved applying
it to the live database.

---

## Reviewer instructions (part of this document)

1. **First line of your reply: state which model you are and any settings.**
2. Judge **logic, clarity, scope and risk**. You cannot run anything; do not claim a test would pass or fail. Flag assumptions that look shaky.
3. Answer: (a) Does this achieve the goal without refusing legitimate saves? (b) Which assumptions are shakiest? (c) Is there a better alternative to the two-function change? (d) What is
   missing — especially any legitimate client flow that rewrites a "priced" patch event, or any way an attacker could still rewrite history? (e) Is the verification objectively checkable?
   (f) Should this be split?
4. Output a Markdown file: `server-freeze-review-<model>.md`.

## Review outcome

**Reviewed 2026-10-04 by two API reviewers** (called as `gemini-3.6-flash` and `openai/gpt-oss-120b`; they self-identified wrongly as "Claude 3.7 Sonnet" and "gpt-4-1106-preview" — logged by the
real model id) **plus a fresh no-context subagent** to judge the one finding that changes the approach. Reviews archived in `docs/sessions/cold-reviews/2026-10-04-*-server-freeze-d2-e1.md`.
Every claim was checked against the live database and the plan, not taken on trust.

**Accepted — design changes (adopted into the approach; they supersede approach step 1):**
- **Classify patch events fail-CLOSED, and compare only the non-exempt key/value pairs** (both reviewers pointed at the same weakness from opposite sides; the judge confirmed the two proposals compose and that
  fail-open is the worse failure — a future priced slot silently unprotected). Rule: for a `buy`/`patch` event, protected projection = `{type, cat, cost, payload.patch minus EXEMPT keys}`; an event whose patch has
  **only** exempt keys is not in the protected list. **Permanent exempt list** (no-AP slots): `appearance`, `houseRules`, `gold`. **Temporary exempt list** (client still rewrites them in place after the lock until
  phase 2b ships): `traditions`, `innate`, `dabblerCantrips`, `martiallyBound`, `originClass`, `originClass2`, `species`, `species2`, `size`, `lineage`. The two lists are separate objects so a temporary entry cannot quietly
  become permanent; each temporary entry is removed in a later migration when the matching client change is released. Backed by live data: of the 24 patch field-sets that exist, none mixes a no-AP key with a priced key, so
  nothing legitimate is lost today.
- **Compare projected jsonb objects**, so deleting a key or setting it null registers as a difference; `cost` on a patch event is part of the projection (otherwise it is a free edit).
- **A helper function** `pact_patch_protected_projection(event)` holds the key lists (documented with `COMMENT ON FUNCTION`), called by `pact_ap_ledger_protected`; two migrations (Stage 1 now; Stage 2 = remove the temporary
  exemptions, later) rather than one.
- **CI drift test:** fails whenever the client's source writes a patch key that is on neither list, so list drift is caught in CI, not by a player.
- **Verification additions:** a DM reopen does **not** lift an award/seal freeze (explicit case); inserting a protected patch event mid-list is refused (positional); converting a protected event to an unprotected type is
  refused (list shrinks); synthetic cases for **every** key on both lists, including the temporary ones; an explicit acceptance threshold for the backup-replay audit (**0 unexpected refusals**); a synthetic character per patch
  type for the round-trip audit (live data may lack some); a rollback check by `pg_get_functiondef`.
- **Threat model made explicit (new, found while triaging):** the client stamps its own AP costs and the server cannot re-price, so this protects against **accidents, stale copies and client bugs**, not a determined cheater who
  appends free purchases after the lock. Stated in Out of scope.

**Rejected, with reasons:** *"JSON key ordering will cause false refusals"* — wrong: jsonb objects compare independent of key order. *"Case-variant priced keys bypass the filter"* — the engine ignores unknown keys, so a variant key
buys nothing. *"A spurious seal moves the freeze forward"* — a seal only freezes more. *"Protect the Stage-2 keys now"* — that is exactly the false-refusal risk staging exists to avoid (known residual: until phase 2b ships,
spellcasting/identity can still be rewritten in place after the lock). *"Review RLS/superuser"* — out of scope.

**Residual / for the owner:** applying the migration to the live database is the owner's decision (see the morning summary); nothing in this plan has been applied to live.

## Results (2026-10-05, after the overnight build)

Built as `sql/migrations/2026-10-05-server-freeze-d2-e1-stage1.sql` + `-rollback.sql`; **not applied to live** (owner's decision). Design as revised in the Review outcome above.
- **Docker rehearsal** (`run-freeze.sh`): 61 cases; before the migration **36 attacks work today**; after: **61/61 pass**; rollback restores byte-identical function definitions, and the attacks work again after it. One case per patch key,
  including an unknown future key (fail-closed). In CI as `freeze-rehearsal`.
- **Backup-replay audit** — acceptance threshold from the reviewers ("0 unexpected refusals"): 573 saved states of 42 characters → 457 real saves; old rule refuses 3, new rule 27, **24 only by the new rule — all 24 are rewrites of history after a lock**
  (priced events re-stamped or edited in place; logs rebuilt in a different order; four admin repair writes on 2026-10-04). **0 refusals of a flow the current clients make.**
- **Round-trip audit** — every live character the rule freezes (the six sealed Amble characters), plus a stress mode treating all 18 locked characters as campaign-bound, plus Live-Sheet-origin synthetic variants: **0 differences** in the Live Sheet,
  CharGen load and CharGen edit. It first **found a real defect** (opening a locked campaign character that began in the Live Sheet moved its "Imported budget" award to the end of the log), fixed in #579 before this was written up.
- Open for the owner: apply stage 1 (then fold the baseline files — see the harness README), and later stage 2 once phase 2b ships.

