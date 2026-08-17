# Larger design plans (8 tasks)

Pre-implementation plans for the eight bigger design tasks. Each needs the repo
and/or an owner ruling before code — I surface the decision to make, the trap, and
the sequencing. The AP-model cluster (items 4–8) is deeply interdependent; a
suggested global order is at the bottom. Not committed.

---

## 1. `feat/character-ownership-claim-link` — DM hands off a built character (high, cold-review)

Today a DM can only get a NEW character in (blank, via `createPlayerInvite`/
`redeemPlayerInvite`) or a player binds an already-owned one
(`bindCharacterToCampaign`). Neither covers a DM building/importing a fully-formed
character and handing **ownership** to a player. Confirmed no transfer path exists:
`characters_update`'s RLS requires `owner_id = auth.uid()` in **both** USING and WITH
CHECK, and the only insert grant sets `owner_id` once at creation. This is a
**brand-new SECURITY DEFINER RPC + invite-token flow**, a trust-boundary change.

**Open design questions to resolve BEFORE code (don't guess — cold-review):**
1. How does the DM get the character in without breaking DM Console's "read-only,
   never edits" principle? Options: (a) DM builds/imports in CharGen under their own
   account bound to the campaign, then generates the claim link; (b) DM Console gains
   an explicit non-read-only capability for this one flow; (c) other. **Lean (a)** —
   it keeps DM Console's invariant intact and reuses CharGen.
2. Claim-link semantics: single-use (like `redeem_player_invite`) vs reusable?
   Expiry? Revoke/regenerate before redemption?
3. `ap` (DM-awarded, server-authoritative) across transfer — should carry over
   untouched ("store raw, derive the rest"); does `ap_awards.dm_id` still make sense
   pointing at the original DM after ownership moves?
4. Authorisation: verify redeemer isn't already owner, character is
   unclaimed/transferable, caller is a genuine distinct user — mirror
   `redeem_player_invite`'s idempotency guard (repeat call by same user returns same
   result, doesn't error).
5. Player consent — does the player confirm before ownership changes, or is
   redeeming the link itself the confirmation?

**Steps (after the above are recorded):**
1. Schema: a new invite-token table/column (or extend `campaign_invites` with a
   `character_id` + a kind discriminator) for "claim existing character" tokens,
   distinct from today's "create new" tokens.
2. New RPCs `create_character_claim(character_id)` / `redeem_character_claim(token)`
   — owner-gated on creation, single-use on redemption, updating
   `characters.owner_id` (the **only** path that may ever do so).
3. UI: a "Generate claim link" action wherever the DM got the character in (per Q1);
   redemption reuses the existing invite-redemption page pattern.
4. Log the ownership-transfer decision in DECISIONS.md.

**Note:** the `security/privilege-and-character-integrity` task explicitly says a
*deliberate* transfer RPC belongs **here**, not there. Run
`/make-code-cold-plan-review`; then the advisor after any RLS change.

---

## 2. `feat/campaign-character-limit` — DM sets characters-per-player (large, high)

Today the limit is hard-wired to **one**, and it's a **database invariant**, not a
soft rule: the unique index `idx_characters_owner_campaign_unique` on
`characters(owner_id, campaign_id) where campaign_id is not null`.

**The trap that makes this bigger than "drop the index":** that index is also the
**TOCTOU race guard** for `bind_character_to_campaign` — the RPC's EXISTS-then-write
can't close the window on its own, which is *why* the index exists. Dropping it to
allow N reopens that race. A partial/expression index **cannot** express "at most N
rows per (owner, campaign)" either, so the guard must **move** — most likely into the
RPC under `select … for update` on the campaign row, or a count check inside a
serializable transaction.

**Steps:**
1. Limit lives in `campaigns.rules.maxCharactersPerPlayer` (integer, default 1) —
   rides the existing rules JSON, no new column, DM Console already has a rules panel
   + save path.
2. Replace the unique index with a **race-safe** guard at N. Do NOT simply drop it.
3. Teach `bind_character_to_campaign` and `redeem_player_invite` the limit: the
   one-per-campaign EXISTS check becomes count-against-limit; the friendly error
   states the **actual** limit ("Amble allows 2 characters per player").
4. DM Console: a number input in the rules panel next to starting tier, default 1.
   **Lowering it below what players already hold must NOT delete/unbind anything** —
   existing rosters grandfathered; the limit only gates new joins. Say so in the ⓘ.
5. CharGen's join path shows the campaign's limit when refused.
6. Migration under `sql/migrations/`, then run the advisor + skim `get_logs`.
   Rules-only DB change → no `DATA.version` bump.
7. cloud-e2e: limit=1 (must not regress), limit=2 (second join succeeds), refusal at
   the limit; a concurrency check for the race guard if cheap.

**Get the concurrency design reviewed** (`/make-code-cold-plan-review`) — a wrong
answer is a duplicate-join bug that only shows under real simultaneous joins.

---

## 3. `feat/dm-creation-lock` — DM lock a player can't undo (cloud campaign chars only)

Owner "ideally but not critical", scoped 2026-08-06 to **cloud characters in a
campaign** — that scoping is the whole design: a cloud character's row is
server-mediated, so this can be **genuinely enforced**, not just client-honoured.

**Read first:** `D-GH-2026-08-06-creation-lock-survives-reload.md` — its Outstanding
section is this task, and its trust-boundary worry ("a player can edit their own
local LOG") is **resolved by the scoping**, not by argument.

**The core principle:** **the server is the enforcement point, not the LOG.** Per
AGENTS.md, RLS is the only real security boundary; a client-written flag is
decoration. So the rule belongs in `sql/rls-policies.sql`: an UPDATE by the OWNER
must not clear a DM-applied lock while `campaign_id` is set; the campaign's DM can
set/clear it.

**Where the lock lives (decide before any policy):**
- **(a) dedicated column** `characters.dm_locked boolean` — trivially checkable in a
  policy, independent of LOG contents. **Preferred** — an RLS policy can't reasonably
  inspect a JSON LOG.
- (b) inside the stats envelope — keeps everything in one place but makes the policy
  parse JSON: fragile and slow. Expect to reject; say why in the record.

The LOG's `creationLocked` event becomes a **display mirror**, not the source of
truth — the engine stays auth-ignorant (it compares values, doesn't know who a DM
is). Stamp provenance on the event for the UI; say plainly in the record that the
event enforces nothing.

**Edge cases needing an owner answer (don't guess):**
- DM-locked character **removed from the campaign** (`campaign_id` cleared) — does
  the lock survive as an ordinary lock, or clear? Pick one, record it.
- Player **exports** a DM-locked character and re-imports locally — the local copy
  has no server row, so nothing enforces it. Acceptable (now a standalone character),
  or must export refuse/strip? Precedent:
  `D-GH-2026-07-11-clone-campaign-character-standalone` deliberately severs the
  campaign on clone.
- A character with no `campaign_id` can never be DM-locked — confirm the UI never
  offers it.

**DM Console has NO lock UI today** (`creationLocked` appears 0 times) — that's the
whole player-facing half. Back-compat: default the column false; run advisor +
`get_logs` after; verification needs a signed-in campaign with a DM and a player.
**Not sweep-eligible.**

---

## 4. `fix/livesheet-draft-reconcile` — does a PRE-LOCK character reconcile to compute()? (owner decision FIRST)

`D-GH-2026-08-05-pricing-model` D1 and D2 conflict for one case neither anticipated.
Measured on a fresh Live Sheet character under the 79 AP threshold (a draft by D2):

| step | ledger | compute() |
|---|---|---|
| CON 16, Vigor 2, Grit 3 | 32 | 32 |
| level 1→2 | 34 | 46 |
| level 2→5 | **44** | **83** |

Ordinary purchases reconcile; only level-ups diverge. **D2** says a draft reconciles
(so the Live Sheet needs `repriceDraft` too); **D1** says a context change takes its
listed price and levelling is a real context change even during creation (so the
divergence is correct and D2's wording needs narrowing to *"while no context change
has occurred"*). CharGen is unaffected (it builds at one level).

**This needs a RULES answer before any code:**
1. **OWNER DECISION FIRST:** does a pre-lock character who levels up keep listed
   prices (divergence correct), or re-price to one context (ledger reconciles)?
2. Record as an amendment to `D-GH-2026-08-05-pricing-model` — it narrows D1 or D2;
   the record must say **which**, or the next agent reads them as still conflicting.
3. If **reconcile:** call `repriceDraft()` from the Live Sheet's emit path exactly as
   CharGen does — the export exists and is fuzz-covered; wiring, not new logic.
4. If **listed prices correct:** narrow D2's wording, add the measured table above to
   the record as the worked example (an undocumented 44-vs-83 will be re-reported as
   a bug).
5. Either way add the case to `testing/scripts/tool-pricing-ci.mjs`.

**This is the lynchpin of the AP cluster — settle it first (see order at bottom).**

---

## 5. `fix/history-shows-derived-lines` — history hides derived (pack) costs (display-only)

Its blocker landed (`fix/species-pack-not-charged`, 2026-08-05) — **re-measure
before starting.** The fix did NOT make packs their own events; `compute()` derives
pack cost from `b.species`/`b.species2`, so the pack is priced into the identity
patch's line.

The Live Sheet's purchase history is **event-only**, so for Anders it renders four
`Species trait …  −0` lines and **no sign of the 19 AP the species actually cost** —
because Heritage pack and 2nd-origin species are *derived* lines from compute(), not
log events. The AP Ledger panel *does* show them, so the tool presents two
non-reconciling views, and the history (the one a player reads for "where did my AP
go") is the one that hides it.

**Steps:**
1. **Re-measure first** — if packs became real log events, the history may already be
   complete and this shrinks to a check.
2. For whatever derived cost remains, make history reconcile with the AP Ledger —
   either show derived lines inline, or group pack-included traits under their pack
   with the pack's price, so a −0 entry is visibly explained rather than looking free.
3. A 0-cost entry should never read as "free" when it was paid for inside a bundle.
4. Display-only → no `DATA.version` bump.

**Sweep-eligible only after re-measuring.** Low risk (display-only).

---

## 6. `feat/ap-model-reconcile` — "AP left" and the AP Ledger disagree (large, high)

Long-deferred from D-GH30, now with a worked example and a decision taken.

**⚠ Inherits the reversed H2** — disagreement is **EXPECTED**, not a defect, wherever
context changed since a purchase: the ledger records what was paid, compute() prices
what it would cost today. The bug is only where they disagree for another reason.

**The decision (G1, owner, 2026-08-04, shipped #355):** DM Console's roster "AP left"
uses the **frozen ledger** (`compute().spendable − economy().spent`) — matching the
Live Sheet's `_apRemaining()` and its buy() gate. The AP Ledger panel keeps showing
`compute().total`. The two can disagree on one screen — accepted, not overlooked.

**Worked example — Fenwick Copperkettle (live, Amble):** DM AP 36, frozen spend 47,
repriced cost 40 → card "AP left" **−11** (frozen), AP Ledger **4 over** (repriced).
The 7 gap = ~3 genuine price drift + 4 drawback accounting (the refund sits inside
`compute().total` as −4 but is excluded from frozen spent, landing in earned).

**Also unresolved here:** `apLevel` uses `trackLevel(eco.earned)`, so a fully
DM-funded character reads **Earned Lv 0 / 0 earned** even when granted 36, because
`economy().earned` can't see DM AP. Wrong identically in Live Sheet and DM Console;
#355 deliberately didn't fix it there alone (would trade a shared bug for a
divergence). **Fixing it belongs here.**

**Sequence after `fix/species-pack-not-charged`** (changes what the frozen ledger
contains). **Decisions to take:**
1. Is "earned" a display composition (`eco.earned + dmAp`, honouring
   `ignore_player_ap`) or does the engine grow a frozen-ledger-aware remaining-AP
   export? Former keeps `economy()` pure/log-only (what the anti-double-count
   invariant wants); latter puts it in one place. **Lean former.**
2. Whatever's chosen, Earned Lv / "AP to reach Earned Lv N+1" / header Track-Level
   all read from it, in **both** tools, or the divergence just moves.
3. Should the card and the AP Ledger ever be allowed to differ? If yes, **label**
   them so a DM can tell which question each answers; if no, one changes.
4. Amble's starting tier is 36 AP while Standard L1 is 79 / L0 is 55 — so every
   character there reads below level 0. Confirm with owner that's intended before
   treating low Track-Levels as a bug.

**Settle the compute()-vs-frozen question ONCE, here** — `feat/ledger-show-lost-
purchases` (next) explicitly defers to this. Not sweep-eligible.

---

## 7. `feat/ledger-show-lost-purchases` — ledger doesn't show what was LOST (high, owner decision)

Successor to `feat/ledger-itemise-drawbacks` (active-drawback half shipped PR #364).
What remains: the ledger must also show what was **lost**, not only what's held.

**Measured 2026-08-05:** a drawback taken for 2 then bought off for 6 appears in NO
ledger line — categorised lines sum to 0 while `economy()` reports 6 spent.
`compute()` is a pure function of the BUILD, and a bought-off drawback is no longer on
the build; the buy-off cost lives only in the LOG on the `buyoff` event. So this
**cannot** be fixed by another `addItems()` call — the information isn't in
compute()'s input.

**THE DECISION COMES FIRST (owner) — should historical spend appear in compute()'s
ledger?** Three shapes, none obviously right:
- **(a)** a new ledger line ("Drawbacks bought off") that ADDS to `compute().total` —
  simplest to render, but changes output (bump `DATA.version`, refresh expected, risk
  double-counting in tools that add `economy().spent` separately).
- **(b)** a new top-level field on compute()'s return (e.g. `lost`) that no ledger
  LINE reads, rendered as its own section by each tool — leaves total untouched,
  needs a renderer change in CharGen and Live Sheet.
- **(c)** leave compute() alone, derive from `activeEvents()`/the LOG at the tool
  layer — fastest, but re-implements ledger logic outside the engine, which AGENTS.md
  forbids.

**This is the same question as `feat/ap-model-reconcile` (compute() vs frozen
ledger). Settle it ONCE, there, and let this task follow — don't answer it twice.**

**Also:** BLOCKED ON `feat/dm-edit-events` for the boon half (DM-removed boons don't
exist yet, so their line shape can't be verified). Either sequence after that, or
scope this to the drawback half alone and say so. Gate: categorised ledger lines must
reconcile with `economy().spent` for a character who bought off a drawback —
`testing/scripts/tool-pricing-ci.mjs` already drives `renderLedger()` (PR #364). If
output moves, bump `DATA.version`; else say so. `engine-parity` 0 failed either way.

---

## 8. `feat/randomize-emits-in-order` — randomize builds in purchase order (medium)

Successor to the ordering half of `feat/creation-vs-awarded-ap`.

**Scope — read before assuming more to do.** Purchase order is ALREADY correct for
interactive building, native save/load, and undo/redo (verified 2026-08-06). What's
LEFT are paths where the character arrives whole with no click order: **randomize**,
the shared `#b=` link, and legacy flat-file import.

**Only RANDOMIZE can be fixed honestly.** A shared link and a legacy file carry a
flat build with no sequence — inventing one is a lie dressed as data. **Decide
explicitly** whether those two keep today's behaviour (whole build creation-priced,
lock appended after) and **say so in the record.**

`randomizeRoll()` (~:3407) already applies ~30 mutator lambdas in a random order
until budget is spent — that order is as genuine as a generated character gets. The
work is emitting **one event per applied mutator** instead of mutating a flat build
and bursting at the end. **The actual cost is the mapping** — each lambda
(`x.skills.push(s)`, `x.stats[a]+=2`, …) needs the matching event shape/cost; ~30 of
them; **check each against `MUT` in `js/engine.js`, don't guess a category.**

**Performance — measure before/after.** `emit()` calls `_cgRepriceDraft()`, which
replays the whole log; per-event across ~50 events is O(n²). If slow, batch the
repricing to the end rather than abandoning ordering.

Gate in `tool-pricing-ci.mjs`: after a randomize past the threshold, the
`creationLocked` event must sit at the purchase where cumulative spend crossed it,
not at the end — prove the assertion fails against the current burst implementation
first. Display/state only → no `DATA.version` bump; keep `engine-parity` at its count.

---

## Suggested global order for the AP-model cluster (items 4–8)
The task text says these interlock. Recommended sequence:

1. **`fix/livesheet-draft-reconcile` (#4)** — the rules lynchpin; it defines what
   "correct" means for a pre-lock ledger, which everything below depends on.
2. **`feat/ap-model-reconcile` (#6)** — settles the compute()-vs-frozen question that
   #7 explicitly defers to.
3. **`feat/ledger-show-lost-purchases` (#7)** — follows #6's decision; its boon half
   also waits on `feat/dm-edit-events`.
4. **`fix/history-shows-derived-lines` (#5)** — display-only; re-measure after the
   pack fix, independent of the above but cheap to slot in.
5. **`feat/randomize-emits-in-order` (#8)** — independent; its budget-adherence
   checks must read the RECONCILED ledger, so after the reconciliation questions
   settle.

And finally `fix/ledger-reconciliation-pass` (the one-off migration, in the "can't
do" bucket) runs **last of all**, after all four pricing branches land.
