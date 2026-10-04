# PACT — Task Board

> Written for agentic assistants (VS Code Copilot & Claude Code). With `AGENTS.md` committed, you don't
> repeat project context — **paste one task at a time**, review the diff, accept. Each task ends with a
> **Done when** check.
>
> **Rules for this file** (see `AGENTS.md`):
> 1. Holds only **open / planned** work. When a task is DONE, **move it into `CHANGELOG.md`** in the same change.
> 2. **Single writer.** Agents: *output* new items in this format for the human to fold in — don't append directly.
> 3. One task per branch. The open git branch is the "in flight" signal.
>
> **`REV-NN` items** come from the 2026-06-29 code review. Full evidence, code, and acceptance criteria
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this task board so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# 🟡 NEXT — medium-severity fixes + remaining build work

## feat/free-subclass-bare-pick — a free-subclass pick with nothing bought from it must not count (rules change) — TODO
Branch feat/free-subclass-bare-pick. **Effort:** medium · **Risk:** high — a rules change (engine AND Players Guide must both land, `DATA.version` bumped once) that can lower existing characters' prices, so the live blast radius must be measured first.

```text
Owner decision N3 (2026-10-04). Players Guide §13/§14: "Your first subclass in each class you can build from is free to open — but
opening it is all that's free. Pick it, then buy each piece you want." js/engine.js (~line 573): `free = freeSub[cls] || used[0]`, then
EVERY other subclass used in that class pays DATA.subUnlock (15 AP). So a free-subclass pick that has NOTHING bought from it still
holds the "free" slot: name Circle of the Moon for free, buy nothing from it, then buy abilities from Circle of the Land -> the
Land abilities are charged the 15 AP unlock, although it is the only subclass the player actually opened.

DO:
  1. Engine: honour freeSub[cls] only if the pick has at least one piece bought (an ability in subAbilities or a bundle in
     subSpellBundles); otherwise treat it as unset, so the first subclass actually used is the free one.
  2. CharGen (and anywhere else that writes it): stop recording a freeSub pick until a piece of that subclass is bought.
  3. Players Guide: say it in the subclass paragraphs (both live in the master and the served copy; run verify-guide.mjs before and
     after) and bump DATA.version once.
  4. MEASURE FIRST: query the live characters table for every character with a bare freeSub pick AND abilities in a different
     subclass of the same class — those prices fall by 15 AP; list them for the owner (event-sourced characters keep their frozen
     ledger, but their displayed total will move). Today's six Amble characters: Moss (Druid -> Circle of the Moon) and Skylar
     (Sorcerer -> Wild Magic Sorcery) each have one bare pick and NO other subclass in that class, so neither is affected.
```
**Done when:** new engine-parity fixtures cover a bare pick (ignored), a used pick (honoured) and the Moon/Land case; `expected-results.csv` updated in the same change; CharGen no longer writes a bare pick; the Guide states the rule and `verify-guide.mjs` passes; the live measurement has been shown to the owner.

## feat/dm-console-award-seal — the campaign-wide Award AP tile cannot lock history; the per-character form can — TODO
Branch feat/dm-console-award-seal. **Effort:** medium · **Risk:** medium — touches the DM's award flow (live AP) and calls `award_ap_and_seal()`; the idempotency and per-character failure handling are the fiddly parts.

```text
FOUND 2026-10-04 (owner, after awarding session 9): DM Console has TWO places to award AP. The campaign-wide tile "Award AP —
Tick whoever earned it, set an amount and a note, and award every ticked character" (tools/DM-Console.html ~line 644) has NO
"lock history" option; the per-character form ("Award AP, gold & bonus time") has an "and lock history" tick that is OFF by default.
The owner used the tile, so nothing was sealed (no sessionSeal event on any of the six Amble histories) even though a seal is what
freezes what a player bought up to that award. Sealing was deliberately never automatic (D-GH-2026-09-01-session-seal, option A1: an
award event in the log as well as the server award would double-count AP) — but the tick only exists on the form most DMs don't use.

DO (owner, 2026-10-04):
  1. Add an "and lock history" checkbox, TICKED BY DEFAULT, to the campaign-wide Award AP tile; each ticked character goes through
     award_ap_and_seal() (one atomic call per character, fresh idempotency key per click, as the per-character form does).
  2. Remove the AP amount (and its lock-history tick) from the per-character form where the tile now covers it. KEEP what the tile
     does not do: per-character gold and bonus time, and the standalone "Lock history" button.
  3. DECIDE with the owner: seal only characters that have FINISHED creation (locked)? Sealing one still in creation freezes a
     half-built character. Recommended: seal locked characters, award-only the rest, and say which in the result message.
  4. A per-character failure must not abort the others, and the result lists who was awarded and who was sealed.
```
**Done when:** `dm-console-ui-e2e.mjs` shows the tile's lock-history box present and ticked by default, an award through it producing a `sessionSeal` for each locked ticked character (and none for an unlocked one), the per-character AP field gone while gold/bonus-time and the Lock history button remain; a failure on one character does not stop the rest.

## feat/server-freeze-at-lock — server freezes history before the lock and priced patch events after a lock/award — TODO
Branch feat/server-freeze-at-lock. **Effort:** high · **Risk:** high — a new trigger rule on every campaign character save; a wrong rule refuses legitimate saves. Staged WITH `fix/chargen-post-lock-purchases` and AFTER the Amble repair (`docs/plans/2026-10-04-amble-lock-repair.md`). Spec: `docs/plans/2026-10-04-chargen-post-lock-purchases.md` §7.

```text
Owner decisions D2 + E1 (2026-10-04). Extend pact_enforce_locked_history()/pact_ap_ledger_protected() (sql/migrations/,
mirrored in sql/rls-policies.sql):
  D2  For a campaign character that has a creationLocked event, every event BEFORE the last creationLocked is frozen:
      no change, removal or reordering (events after it may be appended; the existing seal/award rules still apply).
  E1  Priced `cat='patch'` buys (stats, hdProf, languages, armour, weaponProf, vigor, traditions, ki, sorcery, attunement,
      innate, customProfs, freeSub) join the protected projection once the character is locked OR has an award/seal:
      content, stamped cost, position and existence frozen. No-AP slots (appearance, names, houseRules, misc) stay editable.
Evidence (Docker copy of the live rules): after an award a player can lower Hit Dice 5 -> 2, strip armour proficiency,
change a stamped patch cost 12 -> 0, or delete the Hit Dice patch event outright (all ALLOWED); removing a boon is refused.
STAGE per slot with fix/chargen-post-lock-purchases phases (hdProf + stats first). Add the cases to
testing/scripts/creation-lock-guard-test/guard-cases.sql. Apply to live only after the Amble repair, with the owner's approval.
```
**Done when:** the Docker harness shows each rule refusing the attack and allowing every legitimate save (a normal in-play purchase, a DM edit, an admin session, a solo character); the six Amble characters re-checked locked after applying; advisors/logs run; CHANGELOG + decision addendum written.

## fix/chargen-post-lock-purchases — CharGen rewrites creation history instead of appending an in-play purchase after the lock — TODO
Branch fix/chargen-post-lock-purchases. **Effort:** high · **Risk:** high — core CharGen edit path (~600 KB file), 19 patch slots, and a price-parity requirement with Live Sheet. Plan to review FIRST: `docs/plans/2026-10-04-chargen-post-lock-purchases.md`. Blocks `feat/roll-lock-then-spend`.

```text
OBSERVED (2026-10-04, real browser): in CharGen, Finish creating then raise Hit Dice 3 -> 4. replacePatchSlot() rewrites
the existing "Hit Dice & Proficiency" event IN PLACE (seq 10, still BEFORE the lock at seq 11, cost 5 -> 8): no new event,
no in-play price, no gold/downtime stamp, and creation history is rewritten. In place is right pre-lock (readable ledger) and
wrong after it. Live Sheet appends one fine-grained event per purchase (hd / abil / armour / ... from the engine's MUT table)
with cost and a frozen gp/days.

DO (owner decision B2, 2026-10-04): for a LOCKED character, route a patch-slot edit through a new _cgPostLockSlotEdit():
diff the slot against its folded value; each increase becomes the matching in-play event, appended after commitHistory()
(one undo step per purchase), priced as the compute() delta, legality-checked and gold/downtime-stamped like Live Sheet;
each DECREASE is refused ("nothing bought can be removed once creation is finished"); no-AP slots (appearance, names) stay
in place; species/origin class are refused. Pre-lock behaviour must stay byte-identical. Phase 1 = hdProf + stats +
the parity test; then the other priced slots; then hardening; then the roll Accept button. Answer the plan's three open
questions with the owner before writing code.
```
**Done when:** a differential test builds the same purchase through CharGen's new path and Live Sheet's buy() and asserts identical event cat/payload/cost/gp/days and byte-identical folded builds; a locked-character HD and ability raise in CharGen append in-play events after the lock with the creation event untouched; a decrease is refused; undo steps back one purchase at a time and stops at the lock; pre-lock tests stay green.

