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

## feat/roll-lock-then-spend — random roll: cap at the creation limit, lock, then spend the rest in play — TODO
Branch feat/roll-lock-then-spend. **UNBLOCKED 2026-10-27:** its prerequisite `fix/chargen-post-lock-purchases` (phases 1, 2a, 2b-1, 2b-2 and the wallet warning) shipped 2026-10-04/05, so CharGen can already append in-play purchases after the lock. **PLAN WRITTEN AND COLD-REVIEWED 2026-10-27:** `docs/plans/2026-10-27-roll-lock-then-spend.md` (Design A: record the roll, cut it at the ceiling, store the remainder as steps, Accept locks and appends them; split into two PRs). Not built; waits for the owner's answers to its Q1–Q5. **Effort:** high · **Risk:** high — `randomizeRoll()` is ~490 lines and its apply step is deliberately ordered (D-GH34), so a wrong change silently re-prices every rolled character. Follows `fix/chargen-creation-ceiling` (PR #561), which caps the roll at the DM's ceiling but does not lock.

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

UPDATE 2026-10-27 — MEASURED on live (read-only; no code written; the design questions below need the owner):
Every live character whose stats were lowered from ABOVE 10 (a refund under this rule), found by folding each stats event of every
character that carries a negative "Ability scores" patch cost. A dump below 10 is NOT listed (Skylar's STR 10 -> 8 is legitimate).
  - Caspian (Amble, campaign, Live Sheet), seq 26: STR 12 -> 10, WIS 16 -> 14 — event cost -11 AP.
  - Skylar (Amble, campaign, CharGen), seq 23: DEX 12 -> 10 — event cost -4 AP (before any award).
  - Kaelen Dawnbreaker (solo), seq 15: CON 12 -> 10, DEX 14 -> 10, STR 14 -> 10 — event cost -22 AP.
  - Marius Stormholt (solo), seq 20: CHA 14 -> 10, INT 12 -> 10, WIS 12 -> 10 — event cost -7 AP.
  - Two DM copies repeat Caspian's and Skylar's events ("lock check" copies); Skylar's copy also holds the post-lock DEX 12 -> 10 (-4 AP, seq 27).
  Other negative patch events are not refunds: Martially Bound grants (-2 / -4) and Identity changes.
OPEN DESIGN QUESTIONS (answer before writing code; recommendations in brackets):
  Q1 compute() prices a final build, not a history, so "keep the AP paid at the highest point" needs memory. [Recommended: foldBuild records the
     highest score each stat has reached through a purchase or stats event (b.statsHigh); compute() prices a score of 10 or more at
     max(score, high) and a score below 10 at its own value (the dump keeps paying out). The alternative, leaving compute() alone and having each
     tool refuse a lowering, does not cover imports and DM edits, which the rule requires.]
  Q2 CharGen is a whole-build editor before the lock, and rewrites a stats event in place on purpose. What is "saved/ledgered" there? [Recommended: a
     score counts as bought once it is in a saved history the character has been locked, sealed or awarded past, or has appeared in a cloud save;
     lowering a score in a draft that was never saved stays free, because nothing was bought yet.]
  Q3 After the lock, a lowering "prices at 0 refund (or is rejected)". [Recommended: rejected, as CharGen's post-lock path and the server freeze
     already do; it needs no pricing exception and the Guide sentence is simply "nothing you have bought can be removed".]
  Q4 The four live characters above keep their frozen ledgers; only their displayed totals would move. Reconcile them (see "One-off
     reconciliation pass for characters built before the pricing fixes") or leave them? [Recommended: leave, list them to the owner as done here.]

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
**Sweep status (2026-10-20): not sweep-eligible — needs a reproduction first.** An unattended sweep re-ran the
gate 11 times and it passed 11 of 11, so a fix cannot be proven against a failure that will not show. A person
should capture a failing run (note the machine load), then the fix is checked against that.

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
is a test that has to be rewritten, not a defect shipped.
**Sweep status (2026-10-20): not sweep-eligible** (this line said "Sweep-eligible" until two sweeps in a row
parked it). It needs a real PostgREST `P0001` error body captured from the live trigger, and the stub seam is a
design call for a person. Re-tag it eligible only once that sample exists in the repo.

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
**Sweep status (2026-10-20): not sweep-eligible — needs an owner rule.** Step 1 below (which migrations load,
which are excluded as one-way or paired) is a decision, not a mechanical step. The numbers above date from
2026-09; re-read `testing/sql/rls-baseline-test.sql` as it stands before starting, because it may have changed since.

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

## Anders Pipeleaf holds one ability through both purchase doors — decide how a sealed double charge is handled — TODO
**Effort:** low · **Risk:** medium — ambiguity drives it (the DM and player must choose what, if anything, is refunded).

```text
FOUND 2026-10-05. Anders Pipeleaf (Amble, campaign-bound; also a DM copy and a lock-check copy) bought
`Rogue|Soulknife|Psionic Power / Psychic Blades` via the subclass picker (8 AP, seq 30, 2026-08-31) and again via the in-play
advancement picker as `Rogue: Psionic Power / Psychic Blades` (7 AP + 100 gp + 21 days, seq 40, 2026-09-17, warns []).
compute() charges both with no duplicate warning; replay gives 111 AP vs 104 without seq 40 (absolute totals unreliable: DM AP
pool and campaign rules omitted; the delta is valid). The 7-vs-8 gap is the Martially Bound discount, applied only in the features
loop. No other Amble or live character has this (checked 2026-10-05, matching by class + ability name).
This is a live case for the existing task "Mirrored subclass abilities double-charge when bought through both paths", whose
likelihood rating ("low") no longer holds. The history is sealed (seq 47); the DM's repair placed the creation lock before seq 40,
and `fix/ledger-reconciliation-pass` already notes his ledger is frozen against a contaminated basis.
DO: (1) get a DM decision on the 7 AP + 100 gp + 21 days (refund, or leave); (2) record it in DECISIONS.md; (3) confirm that
whichever fix lands for the double-charge task does not silently change his sealed ledger; (4) apply the decision as a DM edit,
not by hand-editing the log.
```
**Done when:** the DM's decision is recorded in `DECISIONS.md`; Anders's sheet (and both copies) agree with it; the double-charge
task's likelihood note is updated by the board's owner to point at this case.

## A subclass key repeated inside `b.subAbilities` alone is charged twice — TODO
Branch `fix/subclass-same-door-repeat`. **Effort:** low · **Risk:** medium — `compute()` output changes for any saved log holding the same subclass key twice, so measure first; damage scale is medium (a mis-priced total, not data loss), likelihood low.

```text
FOUND 2026-10-05 by /code-review during feat/subclass-double-purchase-guard. The FEATURE loop in js/engine.js guards its own repeats (`fcount` -> "already
bought — can only be taken once"); the SUBCLASS loop never did. A build whose `b.subAbilities` holds the same key twice (e.g. a duplicated buy event) is
charged twice with no warning. The cross-door duplicate guard does not cover this: it only fires when the same ability is ALSO in b.features.
DO:
  1. Reproduce: a build with subAbilities [S, S] and no feature copy prices 2x with warnings [].
  2. Add the same "already bought" guard to the subclass loop (count per key, skip and warn on the second) — reusing the wording the feature loop uses.
  3. MEASURE FIRST: query live characters for a repeated `subabil` key in their LOG. Any hit changes that character's recomputed total; frozen ledgers do not move.
  4. Fixture(s) for the repeat; bump DATA.version once; CHANGELOG; decision record.
```
**Done when:** a build holding one subclass key twice prices it once and warns once; engine-parity 0 failed with the new fixture; the live measurement is recorded in the PR.

## The pact-guide master has drifted far behind the served Players Guide, and two guide-vs-engine rows are an open question — TODO
**Effort:** medium–high (master reconciliation) / low (the two questions) · **Risk:** medium — a transfer from the master today would silently regress prices the served copy already has right; the owner decides which side is canonical row by row.

```text
HISTORY: the verifier blind spots (combined rows, ranges, the unreviewed ambiguous/unparsed/stepped rows) were fixed 2026-10-11, see D-GH-2026-10-11-verify-guide-blind-spots.
The one Ranger row was added to the master the same day. What that work FOUND:

A. The master and the served copy differ in table CONTENT in 54 places, not one. Run, from a checkout with both files:
     node testing/scripts/guide-table-diff.mjs <pact-guide>/PACT-Players-Guide.html
   Price rows where the SERVED copy matches the engine and the master does not (sample): Monk Martial Arts die and Unarmored Movement (master prints the old stepped prices,
   served prints 5 (5)/6 (6)/8 (9) and 3 (3)..6 (6)), Sorcerer Origin bonus spells and Warlock Patron bonus spells (master "8 (6)", served "varies 8-12" / "varies 8-16"),
   Druid Circle of the Sea/Stars spells, Barbarian "Brutal Strike, improved (L13)" (only in served), plus rewritten Premium / Sneak Attack / Rage / class-unlock prose
   ("7 x the classes you hold" in the master, "a flat 8 AP" in the served copy) and different Boon / Drawback tables. DO: for each difference decide which side the ENGINE
   supports, then edit the wrong side (the master through the home-server connector, the served copy locally) — never by copying one file over the other (docs/VERSION-SYNC.md).
   Re-run the diff until it is clean, then verify-guide.mjs.

B. Two guide rows the price checker cannot compare look like real disagreements with the engine (they are in guide-price-check.mjs's ALLOW list as OPEN QUESTIONs):
   - Battle Master > Improved Combat Superiority: the guide says "Included in Premium" and prints no price; the engine sells it separately at 14 (10) with no bar.
   - Gloom Stalker > Iron Mind: the guide says "Barred (-> saves)" with no price but status "Buy"; the engine sells it at 14 (11) with no bar. (Both guide copies agree with each other.)
   DO: owner decides for each whether the engine should bar/include it (data change, DATA.version bump, fixtures) or the guide should print the price. Then delete its ALLOW entry.
```
**Done when:** `guide-table-diff.mjs` reports a clean diff between the master and the served copy (or each remaining difference is a documented, deliberate presentation difference); the two open questions are decided and their ALLOW entries removed; `verify-guide.mjs` passes 11 of 11.

## fix/improved-combat-superiority-decision — the guide says it is included in Premium, the engine sells it for 14 (10) — TODO
**Effort:** low · **Risk:** low — ambiguity is the only driver: the owner decides which side is right. No live character is affected (measured 2026-10-11: 31 active characters, 0 own Improved Combat Superiority or any Combat Superiority; positive control Sneak Attack = 3).

```text
The guide's Battle Master row says "Improved Combat Superiority — Included in Premium" with no price, and its Combat Superiority row is annotated "dice, scaling, 3 maneuvers".
The engine sells it as its own purchase: `Fighter: Improved Combat Superiority` plus the `Fighter|Battle Master` copies in subAbilMap and subclasses, T5 Per-Rest 14 (10),
lvl 10, no bar. A player following the guide would expect it free and the engine would charge them. OWNER DECIDES (put it as a lettered choice):
  Y1  Make the engine match the guide: add bar:true to all three data copies (as `Fighter: Additional Fighting Style` already has), bump DATA.version once, add fixtures proving
      it cannot be bought through either purchase door, mutation-check them. Guide unchanged. (Agent recommendation, moderate confidence: the guide's annotation reads as deliberate.)
  Y2  Make the guide match the engine: print T5 Per-Rest 14 (10) and status Buy in BOTH guide copies (master through the home-server connector, served copy locally).
      No engine change, no version bump.
Afterwards delete this row's OPEN QUESTION entry from the ALLOW list in testing/scripts/guide-price-check.mjs (key `unparsed-price|Fighter|Battle Master|Improved Combat Superiority`).
If the Gloom Stalker Iron Mind task below also picks the engine side, do both in ONE branch/PR (one DATA.version bump).
When either of these two tasks lands, trim part B of "The pact-guide master has drifted far behind the served Players Guide…" accordingly.
```
**Done when:** the owner's choice is recorded in a decision record; the engine and both guide copies agree; `verify-guide.mjs` passes 11 of 11 with that ALLOW entry gone; `engine-parity` 0 failed if the engine changed.

## fix/gloom-stalker-iron-mind-decision — the guide row for Iron Mind contradicts itself and the engine sells it for 14 (11) — TODO
**Effort:** low · **Risk:** low — ambiguity is the only driver: the owner decides which side is right. No live character is affected (measured 2026-10-11: 0 of 31 active characters own Iron Mind; positive control Sneak Attack = 3).

```text
The guide's Ranger > Gloom Stalker row for Iron Mind reads tier "Barred (→ saves)", price "none", status "Buy" (identical in both guide copies). The engine sells
`Ranger|Gloom Stalker|Iron Mind` and `Ranger: Iron Mind` at T4 Passive 14 (11) with no bar. Wisdom save proficiency is what the saves ladder already sells. OWNER DECIDES (lettered):
  Z1  Bar it in the engine: bar:true on the features entry, the subAbilMap copy and the subclasses copy, DATA.version bump, fixtures proving it cannot be bought through either
      door; and fix the guide status cell to "Barred → saves" in BOTH guide copies. (Agent recommendation: two of the three cells already say barred, so "Buy" looks like the typo.)
  Z2  Keep it purchasable: print 14 (11) and drop the Barred wording in BOTH guide copies. No engine change, no version bump.
Afterwards delete this row's OPEN QUESTION entry from the ALLOW list in testing/scripts/guide-price-check.mjs (key `unparsed-price|Ranger|Gloom Stalker|Iron Mind`).
If the Improved Combat Superiority task above also picks the engine side, do both in ONE branch/PR (one DATA.version bump).
When either of these two tasks lands, trim part B of "The pact-guide master has drifted far behind the served Players Guide…" accordingly.
```
**Done when:** the owner's choice is recorded in a decision record; the engine and both guide copies agree; `verify-guide.mjs` passes 11 of 11 with that ALLOW entry gone; `engine-parity` 0 failed if the engine changed.

## check/server-freeze-stage2-after-apply — run the round-trip audit stage 2's apply skipped — TODO
**Effort:** low · **Risk:** low — read-only check; the only action it could lead to is the one-statement rollback.
**Owner step needed:** the audit needs an export of the live characters, which a Claude session cannot save. Not sweep-eligible until then.

```text
Server freeze stage 2 was applied to the live database on 2026-10-11 (migration `server_freeze_stage2`). Two of the three checks the apply
skipped were run on 2026-10-22 and are written up in `decisions/2026/D-GH-2026-10-05-server-freeze-stage1.md` (Stage 2, "Post-apply check"):
the security advisor shows nothing about the freeze functions, and the logs show 62 refusals since the apply (a few repeating patterns,
tapering to zero; consistent with stale copies of a tool, not proven; nothing suggests a wrongly refused save). What is left:
`roundtrip-audit.mjs --stage2 --campaign-all` against a full export of the live characters. DO: have the owner export the live characters
to a local file outside the repo, run the audit on it, then delete the file. If the audit shows a current tool's save would be refused,
apply `sql/migrations/2026-10-11-server-freeze-stage2-rollback.sql` and open a task for the cause.
```
**Done when:** the round-trip audit is run, or the owner has chosen to skip it, and that result or choice is recorded in `decisions/2026/D-GH-2026-10-05-server-freeze-stage1.md`.

## Lineage 2nd-level spells cost the 3rd-level rate — the guide's rule and the prices disagree — TODO
**Effort:** low · **Risk:** medium — a rules/price decision for the owner (ambiguity drove it); the edit itself is small and no live character owns one of these spells.

```text
OWNER CHOICE F3 (2026-10-11): leave for now. Players Guide §10 says 1/long-rest lineage spells cost "1st 6, 2nd 9, 3rd 12", but
the five 2nd-level lineage spells — Darkness (Drow and Infernal), Misty Step, Pass without Trace, Hold Person, Ray of Enfeeblement —
cost 12 in DATA.lineageSpells (js/engine-data.js). The 12 is left over from the pre-v0.373 workaround that stored them as "level 3"
to reach a 5 Hit Dice gate; #610 (D-GH-2026-10-11-lineage-spell-gates) fixed the level and gate and deliberately left prices alone.

Owner decides one of:
  A. Price them at 9, as the guide's rule says. Rules change: edit the five entries' AP, bump DATA.version once (+ the three
     fallback literals per docs/VERSION-SYNC.md), update the guide rows in the served copy AND the pact-guide master (run
     verify-guide.mjs before and after; guide-table-diff.mjs must not gain differences), update lineage-spell-gates-ci.mjs's
     price assertion ('4,6,12' -> '4,6,9'). MEASURE FIRST: live characters owning any of the five (0 on 2026-10-11).
  B. Keep 12 and reword the guide's rule so it says the lineage's last spell costs 12 (guide-only, no DATA.version bump).
```
**Done when:** the guide's stated rule and the five prices agree; `verify-guide.mjs` passes; `lineage-spell-gates-ci.mjs` passes; for A, the live owner count is recorded in the PR.

## feat/names-before-spending — AP can't be spent until languages and spells are chosen — TODO
Branch feat/names-before-spending. **Effort:** high · **Risk:** high — damage scale drives it: every Amble character (10 of 10, checked live 2026-10-12) owns at least one unnamed language slot, so a naive gate would block all of them from spending the moment it ships.

```text
Owner request (2026-10-12): a character can't spend AP until its languages and spells are chosen. Today a player can buy
language slots and spell slots and never name them (names live in the separate ✎ Name spells & languages dialog, a `names`
LOG event; compute() prices only counts), so the sheet carries blank slots indefinitely.

DO:
1. Engine (js/engine.js): one helper, e.g. unnamedChoices(build) -> [{kind:'language'|'cantrip'|'known'|'arcanum'|'dabbler'|
   'innate'|'grant'|'fightingStyle'|'metamagic'|'maneuver', slot, label}], counting each owned slot whose name is blank. It must
   mirror exactly the slots each tool's names dialog renders (openNames() in CharGen and Live Sheet) — read those first, and
   move the slot enumeration into the engine so the dialog and the gate cannot disagree. Wire it into purchaseLegality() (or
   a sibling the buy paths already call) so a purchase is refused with a reason that names the first missing choice and
   points at ✎ Name spells & languages.
2. Scope (recommended default, confirm with owner): the gate applies FROM THE CREATION LOCK ON (Live Sheet buy(), CharGen
   post-lock purchases), and "Finish creating" itself requires every slot named. During creation the player buys slots and
   names them at the end, so blocking mid-build purchases would make creation unusable. Buying the slot itself (a language,
   a spell rank) stays allowed — only the NEXT purchase after it waits for the name. DM awards are never blocked.
3. Existing characters: measure the live blast radius first (fold + compute every character; count unnamed slots per
   character, per campaign) and propose a rollout to the owner — e.g. a per-campaign DM switch (rules.requireNames, off by
   default) so a DM turns it on after the table has named everything, rather than a global rule.
4. Players Guide: add the rule where languages/spells are bought (served copy AND pact-guide master, per AGENTS.md). Bump
   DATA.version only if compute() output changes (it should not — this is legality, not price).

Related: feat/campaign-language-list (#632) gives campaigns their own language list; names chosen under this gate should
come from it.
```
**Done when:** with the gate on, a locked character with an unnamed language or spell slot cannot buy anything in either tool and is told which choice is missing; naming it in ✎ Name spells & languages lets the purchase through; Finish creating refuses while a slot is blank; DM awards are unaffected; a new e2e covers both tools; `engine-parity.html` 0 failed.

---


## feat/house-rules-dm-event-provenance — a player can carry forged DM house-rules events into a campaign (R2-6) — TODO
Branch feat/house-rules-dm-event-provenance. **Effort:** medium · **Risk:** high — an AP-moving server rule on every campaign join, engine and server must agree.

```text
Carried from the graduated feat/campaign-house-rules entry (all of PRs 2–6 shipped in v1.684; the server migration was applied
2026-10-20 — decisions/2026/D-GH-2026-10-13-campaign-house-rules.md, "Residual risk" and the 2026-10-20 addenda). The one open
item, pinned as a KNOWN GAP in testing/scripts/creation-lock-guard-test/run-house-rules.sh (round-2 review R2-6): a player can
stamp DM-family events as the DM of their own campaign Y (dm_bind_npc, then dm_unbind_character), or on a solo character before
joining, and bring them into campaign X. Concrete case: while solo, forge a dmEdit dmHouseRules pin {Fake: 1000} stamped with
campaign X's id plus a {Fake, -1000} drawback, then join X — the pin is X's override, so the server grants 1000. A campaignId
filter alone does not stop it (the forger used X's id). Options from PR #654's body: record RPC-issued amounts in a server-side
table the ledger reads, or a join-time check that every DM-family event stamped with X's id was written by a DM of X (dmId in
campaign_dms for X). Measure live first (DM-family events whose dmId is not a DM of the stamped campaign).
```
**Done when:** the R2-6 case in run-house-rules.sh is refused (moved from KNOWN GAP to refused), honest joins and DM paths still
pass, engine and server agree on the AP left, and the owner has applied the migration with advisors clean.

## feat/dm-house-rules-editor — revisit #638's H2 decisions now that DMs can set house rules — TODO
Branch fix/player-free-ap-h2-revisit. **Effort:** low · **Risk:** low — owner decisions, then small tool changes.

```text
The editor half of this task is done by feat/campaign-house-rules (campaign-wide rules, PR4) and its per-character overrides
(PR5, which superseded PR #642 — see decisions/2026/D-GH-2026-10-12-dm-house-rules-editor.md, addendum). What is left is the
owner review of the #638 H2 decisions recorded in decisions/2026/D-GH-2026-10-12-player-free-ap.md: solo self-awards are not
noLock; solo characters lose DM Calls after their own lock; starting gold is refused both ways after the lock. Confirm or
reverse each, then make the matching tool change.
```
**Done when:** the owner has confirmed or reversed each of the three #638 H2 decisions and any reversal is implemented with a test.

## fix/chargen-join-generation-guard — CharGen's join-campaign flow can bind the wrong character if the player switches mid-join — TODO
Branch fix/chargen-join-generation-guard. **Effort:** low · **Risk:** medium — damage likelihood is low (narrow race), but the damage is a character attached to the wrong campaign.

```text
Found 2026-10-12 by the re-review of #643. CharGen's join flow (~CG 1100-1126: save → bindCharacterToCampaign → refreshServerAp →
_cgResolveDmApStatus without opts.gen) has no generation guard across its awaits. If the player loads a different character
while those awaits run, the join's final resolve writes the joined campaign onto the newly loaded character (and, since #643,
also clears that character's pending binding adopt). Capture window._cgBindGen (or the character id) at the start of the join
and drop the post-await writes when it has moved, like _cgAdoptEnvelopeBinding does. Check invite (~1408) and claim (~1483) the same way.
```
**Done when:** an e2e that switches character during a stubbed slow join shows the newly loaded character unbound and the joined character bound; `engine-parity-ci` 0 failed.

## feat/dm-grant-purchase — DM Console "grant a spell / skill" (any purchase, free to the player) — TODO
Branch feat/dm-grant-purchase. **Effort:** medium · **Risk:** medium — ambiguity is low now feat/dm-ap-discount exists (D-GH-2026-10-13-dm-ap-discount; its RPC already accepts a discount whose target is in the same call); damage scale is a priced write to a live character.

```text
Owner request 2026-10-13 (a wizard learns a spell in the story, without paying AP): the DM can give a character a spell
or a skill for free. Today only boons can be granted (DM Console dmEditBody(), ~line 1909; handler ~line 3084).

DO: a "DM edit — grant a purchase" control (spell known at a level, skill, and anything else the owner wants on the list)
that writes the buy event plus a 100% dmDiscount on it in ONE dm_edit_character_log call. Work out the price by running
compute() on the build before and after the purchase — never a table lookup, because origin-class discounts and the
price ladders make the true cost depend on what the character already owns. Extend the server allowlist for exactly the
buy categories offered, and validate there. Consider moving the existing boon grant onto the same path, so its AP is tied
to the boon instead of being a free-floating award.
```
**Done when:** an e2e grants a spell and a skill and the player's AP left is unchanged, and the ledger shows them as DM-granted; undoing/removing the grant removes the discount with it; get_advisors clean after the migration.

## feat/wizard-scribe — the Players Guide's "scribe a found spell" rule exists in the tools — TODO
Branch feat/wizard-scribe. **Effort:** medium · **Risk:** medium — owner decision C (2026-10-13) makes the reduction the DM's call, so there is no fixed rules number; still needs the engine and the Players Guide to agree. Depends on feat/dm-ap-discount.

```text
The Players Guide ("Learning new spells") promises the wizard a second path: when the DM supplies a scroll, a captured
spellbook or a teacher, the wizard copies a Wizard-list spell for gold + downtime + a REDUCED AP cost. No tool implements it.

OWNER DECISION C (2026-10-13): the size of the reduction is up to the DM and must be flexible — no fixed rate.

DO:
  1. Build it on feat/dm-ap-discount: a "Scribe a spell" action in the DM Console writes the spell purchase plus a dmDiscount
     whose size the DM enters (AP or %, any amount up to the full price), plus whatever gold/downtime the DM sets, labelled as
     scribed with the source (scroll / spellbook / teacher) in the note. Wizard list only; refuse other casters.
  2. Players Guide: replace "reduced AP cost" with wording that the DM sets the reduction (and the gold and downtime), in the
     master and the served copy; run testing/scripts/verify-guide.mjs before and after. Bump DATA.version ONLY if compute()
     output changes — a DM-set discount alone should not.
```
**Done when:** fixtures cover a scribed spell with a DM-set discount and a non-wizard refused; the guide wording matches and verify-guide.mjs passes; an e2e scribes a spell from the DM Console with two different discounts.

## fix/chargen-drawback-cost-zero — CharGen stores drawbacks taken during creation at cost 0, so the server under-counts their AP — TODO
Branch fix/chargen-drawback-cost-zero. **Effort:** medium · **Risk:** high — touches the stored cost of existing live characters' drawbacks (damage scale) and needs a backfill decision (ambiguity).

```text
Found 2026-10-13 while planning campaign-wide house rules (owner decision Y1: separate task). CharGen's pre-lock checklist prices a
purchase as compute(cand).total − compute(cur).total; drawbacks are income and never move `total`, so a drawback taken in CharGen
is stamped cost 0 (node check: delta 0, while priceOf(…,'drawback',{v:'Peg Leg'}) = −4). The browser grant comes from compute()
(names × current value) so the player sees the AP, but the server's pact_ap_ledger_spend counts −cost = 0 — the server is stricter
than the browser and can refuse a later save the client allowed. DO: (1) owner-approved live count of open drawback buys with
cost 0 vs −value, per campaign; (2) stamp CharGen drawback events at −effective value (use engine priceOf, which after the
campaign-house-rules engine PR reads the effective value); (3) decide with the owner whether to backfill existing cost-0 events
(a DM-run correction RPC or a one-off migration) — measure first.
```
**Done when:** a new CharGen drawback is stored at −its value and the server ledger matches the browser in an e2e; the live count and the backfill decision are recorded; `engine-parity-ci` 0 failed.

## feat/feature-effect-text — class features, subclass abilities and racial traits get real ⓘ effect text — TODO
Branch feat/feature-effect-text. **Effort:** high · **Risk:** medium — ~600 short rules summaries must agree with the Players Guide (ambiguity drives it); display-only, so no pricing can break.

```text
#653 (2026-10-13) gave every effect on the Live Sheet's Character panel and 📋 Sheet an ⓘ, from one lookup: _lsFx() in
tools/PACT-Live-Char-Sheet.html. Boons, arts, masteries, drawbacks, maneuvers and metamagic have effect text in DATA, but the
364 class features (DATA.features), 192 subclass abilities (DATA.subAbilMap) and most of the 38 racial traits (DATA.racial —
only 4 are covered by the display-only DATA.racialFx) have none, so their ⓘ falls back to "See the Players Handbook, p.N"
(FEAT_PG) or is absent.

DO:
  1. Add a display-only effect map (same shape and status as racialFx/masteryFx: never read by compute(), so NO DATA.version
     bump — log it in CHANGELOG.md as a docs change). Decide with the owner whether it lives in js/engine-data.js or a separate
     display-data file; it is ~600 entries.
  2. Write each entry as a one- or two-sentence summary of what the ability does in play, taken from the Players Guide's own
     wording (the guide master lives in pact-guide — see AGENTS.md "A mechanics change isn't finished…" and VERSION-SYNC.md).
     Where the guide and the PHB differ, the guide wins; where the guide is silent, flag it rather than inventing rules text.
  3. Point _lsFx() at the new map, keeping the PHB-page fallback for anything still unwritten.
  4. Consider batching by class (one PR per class or two) so each is reviewable.
```
**Done when:** every DATA.features / DATA.subAbilMap / DATA.racial key has effect text (or an explicit, listed "guide silent" gap); _lsFx() returns it; a check script fails on any key with neither text nor a listed gap; `engine-parity-ci` 0 failed (output unchanged).

## feat/house-rules-draft-reprice — a DM raises a held drawback's price while a character is still in creation — TODO
Branch feat/house-rules-draft-reprice. **Effort:** low–medium · **Risk:** medium — moves AP on characters still being built (ambiguity: owner decision still open).

```text
Depends on feat/campaign-house-rules (integration branch; not yet in preview). Owner deferred this decision (AC) on 2026-10-13.
When a DM raises a campaign drawback's price (S2 review), characters still in creation (no creationLocked) that hold it can't
be ticked: the server only moves AP on finished characters, and repriceDraft() never re-stamps drawback costs. As built, the
draft's browser shows the NEW value while the server credits the OLD one, so the player sees AP they can't spend and a
purchase using it is refused on save (replay example: Bo 15 vs 13). A price DROP is fine.
Options put to the owner: AC1 pin drafts at the old value like unticked holders (DM applies the new price after Finish
creating) — recommended; AC2 let the RPC reprice drafts too (loosens "AP only moves on finished characters"); AC3 leave as is.
DO: get the owner's choice, then implement in DM Console's S2 review (and the RPC if AC2), with replay + e2e coverage.
```
**Done when:** the owner has chosen; a draft holding a repriced drawback shows the same AP in the browser and on the server; replay harness covers it.

## feat/house-rules-ban-removal — a DM banning an item can opt in to removing it from owners, with refund — TODO
Branch feat/house-rules-ban-removal. **Effort:** medium · **Risk:** medium — moves AP on live characters (damage scale), but only when the DM opts in.

```text
Depends on feat/campaign-house-rules (integration branch; not yet in preview). Owner decision AD1, 2026-10-13.
Today a campaign ban (rules.bannedBoons / bannedDrawbacks, saved by DM Console's Save rules) only stops new purchases; owners
keep the item. AD1: when the DM saves a ban, offer the same opt-in checkbox as T2 — "Also remove from characters who own it
(refund)", default OFF. If ticked: run houseRulesImpact over the roster and show the review (each owner, item, refund for a
paid boon / grant taken back for a drawback, AP left after; V1: going below 0 is allowed and shown), then apply in ONE
dm_apply_house_rules_change call (refundBoon / removeDrawback actions), plus dmRemoveBoon via dm_edit_character_log for a
DM-granted boon only when it is the oldest copy (as T2 does). Drafts are listed but not touched. Unticked = today's behaviour.
Reuse the T2 dialog from PR4 (#658). Refunds return AP only, not gold/downtime — say so in the dialog.
```
**Done when:** ticking the box on a ban removes the item from every finished owner with the right refund/grant-back, browser and server AP agree (replay harness), unticked bans behave as today; e2e covers both; `engine-parity-ci` 0 failed.


## chore/character-images-orphan-sweep — remove pictures left behind by deleted characters — TODO
Branch chore/character-images-orphan-sweep. **Effort:** low–medium · **Risk:** low–medium — deletes user files (service role), but only ones no policy can reach.

```text
Since feat/character-images (D-GH-2026-10-15-character-images) was applied (2026-10-19): pictures of a character deleted offline (the
tombstone replay in js/sync.js doesn't remove them) or deleted by a campaign DM stay in the private character-images bucket.
They are unreachable through the API (no row, or a recreated row with a newer created_at), cost ≤4 MB each, and block that
slot for a recreated row with the same uuid. Build a sweep that lists objects whose `<uuid>` has no characters row, or whose
created_at is older than the row's created_at, and deletes them with the service role through the Storage API (SQL cannot
delete storage objects) — e.g. a documented dashboard/CLI procedure or a scheduled job; never ship the service key to the
browser. Report counts before deleting; dry-run first.
ALSO (carried from the graduated db/character-images-apply, 2026-10-19): the migration is applied and its policies were
spot-checked as real users in SQL, but the browser-level REST checks 2–5 in decisions/2026/D-GH-2026-10-15-character-images.md
(owner Replace = upsert, a > 2 MB and an SVG upload refused by the Storage API, fellow player reads) were NOT run with a real
JWT — the owner runs them once with a real account and records the result in the decision record.
```
**Done when:** a dry run lists the orphans with the rule above, a real run removes exactly those, and the procedure is documented.

## feat/chargen-shared-sheet-body — CharGen's Sheet tab on the shared Character-panel layout — TODO
Branch feat/chargen-shared-sheet-body. **Effort:** medium · **Risk:** low–medium — display only, but it moves a renderer across tools.

```text
Owner decision AR1 (2026-10-15, review of #672). Since feat/livesheet-sheet-layout the Live Sheet's 📋 Sheet renders the
Character panel's own body (_lsCharBody in render(), plus _lsTableExtras) — see D-GH-2026-10-15-livesheet-sheet-layout.
CharGen's Sheet tab still uses its own renderCharSheet(b,r,ctx), the last copy of the old fillable layout. DO: move the
body renderer somewhere both tools load (e.g. js/ui-helpers.js, or a new shared classic script — it needs esc, the colour
map _CSABCOL, skillMods/saveMods/grantedSpells from the engine bridge, _lsFx/_fxBtn for ⓘ, and the description block),
call it from CharGen's Sheet tab, and delete CharGen's renderCharSheet(). Keep CharGen's tool-specific bits as opts (no
rename button, CharGen's AP line, no playerSheet editing unless CharGen gains it). Keep the device-local "at the table"
fields and the AP ledger. Every player value escaped; check phone width.
```
**Done when:** CharGen's Sheet tab and the Live Sheet's 📋 Sheet render through one shared function (no renderCharSheet left in either tool); an e2e asserts both tools show the same section outline for the same character; ledger-xss / esc-gap-verify / tool-pricing-ci updated and green; `engine-parity-ci` 0 failed.


## feat/chargen-names-arcanum-rows — CharGen's ✎ Name spells & languages dialog has no Mystic Arcanum rows — TODO
Branch feat/chargen-names-arcanum-rows. **Effort:** medium · **Risk:** medium — a UI change in the largest tool file (~600 KB); ambiguity is low (Live Sheet already does this), damage scale is limited to what CharGen's names dialog saves.

```text
Found 2026-10-15 during refactor/names-slot-helper (PR 1 of docs/plans/2026-10-15-names-before-spending.md). Live Sheet's
openNames() renders Mystic Arcanum rows (keys tr::<ti>::<di>::a::<ai>::<aj>, spell levels 6-9, Warlock spells, one datalist per
level). CharGen's openNames() (tools/PACT-CharGen-Webtool.html) has no Arcanum rows: it only carries arcanumNames through on
save, so a CharGen player cannot name an Arcanum slot at all.

Why it matters: the names-before-spending gate counts languages and spells (owner decision M1, 2026-10-15), which includes
Arcanum. Until CharGen can name Arcanum, the gate has to skip that kind in CharGen (the engine helper takes a list of kinds),
which is a standing exception.

DO: add the Arcanum rows to CharGen's openNames() and make saveNames() write them into the `names` event the same way the Live
Sheet does (payload tr[].an), reusing the Live Sheet's row and datalist shape. Then delete the CharGen skip from the gate so
both tools pass the full kind list. Do not change what a `names` event means or costs.
```
**Done when:** a CharGen character with a Warlock Mystic Arcanum slot can name it in ✎ Name spells & languages, the name survives Save and reload and shows in Live Sheet's dialog; the gate's CharGen kind list includes Arcanum; `engine-parity.html` 0 failed; the CharGen e2e for the names dialog covers an Arcanum slot.


## feat/chargen-merge-not-rewrite — CharGen's remaining whole-log rebuild paths merge into the existing history instead of rewriting it (creation-lock "Part 1b") — TODO
Branch `feat/chargen-merge-not-rewrite`. **Effort:** high · **Risk:** high — damage scale (CharGen's central load/edit path in a ~600 KB file; a wrong merge silently drops or duplicates history on a live character) and ambiguity (it overlaps `fix/chargen-post-lock-purchases` above, and how much of "Part 1b" that task already covers has not been checked).
```
What is left of the old "Creation-lock integrity" task (its repair, server guard and stale-copy fix all shipped 2026-10-04 — see CHANGELOG, and
decisions/2026/D-GH-2026-10-01-creation-lock-integrity.md): CharGen still has paths that rebuild the whole LOG from the form and replace the loaded
one, which is how locks, awards, seals and purchase lines were lost. As of origin/preview 2026-10-20, replaceWholeLogFromBuild() is still called from
applyBuild() (~line 5191), ~line 6256 and the initial LOG bootstrap (~line 7624) in tools/PACT-CharGen-Webtool.html (line numbers drift — grep).
Named in the original plan (docs/plans/2026-10-01-creation-lock-integrity.md, "M1 merge identity keys"): the random roll, `#b=` share links, and
legacy / untagged imports.
DO, in this order — this is big and risky, so do NOT start by editing:
  1. Read-only audit: for each caller of replaceWholeLogFromBuild(), say whether it can still reach a character that has a creationLocked / award /
     sessionSeal event, and what it does to those. Note what #553, #643 (Randomise keeps the id and keeps its lock entries in order) and the 2026-10-04
     stale-copy fix already closed.
  2. Compare with `fix/chargen-post-lock-purchases` and `docs/plans/2026-10-04-chargen-post-lock-purchases.md`: if that task's plan already merges these paths,
     close this one into it; if not, list exactly which paths remain.
  3. For what remains, draft a self-contained plan for a cold reviewer (AGENTS.md: /make-code-cold-plan-review) BEFORE implementing.
  4. Then merge-not-rewrite, using the identity keys in the plan, plus refuse re-rolling a finished (locked) character.
```
**Done when:** the audit and the comparison with `fix/chargen-post-lock-purchases` are written down; every remaining whole-log rebuild path keeps a locked character's
creationLocked / award / sessionSeal / purchase events (or is shown unable to reach one); re-rolling a finished character is refused; a test per path loads a
locked character through it and asserts the lock events survive; `engine-parity.html` 0 failed; `chargen-flows-e2e.mjs` passes.

**Carried over from the old entry, NOT part of this task (each is its own small task if wanted):** `_cgSyncAward()` relocates a burst-shaped award once on
load; the server guard does not yet stop moving a post-lock purchase to before the lock (review H3); `random-manual-e2e.mjs` does not use the shared browser
launcher; scan other campaigns for the same lock-loss pattern; four free-API cold reviews of the original plan (need `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,
`GROQ_API_KEY`, `DEEPSEEK_API_KEY`).

## fix/audit-saves-and-skills — five abilities sell a save or skill grant the engine never gives — TODO
Branch fix/audit-saves-and-skills. **Effort:** medium · **Risk:** high — rules change (engine AND Players Guide both land, `DATA.version` bumped once) that can change what live characters own or pay, so measure the live owners first.

```text
FOUND 2026-10-20 by the wide ability audit (read-only, against origin/preview). The 2024 grants below come from the audit's memory of the PHB, because `features`/`subAbilMap` carry no text — confirm each against the book before changing it.
Each is a priced ability whose 2024 text also grants something PACT sells separately, and `compute()` grants none of it (proved by buying each on a 20-HD build and diffing compute()):
  - Monk: Disciplined Survivor (19 / 30 AP): proficiency in ALL saving throws. All six saves cost 75 AP (62 if two are owned). The Guide's own rule says convert to the saves ladder.
  - Gloom Stalker: Iron Mind (11 / 18 AP): a WIS save. Sold, grants nothing, while the Guide says "Barred (to saves)". The player overpays.
  - Boon of Skill (25 AP, epic boon, HD 19): the Guide says "Proficiency in every skill"; buying it adds 0 skills. 18 skills cost 72 AP.
  - Fey Wanderer: Otherworldly Glamour (9 / 14 AP): one of Deception / Performance / Persuasion, not granted (1–3 AP).
  - Bard, College of Lore: Bonus Skills (9 / 14 AP): three skills in the 2024 text; priced as a feature, nothing granted.
DO (decide each with the owner, then apply the SAME pattern used for Primal Order — see D-GH-2026-10-20-primal-order-magician-warden): either (R1) make the ability free of the grant and let the existing ladders sell it (bar:true, or a free:true feature that switches the proficiency on so the ladders charge once), or (R2) grant it free and count it first (the owner's feat rule), or (R5) bar the ability. One decision per ability, written in the decision record.
MEASURE FIRST: for each ability, query live `characters` for owners (stats::text ilike) and list them; an event-sourced character keeps its frozen ledger, but a changed compute() total will diverge from it — keep the owner's total unchanged with a grandfathered grant exactly as Primal Order did.
```
**Done when:** each of the five has an owner decision and an engine + Guide change (served copy and `pact-guide` master, `verify-guide.mjs` before and after); a `prof-grants-ci.mjs` case per ability proves what it now grants and costs; any live owner's total is unchanged or listed for the owner; `DATA.version` bumped once; `engine-parity` 0 failed.

## fix/audit-free-spell-picks — Eldritch Knight, Arcane Trickster and Magical Secrets give six free off-list spell picks of any level — TODO
Branch fix/audit-free-spell-picks. **Effort:** medium · **Risk:** high — rules change; touches what two live subclasses can list, and the Guide says these spell lists are bought ("Barred → spell economy").

```text
FOUND 2026-10-20 (wide ability audit). `DATA.spellGrants.choiceGrants` makes owning Fighter: Eldritch Knight, Rogue: Arcane Trickster or Bard: Magical Secrets show a block of SIX "free off-list picks — not bought" in both tools' ✎ Name dialog, any spell level. The audit proved it: with Wish, Meteor Swarm, Time Stop and Power Word Kill named, the character's total stayed at the bare 3-HD cost of 5 AP. Value 6–30 AP for 0. Magical Secrets (13 / 22 AP) only widens the spell pool in the 2024 text; Eldritch Knight / Arcane Trickster (free first subclass) lose their 2024 school limits in PACT but still learn spells through the ordinary known-spell slots.
DO: decide with the owner whether each grant is (R1) dropped, so the player buys those spells through the normal known-spell slots with the subclass's list widened, or (R6) capped (a level ceiling and a count that matches the 2024 feature). Keep the cantrip grants (Mage Hand for Arcane Trickster) if the 2024 text gives them.
MEASURE FIRST: list live characters that own any of the three and have named a grant spell (`stats.LOG` names events, key `grants`); their named spells must survive as already-learned, or the owner decides otherwise.
```
**Done when:** the owner's decision per grant is in the decision record; the engine and both tools agree (the ✎ dialog rows come from `ownedChoiceGrants`); a test proves a high-level free pick is no longer possible and a live character's named spells are kept; Guide text (both copies) states it; `DATA.version` bumped once; `engine-parity` 0 failed; `names-dialog-e2e` and `livesheet-pack-spells-e2e` pass.

## fix/audit-text-only-grants — Body and Mind, Telepathic and Tavern Brawler claim effects the engine does not apply — TODO
Branch fix/audit-text-only-grants. **Effort:** medium · **Risk:** medium — each is a one-ability change, but they are rules changes (Guide + engine + `DATA.version`).

```text
FOUND 2026-10-20 (wide ability audit; the 2024 numbers are from memory of the PHB — confirm them):
  - Boon of Fortitude: DONE 2026-10-20 — compute() now adds the +40 HP (`fix/apply-numeric-grants`, v0.386, owner decision BK).
  - Monk: Body and Mind (19 / 32 AP): 2024 gives +4 DEX and +4 WIS (max 25); the engine adds nothing (scores unchanged after buying), so it is a dead purchase. The ability ladder stops at 20; the Guide says Primal Champion is "the only" cap-breaker.
  - Telepathic (5 AP art): 2024 adds Detect Thoughts once per long rest (worth ~18 AP as an innate level-2 spell). The Guide's barred list names it, yet its own table and the data sell it.
  - Tavern Brawler (4 AP art): the data text claims improvised-weapon proficiency (3 AP when bought separately); `weaponProf` stays empty. The Guide's text omits the claim and sells improvised weapons at 3 AP flat.
DO: one owner decision per item — implement the text (like `_flat` does for Primal Champion's +4), bar it, or correct the text — and apply it in engine + Guide. For Tavern Brawler the simplest correct fix is to remove the claim from the data text.
MEASURE FIRST: live owners of each.
```
**Done when:** each item has a decision and the engine, data text and Guide (both copies) agree; a test per item proves the effect or its absence; `DATA.version` bumped if a price or an effect changed; `engine-parity` 0 failed.

## chore/decide-spell-invocation-pricing — spell-granting Warlock invocations and similar features are priced by tier, not by the spell they give — DECISION NEEDED
Branch chore/decide-spell-invocation-pricing. **Effort:** low (the decision) · **Risk:** low until a rule is chosen — then high.

```text
FOUND 2026-10-20 (wide ability audit) — a pricing-POLICY question, not a missing grant. The Guide says spell-granting invocations "follow the spell-grant ladder", but the engine prices them by Tier/Band. Measured against the innate-spell price of what they give: Contact Patron (10 AP; innate level 5 = 36), Beguiling Magic (6; Charm Person + Mirror Image = 30), Visions of Distant Realms (12 vs 30), Gift of the Depths (6 vs 24), Far Scribe (6 vs 24), Undying Servitude (8 vs 24), Whispers of the Grave (10 vs 24), Greater Divine Intervention (14 vs 60). The gaps are 18–46 AP each.
DO: ask the owner whether the tier price is intended (these are class features, so a class-feature price is correct and the Guide sentence should change) or whether they should move to the spell-grant ladder. No code change until the owner decides.
```
**Done when:** the owner's answer is recorded in `DECISIONS.md`; if "intended", the Guide sentence is corrected in both copies; if not, a follow-up rules task is added with a live-owner measurement.

## docs/reconcile-pact-guide-primal-order — bring the pact-guide project's own records and generated files up to v0.381 — TODO
Branch docs/reconcile-pact-guide-primal-order (work in the `pact-guide` project via the home-server connector, not in this repo). **Effort:** low · **Risk:** low.

```text
2026-10-20: the Players Guide master (`PACT-Players-Guide.html` in `pact-guide`) was edited through the connector to carry the Primal Order / Divine Order split (class tables, one prose paragraph, three worked examples) and the free-feat-proficiency paragraph. Its OTHER files were not touched: `CHANGELOG.md`, `TASK_BOARD.md`, `DECISIONS.md`, the `documents-rules:` stamp (deliberately advanced only by that project's stamp tool), `py/generated/engine-prices.json` and the vendored `py/vendor/engine/` snapshot (refreshed by that project's sync), and `plans/guide-audit-report.md` items 28 (Primal Order) and 112–113 (the War Priest worked example's feature and casting totals are wrong by several AP — the three worked examples were edited for the Divine Order lines only and their other sums are still unreconciled).
Also noted while editing: the master and the served copy differ in unrelated places (Druid "Circle bonus spells varies 5–11" vs 5–12; the War Priest archetype total 204 vs 205).
DO: in `pact-guide`, add the CHANGELOG/TASK_BOARD/DECISIONS lines, run the sync that refreshes the vendored engine, run `stamp_guide_rules.mjs` as a deliberate reconciliation, and re-check the worked examples against the engine. Then run `node testing/scripts/verify-guide.mjs` and `guide-table-diff.mjs` here.
```
**Done when:** `pact-guide`'s records mention the change; its vendored engine and generated prices match v0.381; the `documents-rules` stamp names the reconciled version; `guide-table-diff.mjs` lists no row for the Primal Order / Divine Order / Musician / Chef paragraphs as differing.

## chore/review-barred-abilities — review each of the nine abilities still barred "for the time being" and decide its future — DECISION NEEDED
Branch chore/review-barred-abilities. **Effort:** medium · **Risk:** medium — ambiguity drives it: each ability needs its own rules answer, and un-barring or re-pricing one changes what new players pay (no live character owns any of the features; one player owns Tavern Brawler).

```text
2026-10-20 (rules v0.382, branch feat/bar-unreviewed-grants, D-GH-2026-10-20-bar-unreviewed-grants): the owner barred ten abilities until each is looked at one by one. bar:true hides an ability from NEW purchases and leaves pricing and replay untouched, so reverting any one is deleting its flag. Live Supabase 2026-10-20 (stats::text ilike): no character owns any of the features or free picks; Tavern Brawler appears in 3 rows of 1 owner. Boon of Fortitude and Boon of Skill were deliberately NOT barred.
For EACH ability below, decide with the owner: (R1) keep it barred for good and make the Guide say so plainly, (R2) un-bar it unchanged, (R3) make it grant what it claims and price it, or (R4) replace it with a ladder purchase. One decision per ability, in a decision record.
  1. Monk: Disciplined Survivor (Focus) — engine 19 / 30, Guide printed 24 (19), T6, HD 13, class level 14. 2024 text: proficiency in all saving throws (bought separately: 75 AP for six). Engine grants nothing.
  2. Ranger: Iron Mind (Gloom Stalker) — engine 11 / 18, T4, HD 5, class level 7. A Wisdom save (5 AP bought separately). Engine grants nothing. The Guide already said "Barred (→ saves)".
  3. Ranger: Otherworldly Glamour (Fey Wanderer) — engine 9 / 14, Guide printed 11 (9), T3, HD 3. One of Deception, Performance or Persuasion (1–3 AP bought separately). Engine grants nothing.
  4. Bard: Bonus Skills (College of Lore) — engine 9 / 14, Guide printed 11 (9), T3, HD 3. Three skills (5–10 AP bought separately). Engine grants nothing.
  5. Bard: Magical Secrets — DONE 2026-10-20 (rules v0.384, PR #696, D-GH-2026-10-20-magical-secrets-list-widening): the bar is lifted and it is a list-widening only, price unchanged at 13 / 22 (the Guide's printed 17 was the sticker column and was right).
  6. Monk: Body and Mind — engine 19 / 32, Guide printed 25 (19), T7, HD 17, class level 20. 2024 text: +4 DEX and +4 WIS (bought as ability points: 24 AP from 12 to 16, 48 from 16 to 20). Engine adds nothing, and the ability ladder stops at 20.
  7. Fighter: Eldritch Knight and 8. Rogue: Arcane Trickster — the free picks (six spells of any level) are off (choiceGrants bar:true). Decide whether the subclass should instead widen the list that BOUGHT spells come from (the BH1 option on the board), and keep Mage Hand for Arcane Trickster if the 2024 text gives it.
  9. Telepathic (art, 5 AP, HD 4) — 2024 adds Detect Thoughts once per long rest (about 18 AP as an innate spell). The Guide's barred-feats list already named it while its table priced it.
  10. Tavern Brawler (art, 4 AP, HD 1) — the data text claims improvised-weapon proficiency (3 AP bought separately); weaponProf stays empty. One player owns it and keeps it. The simplest fix is to remove the claim from the data text.
The 2024 numbers come from an audit that worked from memory of the PHB (the data carries no text): confirm each against the book. OVERLAPS: fix/audit-saves-and-skills, fix/audit-free-spell-picks, fix/audit-text-only-grants, fix/gloom-stalker-iron-mind-decision and fix/audit-grants-owner-decisions (graduated 2026-10-20: BH recorded here as item 5 and the EK/AT picks stay barred, BJ and BK done) (BH, BI) cover the same abilities; record the owner's answer HERE, do the work in whichever task owns it, and note that BI's Boon of Skill half is overtaken (Boon of Skill stays purchasable).
TO UN-BAR ONE: delete bar:true from its DATA entry; for the five class features also put the key back into DATA.featureList; revert its Guide row (served copy AND the pact-guide master) and remove its "Barred" line from testing/scripts/guide-price-check.mjs's reviewed list; update testing/scripts/barred-grants-ci.mjs; bump DATA.version once.
```
**Done when:** each of the ten has an owner decision recorded; the engine data, the served Guide and the `pact-guide` master agree for each; `testing/scripts/barred-grants-ci.mjs` matches the final state; `verify-guide.mjs` before and after; `DATA.version` bumped once per branch; `engine-parity` 0 failed.

## fix/server-owner-delete-reinsert-lock-bypass — an owner can delete a campaign-bound character and re-insert it solo without its lock — TODO
Branch fix/server-owner-delete-reinsert-lock-bypass. **Effort:** medium · **Risk:** high — changes who may delete characters and touches the lock/seal enforcement; wrong rule can strand a legitimate owner or a DM's own cleanup.

```text
Security audit 2026-10-22 (read from the SQL, NOT run): lock, seal and DM-imposed events are enforced only on UPDATE of a campaign-bound row. `characters_delete` lets the owner delete their own bound character (`owner_id = auth.uid()`), and `characters_insert` lets them insert a row with a chosen `id` as long as `campaign_id is null` and `ap = 0`. So an owner can delete the character, re-insert it solo with the same id and a LOG minus the creation lock and the DM events, then bind it back with `bind_character_to_campaign`.
Related, already tracked: `feat/house-rules-dm-event-provenance` (forged DM events carried in through a solo character) — decide whether one provenance mechanism closes both before building two.
DO: (1) re-confirm the chain against the live policies and `pg_get_functiondef` of the bind/unbind functions with read-only queries; (2) choose the fix and put shallow vs deep to the owner: shallow = refuse owner DELETE of a campaign-bound character (leaving to a DM or an unbind first), deep = a server record of each locked/sealed character id so a re-insert with that id is refused or restored; (3) implement it as a migration with a SQL test of the full chain; (4) measure the blast radius on the live `characters` table first (AGENTS.md: re-measure, don't assume).
```
**Done when:** a test reproduces delete → re-insert solo → re-bind and shows it refused (or the lock restored); an owner can still delete a solo character and leave a campaign through the normal unbind; `get_advisors` (security) and `get_logs` run after the apply; decision record written.

## fix/server-cost-zero-and-gold-patch — the server cannot check a purchase's cost, a 0-cost buy, a `wealth` event or the `gold` patch key — TODO
Branch fix/server-cost-zero-and-gold-patch. **Effort:** high · **Risk:** high — an AP/gold-moving server rule; a rule that is too strict refuses honest saves from every player.

```text
Security audit 2026-10-22 (from the SQL, not run): purchase costs in the LOG are client-stamped. Negative costs on non-drawback buys are already tracked as `fix/server-negative-cost-after-lock` (docs/TASK_BOARD_NOW.md). Not covered anywhere: a cost of 0 is not checked at all, so nothing on the server guarantees the frozen total equals what `compute()` would charge; `wealth` events and a `buy` with `cat:'patch'` setting `gold` are unprotected, so gold can be written directly.
DO: (1) read the live AP-ledger functions (`pact_ap_ledger_split`, `pact_ap_ledger_spend`) and the gold model; (2) decide with the owner how far the server should go — shallow = clamp cost >= 0 and refuse `gold`/`wealth` writes from the player after the lock, deep = an offline audit script that folds each live character with `engine.js` and compares the frozen spend to `compute()` (a Supabase Edge Function running the real engine is its own task, "Supabase Edge Function running the real engine.js for AP-budget validation"); (3) land the negative-cost fix first, then this one on top.
```
**Done when:** the owner has chosen the depth in a decision record; a SQL test shows a 0-cost buy, a `wealth` event and a `gold` patch by a player are refused (or accounted) on a locked character; if the audit script is chosen it runs against a local export outside the repo and its result is recorded.

## fix/stats-poisoned-json-shape — a player can set `stats.SEQ` or an award flag to junk and make DM actions fail — TODO
Branch fix/stats-poisoned-json-shape. **Effort:** medium · **Risk:** medium — touches several DM RPCs and a trigger, but each change is a safer cast of a value they already read.

```text
Security audit 2026-10-22 (reasoned from the SQL, NOT run): `stats.SEQ` is cast to integer raw in `pact_campaign_move_clears_creation` (`(NEW.stats->>'SEQ')::integer`) and in several DM RPCs; award `disc` and `noLock` are cast to boolean raw. A player who saves `SEQ = "abc"` makes unbind, seal, zero-AP, reopen-creation and set-creation-ceiling raise a cast error for that character, and the owner's DELETE of a campaign may fail too (the foreign-key set-null update fires the campaign-move trigger).
DO: (1) reproduce each failure in a local Postgres first and mark the "campaign delete fails" claim confirmed or refuted; (2) replace the raw casts with the existing `pact_next_seq()` / `pact_num` / `pact_js_truthy` helpers; (3) add a cheap `stats` shape check (SEQ numeric, LOG an array) in the character write path that rejects junk instead of storing it.
```
**Done when:** SQL tests with `SEQ = "abc"`, `SEQ = null` and a non-boolean `disc` show every named RPC and the campaign delete succeed (or the write is refused with a clear message); existing SQL tests unchanged; `get_advisors` and `get_logs` run after the apply.

## docs/record-player-self-award-trust-assumption — write down that players can award themselves AP on a default campaign until the DM seals it — TODO
Branch docs/record-player-self-award-trust-assumption. **Effort:** low · **Risk:** low — a decision record, no code.

```text
Security audit 2026-10-22: on a default campaign a player may add `award` events to their own LOG (AP the tool itself offers during creation) until the DM seals the character, sets the creation limit or turns on `ignore_player_ap`; `pact_enforce_player_ap_ceiling` only blocks it after that. That is a deliberate trust model, but it is written down nowhere, so a future audit will keep re-finding it as a hole.
DO: write `decisions/2026/D-GH-<date>-player-self-award-trust-assumption.md` (Context -> Options -> Decision -> Why -> Status) stating the assumption, which switches turn it off, and that the AP budget check still caps spending; add the one-line pointer in DECISIONS.md. Ask the owner whether the default should change instead — if so, that is a separate rules task, not this one.
```
**Done when:** the record and its DECISIONS.md pointer exist and name the three switches; the owner has said whether the default stays.

## chore/storage-abuse-caps — no cap on character size, character count or backups, and anonymous feedback is not rate-limited — TODO
Branch chore/storage-abuse-caps. **Effort:** medium · **Risk:** medium — a cap set too low breaks honest saves, so measure first.

```text
Security audit 2026-10-22 (from the SQL, not run): there is no limit on the size of `characters.stats`, or on how many characters one account may hold; campaign-bound characters keep every backup snapshot (`trg_characters_snapshot` into `character_backups`); `feedback` accepts anonymous inserts (message capped at 2,000 characters) with no rate limit. On the free tier this is a way to fill the database.
DO: measure first with read-only queries (largest `stats` size, characters per owner, backup rows per character, feedback rows) and state the numbers with today's date; then propose caps well above the live maximum — a `stats` size check, a per-account character count, a backup retention rule (keep the last N per character), a per-hour limit on feedback — and put the choice of numbers to the owner.
```
**Done when:** the live measurements are in the decision record; each chosen cap is enforced by a migration with a test showing an honest maximum character still saves and an oversize one is refused; backups prune to the chosen retention.

## chore/security-audit-low-items — small hardening items from the 2026-10-22 audit — TODO
Branch chore/security-audit-low-items. **Effort:** low · **Risk:** low — each item is a one-statement or one-line change; verify each against the live database first.

```text
From the 2026-10-22 security audit (read from the SQL; items marked live were also seen in the live database that day):
(a) `dm_set_creation_ceiling` and `dm_reopen_creation` lack `assert_campaign_active`, so they still work on an archived campaign;
(b) both are missing from `sql/rls-policies.sql` (only in a migration), so the baseline does not describe the live database;
(c) `pact_patch_exempt_keys`, `pact_patch_protected_projection`, `pact_patch_temp_exempt_keys` are executable by `anon` (live) — harmless pure helpers, but revoke from public/anon like the other helpers;
(d) `award_ap` has no idempotency key, so a retried request awards twice (compare `award_ap_and_seal`, which takes `p_idem`);
(e) `campaigns` has a table-level INSERT grant on `invite_code`, so a client can choose its own join code (live: INSERT is granted on `invite_code`, `archived_at`, `created_at`, `rules`); decide whether to narrow it.
DO: one migration for (a), (c) and (e) if the owner agrees, a baseline sync for (b), and a decision on (d).
```
**Done when:** each item is fixed or has a recorded reason to leave it; the SQL drift guard passes; `get_advisors` (security) run after the apply.

## chore/enable-leaked-password-protection — turn on Supabase Auth leaked-password protection — TODO
Branch chore/enable-leaked-password-protection. **Effort:** low · **Risk:** low — a dashboard toggle; existing users are unaffected until their next password change.

```text
The Supabase security advisor (2026-10-22) reports `auth_leaked_password_protection`: Auth does not check new passwords against HaveIBeenPwned. This is a dashboard setting (Authentication -> Providers/Password security), not a code change, and a session cannot flip it.
DO: the owner turns it on in the Supabase dashboard for the PACT project (piuprrrnaotrtxucrtsb); then re-run the security advisor to confirm the warning is gone and note it in CHANGELOG.md.
```
**Done when:** the security advisor no longer lists `auth_leaked_password_protection`.

## fix/player-grants-null-cat — the player-grants guard treats a `buy` with no `cat` as a drawback — TODO
Branch fix/player-grants-null-cat. **Effort:** low · **Risk:** low — harmless today (ambiguity low, damage likelihood low, damage scale low: an uncategorised buy is ignored by the engine and by `pact_enforce_negative_cost`), but it is a database function on a trust boundary, so measure and test before the apply.

```text
Found 2026-10-25 while building fix/server-negative-cost-after-lock. `pact_enforce_player_grants()` skips a campaign-character `buy` event with a test of the form `not (cat is drawback-like or ...)`. When the event has no `cat`, the test evaluates to NULL, so the guard skips the event as if it were a drawback. Noted in testing/scripts/creation-lock-guard-test/negative-cost-cases.sql.
DO: (1) measure live: count `buy` events with no `cat` in `characters.stats.LOG` (read-only); (2) make the missing-cat case explicit in the function (coalesce `cat` to '' so it is treated as an ordinary buy, or refuse it, whichever the measurement supports); (3) add harness cases to the player-grants SQL tests under testing/scripts/creation-lock-guard-test/; (4) fold the function into sql/rls-policies.sql and update the baseline drift test; (5) write a migration plus rollback, apply it, md5-compare the live definition with the local build, run get_advisors.
```
**Done when:** a `buy` with no `cat` is handled on purpose, with harness cases for it; the SQL guard workflow and `rls-baseline-test.sql` pass; the live function matches the local build; `get_advisors` (security) run after the apply.