## feat/roll-lock-then-spend — random roll: cap at the creation limit, lock, then spend the rest in play — TODO
Branch feat/roll-lock-then-spend. **Effort:** high · **Risk:** high — `randomizeRoll()` is ~490 lines and its apply step is deliberately ordered (D-GH34), so a wrong change silently re-prices every rolled character. Follows `fix/chargen-creation-ceiling` (PR #561), which caps the roll at the DM's ceiling but does not lock.

```text
Owner decision B (2026-10-04): a roll on a character with a DM creation limit should be capped at that limit, THEN the
character is locked, THEN the rest of the spendable AP is rolled automatically as in-play purchases. #561 built only the
cap. WHY THE REST IS NOT TRIVIAL: randomizeRoll() applies its result as one burst through replaceWholeLogFromBuild()
and re-appends any carried lock AFTER the burst on purpose (a lock placed before it re-prices every burst event at
in-play rates — D-GH34), so a second randomizeRoll() pass after a lock re-creates the whole character and prices it all
as creation. Needed: a post-lock phase that appends purchases one at a time through the normal purchase path
(emit/MUT, in-play pricing, gold + downtime stamps if the campaign economy is on) using the same legality and
spend-shape machinery (tryAct, buckets). OWNER DECISION 2026-10-04 on (1): a rolled character CAN be re-rolled. The roll therefore stays unlocked and ends at the
limit (as #561 does); a persistent "Accept rolled character" button, visible after a roll and until it is pressed (or
the character is locked), does the finish: it locks the character and then spends the rest in play. That also settles
the undo question: the roll stays ONE undoable step, and Accept is the barrier. DECIDED later the
same day: (2) the in-play purchases made on Accept DO cost gold and downtime, like any in-play purchase (stamped per the
campaign economy); (3) undo after Accept steps back ONE PURCHASE AT A TIME (each in-play purchase is its own undo step) and
stops at the lock, which stays the wall — the owner said "maybe", so confirm when building, and note the interplay with
fix/no-purchase-refunds (undoing a post-lock purchase that has already been saved to the cloud). STILL OPEN: does the
button survive a reload (a flag kept with the autosave) and does cloud autosave keep running while a roll awaits
acceptance? (Recommended: yes to both.)
```
**Done when:** a roll on a limited, unlocked character stops at the limit and shows an Accept button; pressing it locks the character and spends the remainder after the lock at in-play prices, while re-rolling before that stays possible; `random-quality-ci` and `random-manual-e2e` stay green; new chargen-flows checks cover the cap, the lock position and the in-play remainder.

## fix/chargen-creation-ceiling — CharGen never refuses a purchase past the DM's creation limit — TODO
Branch fix/chargen-creation-ceiling. **Effort:** high · **Risk:** high — damage scale (CharGen's central edit path, ~600 KB file) and ambiguity (CharGen is a whole-build editor that reprices on every edit, so "refuse this purchase" has no single call site) drive it. Plan to review FIRST: `docs/plans/2026-10-04-chargen-creation-ceiling.md`.

```text
GAP. docs/plans/2026-08-30-creation-ceiling.md "Done when" #2 says a purchase past the ceiling is refused in
BOTH CharGen and Live Sheet. Only Live Sheet got it: tools/PACT-CharGen-Webtool.html imports and exposes
wouldExceedCeiling() but never calls it (0 call sites, 2026-10-04). CharGen only shows "Finish creating" with the
numbers in a tooltip. Evidence: Moss, Skylar, Fenwick and Archer — all CharGen characters — spent 101/98/97/79 AP
against real limits of 83/80/78/68, while Anders and Caspian (Live Sheet) kept their block. Missing limits made it
worse (Moss's was never stamped; Skylar's, Fenwick's and Archer's were deleted by the reload / stale-copy bugs, now
fixed), but even with a limit stamped CharGen would not have refused.

DO (owner decisions W1 + W2, 2026-10-04):
  W1  Refuse, in CharGen, any edit that INCREASES spend and ends past the ceiling (unlocked + limit stamped only),
      with the same message and both exits Live Sheet already shows. Edits that lower spend, locked characters,
      characters with no stamped limit, and loads/imports/handoffs are never blocked.
  W2  When an accepted edit lands the character exactly at its limit (0 left), prompt once: "Finish creating now?"
      (reusing cgFinishCreating's flow; "Not yet" keeps building). Re-arm only after spend drops below the limit again.
Follow the plan's design and answer its three open questions with the owner before writing code.
```
**Done when:** `chargen-flows-e2e.mjs` has new checks proving an over-limit edit is refused and reverted (state and form unchanged), an under-limit edit and a spend-lowering edit are accepted, a locked character and a no-limit character are unaffected, and the reach-the-limit prompt fires once; the Players Guide wording on the creation limit is checked and reconciled in the same change; no `DATA.version` bump unless pricing changes (it should not).

## fix/no-purchase-refunds — nothing bought can be un-bought for AP (engine rule) — TODO
Branch fix/no-purchase-refunds. **Effort:** high · **Risk:** high — damage scale (edits js/engine.js, changes
totals for existing characters) and damage likelihood (two known live characters already carry a refund) drive it.

```text
Owner rule (2026-10-04): you can't un-buy anything except drawbacks (buy-off).
  1. BEFORE the creation lock: dumping a score below 10 for AP stays exactly as the Players Guide has it. But
     lowering a score that was raised above 10 — or undoing any saved/ledgered ability purchase — must NOT
     return AP. A lowered score keeps the AP paid at its highest point; only the part below 10 pays out.
  2. AFTER the creation lock: nothing purchased can be removed or lowered — stats and every other purchase —
     except drawbacks (buy-off). A post-lock reduction prices at 0 refund (or is rejected — decide which,
     then say so in the Guide).
Fix in js/engine.js so every tool, import and DM edit is covered (don't patch the UIs only). Add the
matching append-only rule to the server guard (sql/migrations/2026-10-04-creation-lock-guard.sql follow-up).

Evidence (lock-check copies, 2026-10-04): Caspian seq 29 lowered STR 12->10 and WIS 16->14 for -11 AP;
Skylar seq 27 raised an ability +4 then lowered it -4 after the lock, then bought Proficiency +3 for 18.

Before changing anything: query the LIVE characters table for every character whose log already carries a
refund (don't reuse the 35-character snapshot in AGENTS.md — re-measure) and list them for the owner.
Needs: DATA.version bump, new engine-parity fixtures, update expected-results, and the Players Guide
(engine + guide both land, per AGENTS.md; run verify-guide.mjs before and after).

```
**Done when:** `engine-parity.html` reports 0 failed with new fixtures covering (a) a pre-lock ability
reduction giving no refund, (b) a below-10 dump still paying out, (c) a post-lock removal or reduction
refunding nothing; the Guide states the rule; `DATA.version` is bumped once; and the list of live
characters already carrying a refund has been shown to the owner.

## feat/ap-award-edit-transparency — player-facing display of AP award edits — TODO
```
D-GH-2026-09-08-ap-award-editing shipped the DM side (edit_ap_award() RPC, ap_award_edits audit table,
DM Console's "Edit AP Awards" grid). What's missing: a PLAYER-facing display of that edit trail. Live
Sheet has no existing "view your AP awards" panel at all to extend — the only prior use of
getAwardHistory() there is internal (migrating awards into itemized log entries on campaign→standalone
clone, not a visible history UI). Build one: somewhere reachable from the character sheet, show each
award (amount, note, date, DM) and, for any award that was edited, its edit trail (old→new amount/note,
reason, who, when) via the new getAwardEditHistory(awardId) helper in js/dm.js (already exported).
RLS already permits the read (ap_award_edits_select mirrors ap_awards_select) — this is UI-only, no
server-side change needed. Decide the display shape (inline under each award vs. a separate history
modal, matching DM Console's own .hist-modal pattern) before implementing.
```
**Done when:** a signed-in player viewing their own campaign character in Live Sheet can see their full
AP award history, and any award that has been edited shows its correction (old/new amount+note, the
DM's reason, who, when) — verified against a real edited award in the live Supabase data.

## REV-14b — split js/engine.js's compute() into named sub-pricers — TODO
Branch refactor/rev-14b-compute-subpricers. Second half of REV-14 (REV-14a — the DATA extraction — shipped
in PR #251); decompose compute()'s single ~370-line body (~lines 76–446) into named `_price*` helpers. Full
plan already drafted at docs/plans/2026-07-17-engine-breakup-rev14.md.
**Effort:** high · **Risk:** high — ambiguity is high (decomposing a stateful pricing algorithm while
guaranteeing byte-identical output is a genuine architectural call); damage scale is high (edits compute()
directly — the engine's single source of truth); damage likelihood is medium (the parity gate catches
numeric/ledger drift, but REV-01's known warning-text fixture-coverage gap means some W.push branches are
unverified) — worst-of lands at high, never eligible for /sweep-code-tasks.

```text
1. Pre-flight (no code change): produce a data-flow map of which compute() locals each commented section
   reads vs writes (total, L, W, mod, effScore, the add() closure, any first-occurrence/suppression state),
   and confirm the exact line span of the _raceTraitLocked creation-lock logic so extraction-by-comment-
   boundary can't split it.
2. Extract each commented section into a named _price* helper taking ONE SHARED MUTABLE CONTEXT
   ({total, L, W, mod, effScore, add, …}) and mutating it exactly as the inline code did — NOT return-and-
   merge (which forces hidden inter-section dependencies to be made explicit and is where silent drift
   creeps in). Preserve L (ledger) and W (warnings) push order exactly.
3. Extract one section per commit; run engine-parity after each so any regression is bisectable. compute()
   ends as setup + a fixed ordered sequence of _price* calls + return assembly, same signature/return shape.
4. Verify byte-identical output: hash the full compute() return (totals + ledger L + warnings W) for every
   fixture before vs after; list any W.push branch no fixture reaches. This is a BEHAVIOUR-PRESERVING engine
   change — do NOT bump DATA.version (output must be identical); just log in CHANGELOG.
```

**Done when:** compute() is a dispatcher over named `_price*` helpers (shared-context design), unchanged
signature/return shape; full-payload output identical across all fixtures; engine-parity still 20/0.

---

## Signed-out invite banner still can't distinguish a dead link from a live one — TODO
Branch `feat/invite-peek-signed-out-banner`. Remainder of the 2026-08-04 finding after
`feat/invite-peek-campaign-name` shipped (2026-08-10): `peek_player_invite(token)` now lets CharGen name
the campaign in its accept `confirm()` and catch a dead token before ever showing that prompt — but only
once the player is signed in. Signed OUT, a revoked/expired invite link still looks identical to a live
one, because `peek_player_invite` was deliberately scoped `authenticated`-only
(`D-GH-2026-08-10-invite-peek-auth-scope`) rather than anon-callable, to avoid an unrate-limited token-probe
surface. **Blocked on `feat/invite-rate-limiting`** landing first — that is what would make an
anon-callable lookup a deliberate, safe decision rather than reopening the exact hole this one avoided.
**Effort:** small (once unblocked) · **Risk:** medium — the auth-scope call was already made deliberately
in D-GH-2026-08-10-invite-peek-auth-scope; this task is "make it anon-callable now that rate limiting
exists," not a fresh design question. Not sweep-eligible — sequenced behind another task.

```text
1. Confirm feat/invite-rate-limiting has actually landed and covers RPC-level probing, not just invite
   generation/redemption, before starting.
2. Widen peek_player_invite's grant to anon (or add a second, anon-scoped variant if the rate-limit
   mechanism needs a distinct code path) — record the change as an amendment to
   D-GH-2026-08-10-invite-peek-auth-scope, not a fresh decision.
3. Make the signed-out banner in tools/PACT-CharGen-Webtool.html's tryRedeem() call it and distinguish a
   dead invite from a live one, mirroring the signed-in copy already shipped.
4. Add cloud-e2e coverage for a revoked token and a valid one, both signed out.
```

**Done when:** the signed-out banner distinguishes a dead invite from a live one, the widened auth scope
is recorded as an amendment to D-GH-2026-08-10-invite-peek-auth-scope, and `cloud-e2e` covers both token
states signed out.

## DM sets how many characters one player may have in a campaign — TODO
Branch `feat/campaign-character-limit`. Today the limit is hard-wired to exactly **one** character per
player per campaign, and it is not a soft app rule: it is the unique index
`idx_characters_owner_campaign_unique` on `characters(owner_id, campaign_id) where campaign_id is not
null` (`sql/schema.sql`, added by `sql/migrations/2026-07-13-campaign-bind-character.sql`). Requested by
the owner, who wanted two copies of a character in one campaign for a diagnosis and found the limit
was a database invariant rather than a setting.

**The trap that makes this bigger than "drop the index":** that index is not merely a limit, it is the
**TOCTOU race guard** for `bind_character_to_campaign` — the RPC's `EXISTS`-then-write check cannot
close the window on its own, which is exactly why the index exists (see its comment in `sql/schema.sql`
and in `sql/migrations/2026-07-13-campaign-join-race-friendly-error.sql`, which added the friendly error
for the duplicate-key it raises). Dropping it to allow N-per-player would silently reopen that race.
A partial or expression index cannot express "at most N rows per (owner, campaign)" either, so the
guard has to move — most likely into the RPC itself under a `select … for update` on the campaign row,
or a count check inside a serializable transaction. **Get this design reviewed before implementing**
(`/make-code-cold-plan-review`): it is a concurrency change to production data, and a wrong answer here
is a duplicate-join bug that only shows up under real simultaneous joins.

**Effort:** large · **Risk:** high — schema + RPC + RLS + UI; the failure mode is silent (a race that
only bites under concurrency), and it touches the one invariant that currently makes double-joins
impossible. **Not** sweep-eligible.

```text
1. Decide where the limit lives: `campaigns.rules.maxCharactersPerPlayer` (integer, default 1) is the
   natural home — it rides the existing rules JSON, so no new column and DM Console already has a rules
   panel and a save path.
2. Replace the unique index with a guard that still closes the race at N. Do NOT simply drop it. The
   count check has to be race-safe against two simultaneous redemptions of the same invite.
3. Teach bind_character_to_campaign and redeem_player_invite the limit: the current one-per-campaign
   EXISTS check becomes a count-against-limit check, and the friendly error message needs to state the
   actual limit ("Amble allows 2 characters per player") rather than today's fixed wording.
4. DM Console: a number input in the campaign rules panel, next to the starting tier. Default 1.
   Lowering it below what players already hold must NOT delete or unbind anything — existing rosters
   are grandfathered; the limit only gates new joins. Say so in the field's ⓘ.
5. CharGen's join path shows the campaign's limit when a join is refused for hitting it.
6. Migration under sql/migrations/, then run the Supabase advisor and skim get_logs (per-change
   checklist step 4). Rules-only change to the DB — no DATA.version bump.
7. cloud-e2e: cover limit=1 (today's behaviour, must not regress), limit=2 (second join succeeds), and
   the refusal at the limit. A concurrency check for the race guard if one can be written cheaply.
```

**Done when:** a DM can set the per-player character limit on a campaign, the default of 1 reproduces
today's behaviour exactly, joining past the limit fails with a message naming the limit, lowering the
limit never removes an existing character, the race guard is demonstrably still closed at the new N,
the advisor reports no new findings, and `cloud-e2e` covers limit=1, limit=2 and the refusal.

## Record which of D1/D2 governs a pre-lock level-up — the divergence itself is GONE — TODO
Branch `docs/prelock-pricing-rule`. **Re-measured 2026-08-19 on v0.356: the divergence does not
reproduce.** This was filed as a live bug needing an owner rules ruling *before any code*; the code
question has since answered itself, and what remains is a docs task.

The original report (2026-08-05) measured a fresh Live Sheet character under the 79 AP threshold whose
ledger read **34 against `compute()`'s 46** after one level-up, and **44 against 83** by HD 5. Re-run
through the real tool on v0.356, driving `buy()` directly:

| sequence | ledger | `compute()` | drift |
|---|---|---|---|
| Grit at HD 1, then level to 5 | 15 | 15 | **0** |
| level to 5 first, then Grit | 15 | 15 | **0** |

Zero drift in both orders. The Live Sheet still does **not** call `repriceDraft()` (checked), so this was
not fixed by adopting D2 — one of the pricing branches that landed after 5 Aug made the two rules stop
producing different numbers, rather than one of them winning. Which branch did it has not been traced.

**Effort:** low · **Risk:** low — no behaviour changes; it is a decision-record edit. Downgraded from
high, which was correct while a live 44-vs-83 divergence was believed to be sitting in the tool.

**Already done, so don't redo it:** step 5 of the original task (assert the case rather than remember it)
shipped on 2026-08-19 — `tool-pricing-ci.mjs` now drives a pre-lock character through level-ups in both
purchase orders and asserts `economy().spent === compute().total`. It was 141 → **143** checks. That gate
is what stops this silently regressing while the wording question waits.

```text
1. Decide, at leisure, whether D1 or D2 is the STATED rule for a pre-lock level-up. This is now a
   question of what the record should say, not of what the tool does - nothing is broken either way.
2. Amend D-GH-2026-08-05-pricing-model to narrow whichever one loses, so the next agent does not read
   the two as still conflicting. Include the 2026-08-19 re-measurement above, or the closed case will
   be re-reported as a bug by whoever reads the original table.
3. Optional, and worth it if anyone touches draft pricing again: trace WHICH branch closed the gap, so
   the record says why the rules stopped disagreeing instead of just noting that they did.
```

**Done when:** `D-GH-2026-08-05-pricing-model` states which rule governs a pre-lock level-up, and carries
the 2026-08-19 re-measurement showing the original divergence no longer reproduces.

## One-off reconciliation pass for characters built before the pricing fixes — TODO
Branch `fix/ledger-reconciliation-pass`. **Sequence LAST — after all four pricing branches have landed**
(see `decisions/2026/D-GH-2026-08-05-pricing-model.md`, D6, where the owner decided this on 2026-08-05).
Characters built before that work carry ledgers frozen from a contaminated quoting basis: Anders is 15
against `compute()`'s 33, and every Level Up or class unlock recorded an over- or under-charge. They are
grandfathered until this runs; do not bolt a partial migration onto any individual fix.
**Effort:** medium · **Risk:** high — ambiguity high (what "correct" means for a character whose purchases
were made at contexts that no longer reproduce is a genuine judgement call, not a lookup); damage scale
high (rewrites frozen ledgers, the app's own record of what a player paid); damage likelihood medium (the
corpus is small and known, and the invariant is checkable afterwards) — worst-of lands at high. Not
sweep-eligible.

```text
0. SCOPE HAS SHRUNK — re-measure before planning a big inventory. Verified 2026-08-05: no tool emits
   `campaignBound` or `creationLocked` (grep across tools/ and js/ outside the engine returns nothing),
   and a character saved before feat/creation-lock-wiring carries no `creationLockConfig` either — so
   `_autoArmed` is false and `isCreationDraft()` returns TRUE for every pre-existing character. They are
   all drafts. CharGen now reprices a draft on LOAD (_cgApplyEnvelope), so every one of them self-heals
   the moment it is opened in CharGen. What is left for this pass is therefore narrower than written
   below: characters that are only ever opened in the LIVE SHEET, which does not reprice at all pending
   the rules answer in fix/livesheet-draft-reconcile. Confirm this still holds before starting.
0b. Both pricing blockers have LANDED (fix/livesheet-context-pricing and fix/species-pack-not-charged, 2026-08-05),
   but one question they raised has not been answered: fix/livesheet-draft-reconcile above decides whether
   a pre-lock Live Sheet character reconciles at all. Settle that FIRST — it changes what "correct" means
   for exactly the characters this pass rewrites. Reconciling against a moving definition is how this began.
1. Inventory first, decide second. Replay every saved character (local + cloud) and produce a table of
   frozen-sum vs compute().total, per character, with the per-event deltas that explain the gap. Do not
   write anything on this pass — the owner needs the numbers before authorising any rewrite.
2. Expect at least three distinct causes and report them separately: species packs never charged; Level
   Up over-charged by the Vigor/Grit re-price; class unlock under-charged (it could go NEGATIVE, i.e. it
   paid AP out) — so some characters are over-budget under corrected pricing and some are under.
3. Decide the shape WITH the owner: a correcting event appended per character (auditable, keeps the
   append-only property, shows in the ledger as a visible adjustment), or a rewrite of the frozen costs
   (cleaner-looking, destroys the record of what was actually paid). Default to the appended event.
4. Characters that are over-budget after correction are a product question, not an implementation one —
   ask before trimming, refunding, or granting AP to cover the difference.
5. Gate: after the pass, a corrected character's frozen sum must equal compute().total where the rules
   say it should. Add that assertion to testing/scripts/tool-pricing-ci.mjs rather than checking by hand.
6. engine-parity must stay at 0 failed and DATA.version must not move — this rewrites data, not rules.
```
**Done when:** the inventory table exists and has been reviewed by the owner, the agreed correction has
been applied to every affected saved character, over-budget outcomes have an owner decision recorded, and
a gate asserts the invariant for corrected characters.

## CharGen quotes a locked character's context changes as a whole-build delta — TODO
Branch `fix/chargen-context-pricing`. D1 of `decisions/2026/D-GH-2026-08-05-pricing-model.md` — *a
purchase that changes pricing context is quoted from its own rules table, never by whole-build diff* —
was implemented for the Live Sheet's `priceOf()` only. CharGen's `replacePatchSlot()`
(`tools/PACT-CharGen-Webtool.html`) still does `compute(after).total − compute(before).total`.

**Effort:** medium · **Risk:** medium — ambiguity medium (D1 already fixes the rule and the Live Sheet's
`_CTX_PRICERS` table is the pattern to copy, but CharGen prices whole patch SLOTS rather than single
categories, so the mapping is not one-to-one); damage scale medium (one tool, but it writes frozen costs
into saved logs); damage likelihood low (`tool-pricing-ci.mjs` gates it and is dependency-free).

**Re-measured 2026-08-05 (after the Grit correction and the Vigor per-rank stamp): this is now the LAST
remaining disagreement between the two tools.** Nine pricing categories were compared on identical logs;
eight agree. The survivor:

| case | Live Sheet | CharGen |
|---|---:|---:|
| unlock Wizard owning 4 Wizard features | 7 | **−6** |
| unlock Wizard owning none (control) | 7 | 7 |

CharGen *pays the player 6 AP* to unlock a class they already have features in, because the whole-build
delta sweeps in the retroactive discount those features get once the class is unlocked. The fix has the
same shape as the two that landed: stamp each feature with whether its class was unlocked when it was
bought (as `_raceTraitLocked` does for species traits and `_vigorRankTier` now does for Vigor), so an
already-owned feature keeps the cross-class price it was actually bought at.

**Why it was survivable until now, and why it no longer is.** While a character is a draft,
`repriceDraft()` overwrites whatever `replacePatchSlot()` quoted, so the bad quote never reached the
ledger. Once the lock fires, re-pricing stops by design (D7) and the quote is what gets frozen.
Reproduced 2026-08-05: a locked character with species Dwarf and four Halfling traits, switching to
Halfling, is quoted **−4** — a refund — where the listed Halfling pack price is 7. The ledger keeps it.

```text
1. Read the Live Sheet's `_CTX_PRICERS` table first; it is the same rule already solved once, and the
   two tools must not disagree about what a context change costs.
2. The mismatch to design around: `_CTX_PRICERS` is keyed by event CATEGORY (abil, hd, unlockclass…),
   but `replacePatchSlot` writes a whole SLOT (IDENTITY carries originClass, originClass2, species,
   species2, size, lineage at once). Decide whether to price a slot field-by-field against its own
   table, or to split the context-bearing fields out of the slot. Say which and why — this is the part
   worth getting reviewed.
3. Only the pricing basis changes. Do NOT reintroduce filter-and-append: replace-in-place is what keeps
   the identity line in its own position in the ledger, and it is now also what keeps a locked
   character's event indices stable.
4. The draft path must stay unchanged — `repriceDraft()` still owns pre-lock pricing, and this quote
   only ever reaches a ledger once the lock has fired. Assert both halves.
5. Gate in `testing/scripts/tool-pricing-ci.mjs` alongside the existing "re-pricing stops dead once the
   lock has fired" block, which already builds a suitable locked fixture. The assertion is that a locked
   species change is quoted at the listed pack price, independent of what traits are already owned.
6. Prices move, so if `compute()` output changes at all, bump `DATA.version` and refresh
   `testing/expected/` in the same PR. If only CharGen's recorded costs change, it does NOT move.
```

**Done when:** a locked character's species/class change is quoted at its listed price regardless of what
is already owned, CharGen and the Live Sheet agree on that price, draft re-pricing is unaffected, a gate
asserts it, and engine-parity still reports 24/0.

## A DM-applied creation lock a player cannot undo (cloud campaign characters only) — TODO
Branch `feat/dm-creation-lock`. Owner, 2026-08-06 — *"ideally but not critical"*, and scoped 2026-08-06 to
**cloud characters that are in a campaign**. That scoping is the whole design, not a detail: a DM lock only
exists where there is a DM, a campaign only exists in the cloud, and a cloud character's row is
server-mediated — so this can be **genuinely enforced** rather than merely honoured by the client.
**Effort:** medium · **Risk:** high — ambiguity medium (the enforcement point is now clear, but the
detach/export edge cases below are genuine judgement calls); damage scale HIGH (it is an RLS/authorization
change on the `characters` table, the app's only real security boundary, and a wrong policy either locks
players out of their own characters or lets them through); damage likelihood medium (the advisor catches
policy shape, nothing catches intent) — worst-of lands at high. **NOT sweep-eligible.**

```text
0. READ FIRST: decisions/2026/D-GH-2026-08-06-creation-lock-survives-reload.md — its Outstanding section
   is this task. Note its trust-boundary worry is RESOLVED BY THE SCOPING, not by argument: the concern
   was "a player can edit their own local LOG", which does not apply to a character whose authoritative
   copy is a server row the player cannot write freely.
1. THE SERVER IS THE ENFORCEMENT POINT, not the LOG. Per AGENTS.md, RLS is the only real security
   boundary; a client-written flag is decoration. So the rule belongs in sql/rls-policies.sql:
   an UPDATE by the character's OWNER must not be able to clear a DM-applied lock while the row's
   campaign_id is set; the campaign's DM must be able to set and clear it.
2. Decide WHERE the lock lives on the row before writing any policy. Two shapes:
   a) a dedicated column (e.g. characters.dm_locked boolean) - trivially checkable in a policy, and
      independent of the LOG's contents. Preferred: an RLS policy cannot reasonably inspect a JSON LOG.
   b) inside the stats envelope - keeps everything in one place but makes the policy parse JSON to
      enforce it, which is fragile and slow. Expect to reject this; say why in the record.
3. The LOG event is then a MIRROR for display, not the source of truth. The tools still want a
   creationLocked event so pricing behaves (js/engine.js:749), but the engine must stay ignorant of
   auth - it compares values, it does not know who a DM is. Stamp provenance on the event for the UI's
   benefit and say plainly in the record that the event is not what enforces anything.
4. EDGE CASES that need an owner answer, not a guess:
   - a DM-locked character is REMOVED from the campaign (campaign_id cleared). Does the lock survive as
     an ordinary lock, or clear? Both are defensible; pick one and record it.
   - a player EXPORTS a DM-locked character to a file and re-imports it locally. The local copy has no
     server row, so nothing enforces it. Is that acceptable (it is now a different, standalone
     character) or must the export refuse/strip? Note the existing precedent:
     D-GH-2026-07-11-clone-campaign-character-standalone deliberately severs the campaign on clone.
   - a character with no campaign_id can never be DM-locked. Confirm the UI never offers it.
5. DM Console has NO lock UI at all today (grep: creationLocked appears 0 times in tools/DM-Console.html).
   That is the whole player-facing half of this task.
6. Back-compat: no existing character has the column/flag, so default it false and every existing
   character behaves exactly as it does now.
7. After any RLS/migration change, run the Supabase advisor (get_advisors) and skim get_logs BEFORE
   opening the PR - AGENTS.md step 4. This project has been bitten twice by grant/RLS drift.
8. Verification needs a signed-in campaign with a DM and a player account; it cannot be covered by the
   dependency-free gate. Say in the PR exactly what was exercised by hand.
```
**Done when:** a DM can lock a campaign character from DM Console, the owning player cannot clear that
lock through the app or by a direct row update (verified signed-in, both roles), a character with no
campaign cannot be DM-locked, the detach and export answers from step 4 are recorded in a
`D-GH-<date>-dm-creation-lock` record, the Supabase advisor is clean, and engine-parity is unchanged.

## Randomize (and shared links) build in canonical order, not purchase order — TODO
Branch `feat/randomize-emits-in-order`. Successor to the ordering half of `feat/creation-vs-awarded-ap`,
after the interactive and undo/redo paths were fixed (2026-08-06, PR #373 and the addendum in
`decisions/2026/D-GH-2026-08-06-creation-lock-survives-reload.md`).
**Effort:** medium · **Risk:** medium — ambiguity medium (mapping ~30 randomizer mutations to event shapes
is mechanical but each needs the right category and cost, and a wrong one mis-prices a character); damage
scale medium (one tool, revertable, but it rewrites how a whole character is constructed); damage
likelihood low (tool-pricing drives CharGen over CDP and the parity gate covers the engine) — medium.

```text
0. SCOPE — read this before assuming there is more to do than there is. Purchase order is ALREADY correct
   for the paths that matter, verified 2026-08-06:
     - interactive building: emit() appends in click order and does NOT tag noLock, so the creation lock
       lands exactly where cumulative spend crossed the threshold.
     - native save/load: _cgApplyEnvelope reinstates the saved LOG verbatim (D-GH40), so order survives.
     - undo/redo: restoreFrame() now reinstates the frame's LOG verbatim too.
   What is LEFT are the paths where the character arrives whole and no click order ever existed:
     randomize, the shared "#b=" link, and legacy flat-file import.
1. Only RANDOMIZE can be fixed honestly. A shared link and a legacy file carry a flat build with no
   sequence in it - there is nothing to recover, and inventing one would be a lie dressed as data. Decide
   explicitly whether those two keep today's behaviour (whole build creation-priced, lock appended after)
   and SAY SO in the record rather than leaving it implied.
2. randomizeRoll() (~tools/PACT-CharGen-Webtool.html:3407) already HAS a real sequence: it applies ~30
   mutator lambdas in a random order until the budget is spent. That order is as genuine as a generated
   character can have. The work is emitting one event per applied mutator instead of mutating a flat
   build and bursting at the end.
3. The actual cost is the mapping. Each lambda mutates the build directly - x.skills.push(s),
   x.stats[a]+=2, x.traditions.push(...) - and each needs the matching event shape and cost
   ({cat:'skill',payload:{v:s}}, {cat:'abil',payload:{ab:a,to:N}}, ...). Roughly 30 of them. Do not
   guess a category: check each against MUT in js/engine.js.
4. PERFORMANCE - measure before and after. emit() calls _cgRepriceDraft(), which replays the whole log;
   doing that per event across ~50 events is O(n^2). If it is slow, batch the repricing to the end rather
   than abandoning the ordering.
5. Gate it in testing/scripts/tool-pricing-ci.mjs: after a randomize that spends past the threshold, the
   creation lock must sit at the purchase where cumulative spend crossed it, not at the end. Prove the
   assertion fails against the current burst-based implementation before trusting it.
6. Display/state only - no compute() change expected, so do NOT bump DATA.version; confirm rather than
   assume, and keep engine-parity at its current count.
```
**Done when:** a randomized character over the creation threshold has its `creationLocked` event at the
purchase where spend crossed it rather than appended after everything, the shared-link and legacy-import
answers from step 1 are recorded, a gate asserts the randomize case, and engine-parity is unchanged.

## Duplicate non-stacking purchases are charged in full — TODO
Branch `fix/non-stacking-duplicate-charge`. `js/engine.js` (`compute()`'s feature pricing).
**Effort:** medium · **Risk:** medium — ambiguity is the driver (what "the same feature from two classes"
means needs defining before it can be priced, and the answer decides whether this is a refund or a
block); damage scale is low (it overcharges rather than undercharges, so nobody gained anything); damage
likelihood low (it needs a multi-class build at T4+ to reach at all).

Found 2026-08-18 while building `testing/scripts/sim-combat-abuse.mjs`, and **recorded nowhere until
now** — it lived only in a simulation's source comments, which is exactly the failure mode
`AGENTS.md`'s "log as you go" section exists to prevent.

A character who buys the *same non-stacking* feature from two different classes — Extra Attack being the
clearest case — is charged **in full both times** while receiving the benefit once. The optimiser hit
this hard enough that it had to be special-cased: it bought all six classes' Extra Attack for 102 AP on a
Rogue because raw summed Tier counted them as +24, and the sim now carries a `NON_STACKING` group list to
stop metric-gaming. That list is a **simulation-side workaround for an engine-side gap** — the engine
itself has no concept of a non-stacking group.

Not urgent: it cannot be reached below **tier 4**, and it costs the player rather than the table, so no
character is currently over-powered by it. It is a real overcharge on a legal build, though, and the
first person to notice it will be someone who paid twice.

```text
1. Define the rule FIRST: is a second copy of a non-stacking feature (a) barred outright, (b) free,
   or (c) charged at some reduced rate for the class-access it also confers? Ask the owner - the guide
   does not currently say, which is itself part of the finding.
2. The grouping belongs in DATA, not in compute() and not in a sim: a named non-stacking group per
   feature family, the same shape sim-combat-abuse.mjs's NON_STACKING already uses. Move that list into
   the dataset rather than maintaining a second copy.
3. compute() reads the group and applies the rule from step 1.
4. This CHANGES compute() output: update testing/expected/ in the same PR and bump DATA.version. Add a
   parity fixture buying the same non-stacking feature from two classes.
5. The Players Guide must land it too - a pricing rule that exists only in the engine is half-done
   (AGENTS.md, "A mechanics change isn't finished until the engine AND the guide land it").
```

**Done when:** the owner's rule is recorded; the non-stacking groups live in `DATA` with the simulation
reading them rather than holding its own copy; `compute()` applies the rule; a parity fixture pins a
duplicate purchase; the guide states the rule; `DATA.version` bumped and `testing/expected/` updated in
the same PR; engine-parity **0 failed**.

## Security audit: privilege boundaries + character/AP integrity against a malicious client — TODO
Branch `security/privilege-and-character-integrity`. Owner request, 2026-08-08. Assume the attacker has
the full frontend source, the Supabase URL, the publishable key, complete control of browser JS/
localStorage, and calls Supabase directly — every finding must be verified at the RLS/RPC boundary, not
just in the UI. **Explicitly excludes the invitation system** — `docs/TASK_BOARD_NOW.md`'s
`fix/harden-invitation-system` already owns that surface; do not touch `campaigns.dm_invite_code`,
`campaign_invites`, or `joinAsDm`/invite RPCs from this task.

**Not green-field — audit before assuming a gap exists.** Several of the asks below already have a
documented answer or a partial existing task; confirm the real state (read the actual RLS/RPC, per
AGENTS.md's "verify before writing an absence claim") before treating anything here as a fresh finding:
- `ap` is already documented as server-authoritative, DM-only, never overwritten by a local push
  (`AGENTS.md` File & data map) — audit whether that's actually *enforced* in `sql/rls-policies.sql`/RPCs
  or only true by convention.
- `characters_update`'s RLS already requires `owner_id = auth.uid()` in both `USING` and `WITH CHECK`
  (confirmed via `grep -n "owner_id" sql/rls-policies.sql`) — so raw ownership reassignment is already
  blocked, and `feat/character-ownership-claim-link` (shipped 2026-08-11, deliberately as a COPY into a
  new player-owned row rather than a transfer — see `D-GH-2026-08-11-character-claim-link-copy-not-
  transfer`) never needed to touch this boundary at all. `create_character_claim`/`redeem_character_claim`
  are new SECURITY DEFINER RPCs, though — confirm they're correctly gated (owner-of-source AND DM-of-
  campaign to create; single-use, idempotent-on-repeat to redeem) and that no other path in this audit
  reopens what that redesign closed.
- DM-applied creation-lock enforcement is already scoped as its own task, `feat/dm-creation-lock` (below)
  — its "server is the enforcement point, not the LOG" framing is exactly this task's model; don't
  re-derive the lock design here, cross-check against it instead.
- `feat/ap-model-reconcile` (shipped 2026-08-10, `D-GH-2026-08-10-ap-model-reconcile`) already covers the
  *display* divergence between `compute()` and the frozen ledger; this task covers whether a malicious
  client can *create* that divergence server-side — related, not overlapping. Sequence awareness, not a
  merge.

**1. Role boundaries (Owner / DM / Player) — audit and enforce server-side, don't introduce new roles.**
Do not add finer-grained roles unless the audit finds a concrete vulnerability that requires it. For each
of: DM transferring campaign ownership, DM accessing another campaign, player escalating to DM/Owner,
campaign-membership checks, DM-only operations — confirm the enforcement is a `SECURITY DEFINER` RPC or
RLS policy check, not a UI gate. Do not reduce any *legitimate* DM capability while doing this.

**2. Character/AP integrity — treat all browser state as untrusted.** Confirm server-side (RLS/RPC, not
just `engine.js` — the engine is called client-side and proves nothing about a raw API call):
- AP cannot be set/increased directly by a player write; AP changes require an authorised RPC.
- AP cannot go negative or be set arbitrarily via a crafted request.
- Frozen ledger / LOG history cannot be rewritten or deleted by an UPDATE once persisted.
- Purchase prices in a saved character cannot be client-supplied — pricing must be derivable/verifiable
  from `compute()`, not trusted as sent.
- A locked/finished character cannot be mutated via a direct API call once locked.
- A character cannot move between campaigns except through an authorised path.
- LOG events cannot be replayed/duplicated to double-grant purchases, rewards, or AP.
- Creation-lock rules cannot be bypassed by client-constructed state (cross-check `feat/dm-creation-lock`).
- Species/heritage/2nd-origin pricing cannot be gamed via a hand-crafted LOG.
- A malformed/forged LOG cannot produce a cloud character that persists.
Preserve the invariant **`sum(frozen event costs) == compute().total`** for valid finished characters —
audit whether the server can currently accept a saved character where these disagree, and if so, close
that specific gap (don't build new validation infrastructure beyond what closes the actual gap found).

**3. Campaign-rule integrity.** Audit whether a DM changing campaign rules (starting AP, pricing gates,
species/heritage rules, creation restrictions) can silently reprice or invalidate *existing* characters.
If retroactive application is intentional design, preserve it and say so; if not, confirm existing
character history is immune to a later rule edit.

**4. Cloud/client trust boundary — the general sweep.** For every operation currently protected only by
client-side logic (JS checks, UI hiding) touching AP, LOG/event data, character locking, campaign IDs,
ownership, DM permissions, or character↔campaign relationships: move real enforcement to
PostgreSQL/RLS/RPCs where it's missing. Where enforcement already exists, this step is "confirm it," not
"rebuild it."

**5. Adversarial tests.** Add/extend the automated security suite proving each of: no player privilege
escalation; no cross-campaign read/write; no direct AP manipulation; no forged purchase prices; no event
replay/duplication; frozen ledger immutable; locked characters immutable via API; campaign
reassignment properly authorised; DM cannot transfer ownership (unless a task explicitly adds that
capability); malformed event/state payloads rejected; `compute().total` == frozen-ledger total holds;
existing legitimate Owner/DM/Player workflows still pass. Run the full existing test/security suite
alongside the new tests — a regression here is exactly what this task must not cause.

**Effort:** high · **Risk:** high — ambiguity is high (this is an open-ended audit across RLS, RPCs, and
three tools with several sub-areas that may turn out to already be enforced correctly, so scope only
firms up once findings land); damage scale is high (touches the same core auth/character/campaign schema
and RLS surface as the invitation-system and ownership-transfer tasks); damage likelihood is medium (this
project's RLS/grant drift has bitten it twice before per D-GH15/D-GH12, and the class of bug this task
hunts for — client-trusted state — is exactly what those incidents were) — worst-of lands at high, **never
eligible for `/sweep-code-tasks`**. **Run `/make-code-cold-plan-review` before implementing any fix** this
audit turns up that touches RLS/RPCs/schema — it meets AGENTS.md's own trigger (security-critical,
multi-file, real design trade-offs, and a wrong approach costs more than one cycle to undo). The audit
*itself* (read-only investigation, no schema change) does not need the cold review; a fix does.

```text
1. Inventory every RPC and RLS policy touching characters/campaigns/ap_awards (sql/schema.sql,
   sql/rls-policies.sql, sql/migrations/) and classify each security-sensitive operation as
   "server-enforced" or "client-trusted-only" — this classification IS the audit's deliverable before any
   fix is written.
2. For each "client-trusted-only" finding, confirm it's real by attempting the bypass against a live
   Supabase call shape (not just reading code) — the same standard the invitation-system finding used
   ("verified by reading the actual schema/RLS on preview, not assumed").
3. Cross-check every finding against the three related tasks named above (fix/harden-invitation-system,
   feat/dm-creation-lock, feat/character-ownership-claim-link, feat/ap-model-reconcile) before writing a
   new fix — don't duplicate work already scoped elsewhere on the board.
4. For confirmed gaps, design the smallest RLS/RPC change that closes them — do not introduce new roles,
   new tables, or broader schema changes than the specific gap requires per the Acceptance criterion.
5. Write the adversarial test suite (Section 5) covering every confirmed gap plus the invariants listed
   even where no gap was found, so regressions are caught going forward.
6. After any RLS/RPC/migration change, run the Supabase advisor (`get_advisors`) and skim `get_logs`
   before opening the PR — this project has been bitten twice by grant/RLS drift (D-GH15, D-GH12).
7. Run the full existing test/security suite plus the new adversarial tests; fix regressions before
   declaring done.
8. Document every finding (confirmed gap, closed or deliberately deferred) and every intentional trust
   assumption in DECISIONS.md — including where the audit confirmed something was ALREADY correctly
   enforced, so a future session doesn't re-audit the same ground from scratch.
```

**Done when:** every item in Sections 1–4 has been checked against live RLS/RPC behaviour (not just code
review) and is either confirmed already-enforced or has a merged fix; the adversarial test list in
Section 5 passes; `sum(frozen event costs) == compute().total` holds for every path that can produce a
saved cloud character; the Supabase advisor reports no new findings; `testing/tests/engine-parity.html`
is unaffected (0 failed); all findings and trust assumptions are recorded in `DECISIONS.md`; no
invitation-system file (`campaigns.dm_invite_code`, `campaign_invites`, invite RPCs) was touched by this
task.

## Rate limiting / abuse protection for invite generation and redemption — TODO
Branch `feat/invite-rate-limiting`. Split off from `fix/harden-invitation-system` (TASK_BOARD_NOW.md) per
its cold-review Decision 4 — see `docs/plans/2026-08-08-harden-invitation-system.md`'s "Decisions" section
and its `z-cold-reviews/` files, where all 6 reviewers independently agreed rate limiting shouldn't gate
the core RLS/token fix: once DM invites move to 128-bit tokens, brute-forcing them directly becomes
infeasible, so the remaining value of rate limiting is abuse/DoS protection on invite generation and
redemption RPCs, not closing the core escalation path. No rate-limiting or abuse-tracking mechanism exists
anywhere in this project's schema or policy files today (confirmed by inspection while drafting the
invitation-system plan) — this is new ground, not an extension of an existing pattern.
**Effort:** medium · **Risk:** medium — ambiguity is medium (whether Supabase's platform-level rate
limiting already covers arbitrary RPC calls, as opposed to auth-specific endpoints, is genuinely
unconfirmed — the answer determines whether this needs new application-level infrastructure at all);
damage scale is low (additive — a new attempt-tracking mechanism, no changes to existing invite/campaign
logic); damage likelihood is low (a rate-limiting gap fails open to "no limit," the pre-existing status
quo, not a new failure mode) — not sweep-eligible given the unresolved platform-verification step, but
low risk once that's answered.

```text
1. FIRST: verify whether Supabase's project-level configuration already throttles arbitrary RPC/PostgREST
   calls (not just auth endpoints like signup/login/OTP) — this determines the rest of the task's scope.
   Check the live project's configuration/advisor output, don't assume from documentation alone.
2. If platform-level throttling is confirmed sufficient for the invite generation/redemption RPCs, this
   task is mostly a verification + documentation task: confirm coverage, record the finding in
   DECISIONS.md, done.
3. If not sufficient, design a minimal attempt-tracking mechanism (e.g. a small table keyed by caller +
   action + time window, checked at the top of the invite-generation and invite-redemption RPCs) —
   race-safe under concurrent requests, matching this codebase's existing atomic-claim discipline
   (UPDATE ... WHERE ... RETURNING) rather than a check-then-act pattern.
4. Cover both directions: generation (a DM spamming invite creation) and redemption (an attacker hammering
   the redemption RPC to brute-force or enumerate tokens) — these may need different thresholds.
5. Add adversarial test coverage: N rapid requests from one caller are throttled after the configured
   threshold; legitimate, well-spaced usage is never blocked.
6. Run the Supabase advisor (`get_advisors`) after any schema/policy change; this project has been bitten
   twice before by grant/RLS drift the advisor catches for free (D-GH15, D-GH12).
7. Record the platform-vs-application-level decision and its reasoning in DECISIONS.md.
```

**Done when:** either platform-level rate limiting is confirmed to cover invite generation/redemption RPCs
(documented, no new code needed), or a new race-safe attempt-tracking mechanism is in place and covered by
adversarial tests proving both that abuse is throttled and legitimate use isn't blocked; the decision is
recorded in `DECISIONS.md`; the Supabase advisor reports no new findings.

## Supabase Edge Function running the real engine.js for AP-budget validation — TODO
Branch `feat/ap-edge-function-validation`. Third of three ideas from the 2026-08-09/10 AP-integrity
external-review batch (`z-cold/` on the `zcold` branch — 7 independent AI reviews synthesized against the
actual code). The other two shipped as one change: `feat/campaign-ap-log-integrity` (a frozen-cost-sum
consistency trigger with a non-regression guard, plus a locked-history append-only protection trigger
scoped to the same boundary Live Sheet's own `undo()` already enforces — the last non-discretionary
`award` event). This is the deferred, lower-priority third leg.

**Why it's lower priority, not higher — confirmed by reading the code, not assumed.** Several of the
external reviews proposed this as the "real"/airtight server-side fix, on the theory that running the
actual `compute()` server-side re-derives correct prices. Checked directly in `js/engine.js`
(`_spendCost()`/`_economyFrom()`, ~lines 617-662): `compute()`/`economy()` only **sum** the frozen `cost`
field already sitting on each LOG event — they never re-derive what a purchase *should* cost from the
action itself. (Only `repriceDraft()` does real re-derivation, and it deliberately no-ops the instant a
log is locked — post-lock prices are supposed to diverge from current rules; that's grandfathering, not a
gap.) So an Edge Function that calls `compute()` server-side gives the exact same guarantee as the SQL
trigger already shipped in `feat/campaign-ap-log-integrity` — both just confirm the client's *declared*
numbers are internally consistent and within server-truth AP, neither proves any individual frozen cost is
*correct*. Its real value is DRY/maintainability (one canonical pricing implementation instead of a second,
hand-written SQL sum that could drift) and broader coverage (could also run `validate()`'s other checks,
not just the budget sum) — not a bigger security boundary than what's already shipped.
**Effort:** medium · **Risk:** low — ambiguity is low (the mechanism — bundle `engine.js` for Deno, call
`compute()`/`validate()` inside a Supabase Edge Function, gate the DB write on the result — is well
understood); damage scale is low (additive: a new Edge Function alongside the existing PostgREST save
path, not a replacement, unless a later decision retires direct client writes); damage likelihood is low
(explicitly deferred — "do only if the SQL-trigger approach proves insufficient in practice," not urgent).

```text
1. Re-confirm the premise before starting: re-check that feat/campaign-ap-log-integrity's two triggers are
   actually proving insufficient in practice (a real bypass observed, not a theoretical one) — this task
   exists to be revisited, not built reflexively once the SQL-trigger PR merges.
2. Bundle js/engine.js for Deno (an ESM re-export wrapper + esbuild bundle, or confirm engine.js is already
   Deno-importable as-is — it's pure JS with no browser globals per the 2026-08-10 review batch, but verify
   directly rather than trusting that claim).
3. New Edge Function (e.g. supabase/functions/validate-save/): fetches authoritative characters.ap and
   campaigns.rules server-side (never trusts client-supplied budget figures), runs the real compute()
   (and optionally validate()) against the client-submitted LOG, rejects the write if over budget or if a
   validate() check fails, otherwise performs the write itself.
4. Client integration: CharGen's and Live Sheet's cloud-save paths call the Edge Function instead of (or
   in addition to, during a transition) a raw PostgREST PATCH on characters.stats.
5. Decide whether to revoke direct client UPDATE on characters.stats once the Edge Function path is proven
   — that's the point where this stops being additive and starts being the primary security boundary.
   Record that decision explicitly; don't let it happen implicitly as a side effect of "the new path works."
6. Run the Supabase advisor (get_advisors) and skim get_logs after deploying the function, per the
   per-change checklist step 4.
```

**Done when:** the premise re-check in step 1 is recorded (with its evidence) before implementation
starts; the Edge Function runs the real, unmodified `engine.js`; a campaign-bound cloud save that would
exceed budget is rejected server-side even when submitted via a raw PATCH bypassing the client UI; the
decision on whether/when to revoke direct client writes is recorded in `DECISIONS.md`; the Supabase
advisor reports no new findings.

## Reconcile guide↔engine rules-version drift (the `documents-rules:` pointer) — MOSTLY DONE, one step left
Branch `claude/merge-pact-guide-version-132ppm`. Mechanism, tooling, and both projects' decision/docs
records shipped 2026-08-12 — see `D-GH-2026-08-12-guide-engine-version-pointer` (full record:
`decisions/2026/D-GH-2026-08-12-guide-engine-version-pointer.md`) and the cold-reviewed plan at
`docs/plans/2026-08-12-guide-engine-version-pointer.md` (4 reviewers, `z-cold/` on branch `zcold`).
Summary: mirrored branch settled as `main`; guide now declares two distinct markers (`content-version`
unchanged, new `documents-rules` — a *reconciliation* assertion, never auto-advanced by a vendor refresh);
`pact-guide`'s canonical file renamed off its version (`PACT-Players-Guide-v0.333.html` →
`PACT-Players-Guide.html`), with its three stale hardcoded references fixed; `pact-guide`'s new
`py/tools/stamp_guide_rules.mjs` (`stamp`/`--check`) implements the pointer; this repo's
`docs/VERSION-SYNC.md` documents the manual, three-way-verified transfer procedure for
`docs/PACT-Players-Guide.html`.

**Still open** (tracked in `pact-guide`'s own `TASK_BOARD.md`, not sweep-eligible from this repo — spans
a project not in this repo): the first real `documents-rules` stamp requires an actual guide-content
reconciliation pass against the live vendored snapshot, deliberately not done blind. Once that stamp
exists, transfer `pact-guide`'s canonical HTML into this repo's `docs/PACT-Players-Guide.html` per the
new `VERSION-SYNC.md` procedure — that transfer is also what corrects this repo's currently-stale
`v0.332` marker. **Effort:** low (the design/tooling work is done) · **Risk:** low — display-only, no
rules-logic or player-data impact.

**Done when:** `pact-guide`'s guide carries a real `documents-rules` marker (not blank), that transfer has
landed in `docs/PACT-Players-Guide.html`, and the three-way check (vendored snapshot ↔ `pact-guide`
canonical ↔ this repo's served copy) passes.

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

## refactor/subclass-purchase-unify — one purchase path for everything a subclass sells — TODO
Branch `refactor/subclass-purchase-unify`. Deferred half of AE3 (the pricing half shipped as `DATA.version`
v0.350). Two separate mechanisms currently sell subclass content, and both leak. (1) Spell bundles live in
`DATA.subclasses[…].spellBundle` with their own pricing branch in `compute()`, keyed in the LOG as
`b.subSpellBundles`; subclass abilities live in `DATA.subAbilMap`, keyed as `b.subAbilities`. (2) All **192**
subclass abilities are additionally mirrored into `DATA.features` (188 of them in `featureList`, so CharGen's
*feature* picker offers them alongside its *subclass* picker) — and the two routes have **separate dedup
domains**, so buying the same ability in both pickers charges twice with no warning, skips subclass-unlock
accounting, and bypasses the v0.347 class-access gate entirely.
**Effort:** high · **Risk:** high — ambiguity is high (the `subSpellBundles` LOG field needs either retention
or a migration, and Circle of the Land's four terrain variants are keyed `Class|Sub|Terrain` which doesn't fit
`subAbilMap`'s `Class|Sub|Name` shape); damage scale is high (engine data model + both tools' pickers + the
saved-character format); damage likelihood is medium (the parity/pricing gates catch price drift, but no gate
covers the pickers or LOG round-tripping) — worst-of lands at high, never eligible for `/sweep-code-tasks`.

```text
1. Pre-flight, no code change: confirm whether the DATA.features mirror of subclass abilities is load-bearing
   for anything (search both tools + any fixture for a `Cls: Name` feature key that is also a subclass
   ability). If nothing depends on it, removal is a deletion; if something does, that dependency is the task.
2. Decide the LOG question BEFORE touching data: keep `subSpellBundles` as a distinct field (bundles unify in
   pricing only) or migrate bundle entries into `subAbilities` (true unification, breaks existing saved
   characters). Record the choice as a `D-GH-<date>-subclass-purchase-unify` decision record — this is the
   call that makes the rest mechanical.
3. Resolve Circle of the Land: four terrain bundles, one engine `spellBundle`. Either give each terrain its
   own subAbilMap entry or keep the terrain as a purchase parameter. Whichever, the four must stay separately
   buyable and each must still cost the 15 AP Subclass Unlock beyond the first.
4. Fold bundles into the chosen path; delete the `spellBundle` pricing branch from `js/engine.js`.
5. Remove the 192 mirrored entries from `DATA.features`/`featureList`. Confirm CharGen's feature picker drops
   to real class features only, and that the double-charge is gone by construction.
6. Bump `DATA.version` only if prices move — this task should move none.
```
**Done when:** `testing/tests/engine-parity.html` reports 0 failed; `tool-pricing-ci` and all three guide
checkers stay green; buying the same subclass ability through both routes is impossible (or charges once);
a subclass purchase from a class that is neither origin nor unlocked raises the v0.347 gate warning by
whichever route it is bought; and CharGen + Live Sheet still round-trip a character containing a bundle.

---

## pact-guide master's cap-wording has diverged from the served copy — needs reconciliation — TODO
Branch `docs/guide-cap-wording-reconcile`. Discovered while updating drawback tables for
`feat/drawbacks-phobias-expansion`: the `pact-guide` project's `PACT-Players-Guide.html` (the canonical
master) still describes stat caps as advisory — *"The tool only warns, it does not block, if your current
[ability] is above [N] — DMs should enforce it as a hard requirement"* — on `Asthmatic`, `Frail`,
`Glass Frame`, `Lame`, `Missing Arm`, `Peg Leg`, and `Old Wound`. This repo's served copy
(`docs/PACT-Players-Guide.html`) already carries the hard-enforcement wording (*"You may only take this
drawback if your [ability] is currently [N] or below"*) that `b016331` introduced on 2026-08-18, and
additionally states the cap sentence at all on `Forgetful`, `Slow Study`, `Suggestible`, and
`Weak-Willed`, where the master omits it entirely. `feat/drawbacks-phobias-expansion` deliberately did
**not** resolve this — new rows were applied on top of each file's own existing prose, so the divergence
is neither widened nor silently overwritten.
**Effort:** low · **Risk:** medium — ambiguity is low (the served copy's wording is already the correct,
shipped-and-live posture per `b016331`'s owner ruling); damage scale is medium (a `pact-guide` transfer
done wrong has form — see the ⛔ box in `docs/VERSION-SYNC.md` and commit `e0c5e9f`'s image loss); damage
likelihood is low (the transfer procedure with its before/after `verify-guide.mjs` gate exists precisely
to catch this class of mistake, IF followed).

```text
Follow docs/VERSION-SYNC.md's transfer procedure exactly: run node testing/scripts/verify-guide.mjs
BEFORE touching anything. Apply the hard-enforcement wording to the pact-guide master's 7 named
drawbacks, and add the missing cap sentence to Forgetful/Slow Study/Suggestible/Weak-Willed there too —
do NOT copy the served file wholesale (it carries served-copy-only assets the master must not gain, per
the ⛔ box). Re-run verify-guide.mjs AFTER. Cross-check documents-rules version/branch/commit against
pact-guide's own py/vendor/engine/SYNCED_FROM.txt per VERSION-SYNC.md's three-way check. Worth first
checking D-GH-2026-08-19-drawback-statcap-enforcement (or its pact-guide-side equivalent, if one exists)
for whether the guide-side wording update was intentionally deferred or simply missed.
```

**Done when:** `node testing/scripts/verify-guide.mjs` passes both before and after the transfer; the
served copy and `pact-guide` master state the SAME enforcement posture for every capped drawback; the
transfer is verified against `pact-guide`'s own `py/vendor/engine/SYNCED_FROM.txt` per the three-way
check in `docs/VERSION-SYNC.md`.

---

## Mirrored subclass abilities double-charge when bought through both paths — TODO
Branch `fix/subclass-mirror-double-charge`. All 192 subclass abilities are mirrored into `DATA.features`,
so one logical ability can sit in **both** `b.subAbilities` and `b.features` in a single build — and
`compute()` prices it twice with no warning at all. Verified 2026-08-27 on `Barbarian › Path of the
Berserker: Frenzy` at 20 HD: subclass path alone 134 AP, feature path alone 134 AP, **both together 140 AP**
(one extra Frenzy charge), `warnings: []`. Pre-existing and independent of the HD gate, but
`D-GH-2026-08-27-feature-hd-gate` made it visible by having to gate both doors identically. Two depths:
**shallow** — dedupe by logical identity inside `compute()` (charge once, warn on the duplicate); **deep** —
`refactor/subclass-purchase-unify`, collapsing the two purchase paths into one, which the v0.353 §11
comment already names as the precondition for gating anything ("a rule that guards one of two doors teaches
players the wrong thing about the door it does not guard"). Recommend the deep fix if it is being scheduled
anyway, else the shallow one now — a silent double-charge on live characters is worse than a stale mirror.
**Effort:** medium (shallow) / high (deep) · **Risk:** medium — ambiguity is the driver (which collection
is canonical, and what a saved LOG holding both should migrate to); damage scale is medium (mis-pricing,
not data loss) and likelihood low (needs both collections populated for one ability).

```text
1. Reproduce first: build one character holding the same subclass ability via b.subAbilities AND via its
   mirrored "cls: name" key in b.features; confirm the AP delta equals one extra charge and no warning.
2. Decide canonical identity (subAbilMap key vs mirrored feature label) and record it in DECISIONS.md —
   this is the actual decision; the code is downstream of it.
3. Shallow: in compute(), collapse duplicates by that identity before pricing — charge once, push a
   warning naming the duplicate. Deep: unify the purchase paths so the second door stops existing, and
   state what happens to already-saved LOGs carrying the other shape.
4. Blocked purchases must dedupe the same way — a doubly-represented, HD-blocked ability must appear once
   under "Blocked purchases", not twice.
5. compute() output changes either way -> update testing/expected/ and bump DATA.version.
```

**Done when:** a build holding one ability through both collections prices it exactly once and says so;
a fixture covers the doubled input for both the priced and the HD-blocked case; engine-parity 0 failed.

---


## Racial traits still re-derive the Hit-Dice rule instead of calling `requiredHD()` — TODO
Branch `refactor/racial-required-hd`. `D-GH-2026-08-27-feature-hd-gate` introduced `requiredHD()` as THE
single definition of the Hit-Dice rule and its comment says "Do not re-inline it; import it" — but four
`(DATA.tierHD && DATA.tierHD[x.tier]) || 1` re-derivations remain for racial traits and were deliberately
left out of scope: `tools/PACT-Live-Char-Sheet.html`'s `racialWhy()`, and three sites in
`tools/PACT-CharGen-Webtool.html`. `DATA.racial` entries carry `tier` exactly as `DATA.features` do, plus
a `minHD` floor that maps cleanly onto `requiredHD()`'s existing `hd` floor — so folding them in is
mechanical. Until then the racial gate can drift from the feature gate the next time `tierHD` semantics
change, which is precisely the drift the export was created to end.
**Effort:** low · **Risk:** medium — damage scale is the driver: racial-trait pricing and its ⛔ messaging
are player-visible and `minHD` must keep behaving as a floor, not an override. Ambiguity is low (the
mapping is stated above) and likelihood low (parity + tool-pricing gates cover the pricing).

```text
1. Teach requiredHD() to read `minHD` as a floor alongside `hd`/`lvl`, or normalise the racial entries --
   whichever keeps DATA.racial untouched is preferable, since that file is the rules dataset.
2. Replace all four re-derivations with requiredHD() calls. Keep the racial messaging as it is: racial
   traits say "needs N Hit Dice (level N)" and carry their own reqRace/cross-species wording, which is
   NOT the same string as the class-ability gate.
3. compute()'s own racial minHD check should read the same helper, so engine and tools cannot disagree.
4. Verify no racial price or warning changes: this is a de-duplication, not a rules change, so do NOT
   bump DATA.version and expect engine-parity to stay green with no expected/ edits.
```

**Done when:** no tool re-derives `DATA.tierHD[...]` for racial traits; `requiredHD()` owns the rule for
both class abilities and racial traits; engine-parity 0 failed with no `testing/expected/` changes.

---

## Sync `docs/PACT-Players-Guide.html` for the ~280 abilities whose Hit-Dice level just moved — TODO
Branch `docs/guide-sync-authored-levels`. `D-GH-2026-08-27-feature-hd-gate` (round 5) authored a true 2024
level for ~550 class features/subclass abilities and split 4 mis-bundled ones, moving ~280 Hit-Dice
requirements off the tier-band floor onto their real value. The engine and `docs/PACT-Players-Guide.html`
now disagree wherever the Guide states or implies a level for one of those abilities — the exact class of
drift `AGENTS.md` names as "a rules change that ships in `js/engine.js` but not in the Players Guide is
half-done, not done." The master lives in the separate `pact-guide` project, reached via the home-server
MCP connector; `docs/PACT-Players-Guide.html` here is a served copy, not the source (see `AGENTS.md`'s
"served copy" ⛔ box before touching it directly — it carries assets the master must not gain).
**Effort:** high (≈280 numbers across two documents in two different projects) · **Risk:** medium — pure
documentation, no `compute()` change, so damage scale is low; ambiguity is the driver, since matching each
engine `lvl` to the Guide's prose/table entry for the same ability is a per-item lookup, not a bulk rule.

```text
1. Read docs/VERSION-SYNC.md's transfer procedure before touching either copy -- a plain cp in either
   direction destroys served-copy-only assets (10 embedded WebP images, theme blocks, chapter-banner CSS).
2. Work FROM the engine, not the Guide: for each of the ~280 authored lvl values, find that ability's Guide
   entry and state its level explicitly where the Guide currently only implies a tier.
3. The 4 split features (Tactical Mind/Shift/Master, Empowered Strikes/Self-Restoration, Perfect Focus/
   Body and Mind, Roving/Tireless) need a structural Guide edit, not just a number: the Guide likely still
   describes them as one bundled entry and now needs three (or two) with separate prices.
4. Update pact-guide's master file via the home-server connector; run node testing/scripts/verify-guide.mjs
   before AND after any transfer -- that script is the success condition, not a clean diff.
5. Record documents-rules per docs/VERSION-SYNC.md once reconciled, so the pointer states which engine
   version the prose was last checked against.
```

**Done when:** every authored `lvl` this round has a matching, explicit level in the Guide; the 4 split
features read as separate entries in the Guide, not one bundle; `verify-guide.mjs` passes.

---

## `docs/phb-rules-final.jsonl` bundles 4 separately-leveled 2024 features under one entry — TODO
Branch `docs/fix-phb-jsonl-bundled-entries`. The PHB text extraction that grounded round 5's level
authoring (`D-GH-2026-08-27-feature-hd-gate`) crammed together features WotC prints at different levels on
the class tables, because the source list was compiled by grouping similar-sounding names rather than by
level. PACT's own data has already been corrected (the features were split), but the *source* file still
carries the bundling, so the next person who re-derives from it inherits the same wrong premise and has to
re-discover the split by hand, as this round did.
The four: **Fighter** — `Tactical Mind` / `Shift` / `Master`, three distinct Battle-Master-flavoured
features on the core Fighter table at L2/L5/L9, sharing a name theme but gained years apart. **Monk** —
`Empowered Strikes` (unarmed strikes count as magical) / `Self-Restoration` (shed conditions), unrelated
features at L6/L10 that the bundling hid a 4-level gap between. **Monk** — `Perfect Focus` (a focus-recovery
feature, L15) / `Body and Mind` (the L20 capstone), two very different power tiers wrongly sharing a line.
**Ranger** — `Roving` (extra movement/climb-swim speed) / `Tireless` (temp HP + reduced exhaustion), L6/L9
improvements, again distinct features on the Ranger table.
**Effort:** low · **Risk:** low — a data-quality fix to a reference extraction, not to PACT's own rules
data; nothing in `compute()` reads this file.

```text
1. In docs/phb-rules-final.jsonl, split each of the 4 bundled Class Feature entries into its correctly-
   separated sub-entries (Fighter's one row becomes three; the other three each become two), preserving
   the source's own id/category/source/page/pdf_page/page_confidence shape for each new row.
2. Assign each split entry the correct page number if it differs from the original bundled row's page --
   check against the actual PHB page range for that class's feature table.
3. Cross-check the split against what PACT's engine-data.js already landed for these (see the round-5
   addendum in decisions/2026/D-GH-2026-08-27-feature-hd-gate.md) so the two agree.
```

**Done when:** the JSONL carries one entry per named 2024 feature, none of the 4 bundles remain, and a
fresh re-derivation from the file alone would reproduce the same split PACT's engine already has.

## `tool-pricing-ci.mjs` flakes on tab readiness — TODO
Branch `fix/tool-pricing-tab-flake`. The gate opens a fresh CDP tab per section — around ten across the
three tools — and the later ones intermittently blow the 30-second `document.readyState==='complete'`
poll, aborting the run with `CharGen never became ready for the version check` and skipping every
remaining assertion. The script's own header already documents this shape (it raised the budget from 10s
to 30s for the same reason in August) but treated it as a runner-speed problem rather than as tab
contention it creates itself.

**Measured 2026-08-31, not assumed:** on an unmodified tree it failed **3 of 3** runs; on the
`feat/random-char-generator-optimize` branch it failed 2 of 5. So it is pre-existing, unrelated to what
is being tested, and frequent enough that a red run currently carries almost no signal — which is the
real cost: a gate that fails at random trains people to re-run rather than read it.

**Effort:** small · **Risk:** low — test harness only, no app code, no rules logic; worst case the gate
stays as flaky as it already is.

```
Reuse ONE tab per tool (CharGen, Live Sheet, DM Console) across all of that tool's sections instead of
connect()-ing a new one per section, resetting state between sections with the tool's own resetBuild()
rather than a fresh page load. Keep the existing readiness poll and its 30s budget — the point is to stop
creating ten concurrent tabs, not to wait longer for them. Verify by running the gate 10 times in a row
on an unmodified tree.
```

**Two observations from 2026-09-02** (a long session that hit this gate repeatedly on unrelated work),
added because they narrow the fix — neither changes the diagnosis above, and the second may widen it:

*The tab-contention reading is confirmed, not just plausible.* During a failure window the page was
probed directly over CDP: `window.DATA`, `render`, `#apSourceLine` and `window._engineEcon` were **all
present**. CharGen does boot — it simply does not finish inside the poll's budget under load. So this is
contention, not a boot failure or a broken bridge, and nobody need go looking for one.

*A possible SECOND factor — accumulated temp directories — worth ruling in or out before fixing only
half the cause.* Every run spawns Chromium with a fresh `--user-data-dir` under `/tmp` and never removes
it, so they pile up across runs. On one tree the gate failed twice consecutively (166/1 each); after
deleting the accumulated `/tmp/pact-cdp-*` dirs it passed **three consecutive runs (189/0)**. **Treat
this as a hypothesis, not a result:** it is a single uncontrolled before/after, a stray git worktree was
removed in the same step, and load on the machine was not held constant. It is cheap to test properly —
run the gate 10× with cleanup between runs, then 10× without — and it matters because a cloud/web Claude
Code session runs with a **fixed writable-disk allowance** (a property of that execution environment, not
something this repo documents), so disk pressure is a credible way to slow browser startup there. On a
local machine with room to spare the effect may not exist at all, which is itself worth knowing: it would
explain why this gate misbehaves more in some environments than others. If it holds, reusing one tab per
tool is a *partial* fix and the script should also clean up its own `--user-data-dir` on exit.

**Done when:** `node testing/scripts/tool-pricing-ci.mjs` passes 10 consecutive runs on an unmodified
tree, and the tab count it opens is one per tool rather than one per section. If the temp-directory
hypothesis above is confirmed, the 10 runs must pass **without** cleanup between them.

## No end-to-end test covers a real seal rejection — the two halves are only tested apart — TODO
Branch `test/seal-roundtrip`. The session seal (PR #492, 2026-09-01) ships with both halves covered and
neither joined. `testing/sql/session-seal-test.sql` drives the real trigger against a real Postgres 16
(33/0); the browser gate drives the tools' client-side refusals. Nothing exercises the two **together**,
because the test stub server has no error-injection seam — so `isSealRejection()`, the `_sealBlocked`
set, and the manual-save "will sync when online" path are only ever fed a **hand-written** error object,
never a real PostgREST rejection produced by the live trigger.

That gap is exactly the shape of two of the fourteen findings `/code-review ultra` caught on this branch:
`isSealRejection()`'s OR-chain made its `hint`/`details` fallback dead code, and `_sealBlocked` was never
cleared by the in-app remedy. Both are client code reacting to a server error shape, and both survived
because no test ever produced that shape for real. A stub that can be told to answer one PUT with a
genuine `P0001` from `pact_enforce_locked_history()` would have failed on each.
**Effort:** small–medium · **Risk:** low — test harness only; no app code, no rules logic, no SQL change.
Ambiguity is the driving factor (where the seam belongs in the stub is a design call), and its worst case
is a test that has to be rewritten, not a defect shipped. Sweep-eligible.

```text
1. Give the test stub server an error-injection seam — the smallest thing that lets a test say "answer
   the next PATCH/PUT for character X with this status and this JSON body". Do NOT hand-roll the error
   body from memory: capture a REAL one first by driving the live trigger (the SQL harness already
   provokes it) and record the actual status, code, message, hint and details PostgREST returns.
2. Assert the whole round trip, not the classifier in isolation:
   - a save whose payload would alter the sealed prefix is refused, `isSealRejection()` returns true for
     the REAL body, and the character lands in `_sealBlocked`;
   - the refusal is NOT reported to the user as "will sync when online" — that was a real bug here;
   - `loadCharacter()` clears `_sealBlocked` for that id, and a subsequent legal save (appending AFTER
     the seal) succeeds.
3. Cover the `hint`/`details` fallback specifically. It is dead code today by construction; the test
   should fail if someone reverts the concatenation to an OR-chain.
4. Keep it in the dependency-free gate family — no live Supabase, no credentials. The point is that CI
   can exercise the shape, which is precisely what the SQL harness cannot do and the browser gate does
   not attempt.
```

**Done when:** one test drives a save refused by a REAL trigger-shaped PostgREST error through
`saveCharacter()` and asserts the refusal, the `_sealBlocked` entry, the absence of the "will sync when
online" message, and the clear-on-load; the recorded error body is checked in with a note saying it was
captured from the live trigger rather than written by hand; and the suite runs in CI without credentials.


## The SQL drift guard's migration list is hardcoded, so it falls behind by design — TODO
Branch `test/sql-drift-guard-auto-discovery`. `testing/sql/rls-baseline-test.sql` loads exactly four
migrations by name (the `2026-09-01`/`2026-09-02` set) and checks exactly five function names.
`sql/migrations/README.md` tells an author to apply a migration, fold it into `sql/rls-policies.sql` and
run both harnesses — implying CI catches a forgotten fold. It does not: add
`sql/migrations/2026-09-10-foo.sql` redefining `dm_edit_character_log`, fold it correctly, and the guard
still loads only the four 2026-09-0x files, so the "migration side" is a stale 2026-09-02 state and the
comparison is testing the wrong thing. Forget the fold entirely and it passes for the same reason. The
function-list half of this hole was closed on 2026-09-03 by a count assertion (a typo now fails); the
migration-list half needs a design decision, which is why it is filed rather than improvised.
**Effort:** medium · **Risk:** low — test harness only.

```text
1. Decide how migrations are discovered and ordered: every file in sql/migrations/ in filename order is
   the obvious rule, but some are one-way/destructive and some (session-seal vs session-seal-rollback)
   are deliberately paired. Write the rule down before coding it.
2. If some files must be excluded, make the exclusion list explicit and commented per entry — an
   unexplained skip is how this class of gap starts.
3. Derive the function list the same way: every function the loaded migrations define, rather than five
   hand-typed names.
4. Prove it: add a throwaway migration that diverges from the baseline and confirm the guard goes red
   WITHOUT anyone editing the test file.
```

**Done when:** adding a new migration to `sql/migrations/` requires no edit to
`testing/sql/rls-baseline-test.sql` for the drift guard to cover it, and step 4's proof is recorded.

## `2026-09-02-widen-protected-projection.sql` was edited after it was applied — TODO
Branch `docs/migration-record-dm-remove-boon`. The file's header records "BLAST RADIUS: zero. Measured
before applying" and was applied on 2026-09-02; commit `f2418a9` then rewrote the applied file's `in
(...)` list to add `dmRemoveBoon` and amended its scope comment. `sql/migrations/README.md`, added in the
same promotion, states: "A dated migration file is a historical record of one change. It is NOT the
current definition of anything." To its credit the header documents the extension honestly ("AS FIRST
SHIPPED AND THEN EXTENDED") — but it says the second change was "applied as `seal_protects_dm_removals`",
and **no migration file by that name exists** (the only other occurrence in the repo is an `\echo` label
in `testing/sql/session-seal-test.sql:343`). So replaying `sql/migrations/` in filename order produces in
one file a state production reached in two, and there is no dated record of when `dmRemoveBoon` was
actually added.
**Effort:** small · **Risk:** low — repo history hygiene, no behaviour change.

```text
1. Confirm with the author which change production actually received and when.
2. Restore 2026-09-02-widen-protected-projection.sql to what was applied on 2026-09-02, and add a
   separate dated file for the dmRemoveBoon extension named to match what it was applied as.
3. If restoring is judged worse than leaving it (a defensible call — the current file IS the end state),
   then at minimum fix the header so it does not name a file that does not exist, and say plainly that
   this file represents two applications.
```

**Done when:** `grep -rn seal_protects_dm_removals sql/` either resolves to a real migration file or the
reference is gone, and `sql/migrations/` replayed in filename order reproduces production's sequence.

## No `DECISIONS.md` record for either behaviour-changing SQL commit in PR #503 — TODO
Branch `docs/decisions-for-2026-09-02-sql-commits`. `cb323ca` changed the security posture of the
documented fresh-install path (which EXECUTE grants exist on trigger functions; that the baseline, not
the migrations, is the authority) and `f2418a9` changed what the server refuses. `AGENTS.md` per-change
checklist step 5 requires a `DECISIONS.md` entry when a change involves a non-obvious *why* —
"security model, trust boundary" is named explicitly — and step 7 says "A merged PR with missing docs is
treated as incomplete." The `DECISIONS.md` diff in that promotion contains only the
`D-GH-2026-08-25` warnings-race addendum. The reasoning currently lives only in
`sql/migrations/README.md` and a workflow comment, neither of which the decisions index points at.
**Effort:** small · **Risk:** none — docs only. **For the author of those commits**, not a third party:
writing it from the outside would be reconstruction, which is what this rule exists to prevent.

```text
1. Add decisions/2026/D-GH-2026-09-02-<slug>.md for the baseline fold: why the baseline and not the
   migrations is the authority, what the grant changes were, and why re-running rls-policies.sql is now
   safe when it was not.
2. Add one for the dmRemoveBoon projection widening — or fold it into the same record if they were one
   decision.
3. Add the one-line pointers to DECISIONS.md.
```

**Done when:** both commits are reachable from `DECISIONS.md`, and each record answers "would a future
agent wonder why this was done this way?"

## feat/dm-unlock-drawback — a DM can unlock a locked imposed drawback after a story beat — TODO
**STATUS 2026-10-04 — code, tests AND the production migration are DONE (see CHANGELOG and
`D-GH-2026-10-04-dm-unlock-drawback`):** `sql/migrations/2026-10-04-dm-unlock-drawback.sql` was applied to production
08:39 UTC and verified (guards, grants, hashes, advisors, logs). PR #557 is MERGED into `preview` (9d92088). **What remains:**
ship the client in the next `preview` → `main` promotion (a release decision), then graduate this entry. Safe order held: the server accepts the event before any client
can send it.
Branch feat/dm-unlock-drawback. Second of the permanent-wounds tasks. Wounds are imposed locked and
bought off only after a story beat (owner decision H1), but today there is no unlock path: `dmLocked` is
stamped on the immutable drawback event, and `dm_edit_character_log` only accepts buy(boon|drawback),
award and dmRemoveBoon.
**Effort:** medium · **Risk:** high — ambiguity medium; damage scale high (widens a SECURITY DEFINER
write path onto another account's `stats`, plus an SQL migration); likelihood medium. Big/risky → draft a
cold plan review (/make-code-cold-plan-review) BEFORE implementing.

```text
1. New event type (e.g. dmUnlockDrawback) keyed to the SPECIFIC open drawback purchase, using the same
   FIFO-by-purchase matching as D-GH-2026-08-06-buyoff-keyed-by-event (not name matching). Known quirk
   to design around (found in the fix/imposed-drawback-cap-bypass review): buy-off and Live Sheet's
   _openDrawbackEvent(v) match the OLDEST open purchase of a name, imposed or player-taken, so with a
   player-taken and an imposed drawback of the same name the lock/unlock check reads the wrong event.
   The unlock must target the specific imposed purchase, and the lock check should follow.
2. New sql/migrations file widening dm_edit_character_log's allowlist for it. The server keeps stamping
   seq/ts/dmEdit/dmId itself. It must move no AP so pact_ap_ledger_spend accepts it, exactly as
   dmRemoveBoon does. Reject an unlock for a drawback that isn't locked/imposed.
3. Live Sheet buyoffDrawback() honours the unlock (today it reads only src.dmLocked). Undo barrier applies
   as for every other DM edit.
4. DM Console: an "Unlock" control on a character holding a locked imposed drawback, behind the same
   archived-campaign write-block as the other DM tools.
5. After the migration run get_advisors and skim get_logs (AGENTS.md checklist step 4).
6. CHANGELOG; DECISIONS record D-GH-2026-<date>-dm-unlock-drawback; engine fixture if activeEvents changes.
```
**Done when:** a DM can unlock a locked imposed drawback from DM Console, the player can then buy it off
(and could not before), an unlock for an unlocked or player-taken drawback is rejected server-side,
`get_advisors` shows nothing new, and `testing/tests/engine-parity.html` reports 0 failed.

## feat/server-enforced-drawback-lock — enforce the DM drawback lock (and unlock) server-side — TODO
Branch feat/server-enforced-drawback-lock. Owner decision T1 (2026-10-04): the drawback lock (`dmLocked`)
and the DM unlock from feat/dm-unlock-drawback ship **client-honoured** and are documented as *advisory
against a hostile character owner*; real enforcement is this separate security task. Depends on
feat/dm-unlock-drawback. Independent of feat/permanent-wounds. Related: it is the concrete fix for one finding
the broader "Security audit: privilege boundaries + character/AP integrity against a malicious client" task
would classify as client-trusted-only — if that audit lands first, fold this into its findings list instead.
**Effort:** high · **Risk:** high — ambiguity high (a trust-model redesign, not a patch); damage scale high
(triggers on `characters.stats` that guard AP, plus RLS/grants); damage likelihood medium (this project's
RLS/grant drift has bitten it before per D-GH15/D-GH12). Worst-of is high — **never eligible for
`/sweep-code-tasks`**. **Run `/make-code-cold-plan-review` before implementing** — it meets AGENTS.md's trigger.

```text
Why this is not a small add-on (established in the cold plan review of feat/dm-unlock-drawback, judged by a
fresh no-history agent):
 (1) characters.stats is ONE JSON column on one row and its LOG is a JSON array inside it — there is no events
     table, so no UNIQUE constraint or per-event index is possible.
 (2) The character's OWNER can already write their own stats through ordinary RLS UPDATE (recorded in
     D-GH-2026-08-10-dm-edit-events), so they can forge a dmEdit:true event, a forged dmUnlockDrawback event,
     edit dmLocked on an existing event, or append a buyoff directly. A trigger that reads lock/unlock state out
     of that same LOG checks attacker-controlled data and adds no real security.
 (3) The engine matches a buyoff to the OLDEST still-open purchase of a drawback NAME (FIFO), so a trigger that
     looks at "the most recent buy of that name" disagrees with the engine.
 (4) pact_enforce_locked_history compares only the protected prefix up to the latest sessionSeal or
     non-discretionary award, so the existing triggers do not guard the log tail.

What a sound design needs:
 a. An unforgeable DM-authorship signal the owner cannot write: a DM-only column/table holding locks and
    unlocks, written only by the SECURITY DEFINER dm_edit_character_log, owner UPDATE revoked on it — or a
    database-held HMAC stamp on DM events.
 b. A BEFORE UPDATE trigger on characters.stats that diffs old vs new LOG over the WHOLE log and rejects:
    removal/alteration of DM-stamped events; any new dmEdit/dmUnlockDrawback event from a non-DM caller; any
    buyoff that FIFO-matches a locked, not-yet-unlocked purchase.
 c. Caller-role detection, so the trigger can tell the DM function path from a direct owner write.
 d. A SQL replay of the engine's by-name FIFO matching kept in lockstep with js/engine.js activeEvents(), with
    tests proving the two agree. This is deliberate, scoped rules-duplication — decide in the plan whether it is
    acceptable or whether the match should move to one shared definition.
 e. Migration discipline per sql/migrations/README.md: start from the LIVE definition (pg_get_functiondef),
    never a dated file; fold into sql/rls-policies.sql; update the hardcoded migration list in
    testing/sql/rls-baseline-test.sql.
 f. Blast radius against live characters — measure, do not quote (dated snapshot 2026-09-30: 42 characters, 11
    with a drawback purchase, 0 DM-imposed drawbacks) — and get_advisors + get_logs after applying.
 g. Once enforcement is real, change the DM Console / Live Sheet copy that says the lock is honoured by the
    player's app, and the guide wording that calls it advisory.
```
**Done when:** a character owner who hand-edits their own `stats` to forge an unlock, strip a lock, or append a
buyoff for a locked drawback is **rejected server-side** with a clear error; the legitimate DM impose → unlock →
player buy-off flow still works end to end; the SQL FIFO replay agrees with the engine on a fixture set that
includes a player-taken and an imposed drawback of the same name; `get_advisors` shows nothing new; and
`testing/tests/engine-parity.html` and the SQL drift guard are green.

## fix/random-fighter-int-priming — a Fighter on a caster theme is sometimes primed on INT — TODO
Branch fix/random-fighter-int-priming. CI check `random-quality-ci.mjs` ("a Fighter on a caster theme still primes a
Fighter stat, not INT") failed once on PR #569 (run 37203534734, 2026-10-04): 1 of 8 rolled Fighters had INT 20
against STR 18 / DEX 16 / CON 14. The same code passed 7 of 7 local runs and the same job's third CI run, so it
fails by chance. The gate itself is unseeded (it rolls `_qaRoll(theme, budget, "Fighter")` for the zealot and
battlecaster themes with no fixed seed), which is why it looks like a flake. But the assertion encodes a real rule
(a non-caster must not have a casting stat primed over its own; see the comment above the check about
`DATA.castAbility` having an entry for every class), so a failure is either a real intermittent priming bug in
CharGen's random roll or the gate being wrong about when INT may legitimately win. Find out which.
**Effort:** low–medium · **Risk:** low — ambiguity medium (cause unknown), damage scale low (random-roll output
only, no stored data), likelihood of harm low. Not blocking: the run passed on re-run.

```text
(a) Reproduce deterministically: add a seedable RNG (or a loop of a few hundred rolls) to
    testing/scripts/random-quality-ci.mjs for this one case, so a failure prints its seed and the full stat block.
    Do NOT just raise the retry count or loosen the assertion before knowing the cause.
(b) Find why a Fighter's INT can exceed STR/DEX/CON on a caster theme (the priming code path in the CharGen
    random roller, around _qaRoll). Likely candidates: a late INT bump from the caster theme's prerequisites,
    a rank/feature gate that wants INT, or stat priming happening before the class is applied.
(c) Fix the roller if INT really should not win; otherwise fix the assertion to say what is actually allowed.
    Either way keep the check, and make a failure reproducible from the printed seed.
(d) CHANGELOG; DECISIONS record only if the fix changes what a roll may produce. No DATA.version bump (random roll
    only, compute() output unchanged).
```
**Done when:** the Fighter-priming check passes on 200 consecutive seeded rolls, a failing seed (if one is found)
is recorded as a fixture, and `testing/scripts/random-quality-ci.mjs` reports 0 failed on CI across 3 runs.
