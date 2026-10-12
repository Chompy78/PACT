# D-GH-2026-10-12-dm-house-rules-editor — a DM sets one campaign character's house rules through the DM edit path

**Context.** Since `fix/player-free-ap` (#638, `D-GH-2026-10-12-player-free-ap` Q3) a player cannot change a
server-confirmed campaign character's `houseRules` — the DM Calls (Bound / Boons / Drawbacks / Non-core) and the custom or
repriced boons and drawbacks CharGen's "DM customisations" panel writes — because `compute()` prices them (`b.houseRules.boons`
and `.draws` override the printed AP; a custom drawback grants AP). Nobody else could either. DM Console's campaign "house
rules" are free-text labels (`currentHouseRules`) that never reach a character, and `dm_edit_character_log()` — the only path a
DM has into a player's `stats->LOG` — accepted only boon/drawback buys, awards, `dmRemoveBoon`, `sessionSeal` and
`dmUnlockDrawback`.

How it is stored today (checked in code, 2026-10-12): `houseRules` lives in the LOG as a `{type:'buy', cat:'patch',
_slot:'houseRules', payload:{patch:{houseRules:{boons, draws, disabled, dmAllows}}}}` event (CharGen's `HOUSE_RULES` patch slot).
`MUT.patch` folds it with `Object.assign`, so the LAST patch carrying `houseRules` wins wholesale (a `tasharule` event can also
set `dmAllows.tasha`). `compute()` reads `houseRules.boons/draws` (prices) and `dmAllows.tasha` (a ⛔ warning); `bound`, `boons`
and `drawbacks` are CharGen picker gates only. On the server, `houseRules` is in `pact_patch_exempt_keys()`, so a
houseRules-only patch has no protected projection: `pact_enforce_locked_history()` lets it be appended or rewritten after a
lock, seal or award; `pact_ap_ledger_spend()` ignores patch costs; `pact_enforce_creation_lock()` exempts a campaign DM.

The owner was away. The choices below were taken under standing instruction **H2** (the most conservative option: the one that
refuses, locks or hides rather than grants AP or opens an edit).

**Options and decisions.**

- **Q1 — campaign-level or per-character?**
  - A. Campaign-level: the campaign holds the house rules and every character inherits them (the engine reads campaign rules).
  - B. Per-character, through the existing DM RPC path.
  - **Decision: B.** A changes what `compute()` reads for every character in every campaign — new engine input, every tool,
    every existing character re-priced at once — and the board entry itself flags the larger blast radius. B touches only the
    one character a DM chooses, uses the data shape the tools already fold, and needs no engine change. A campaign-wide default
    can still be added later on top of B.

- **Q2 — does the existing RPC already allow it?** No: `dm_edit_character_log()` refuses `buy/cat:'patch'` ("unsupported buy
  category patch"). So a migration is needed — `sql/migrations/2026-10-12-dm-house-rules-edit.sql` (+ rollback), **NOT APPLIED**.
  It accepts a patch whose ONLY field is `houseRules`, validates its shape strictly (CharGen's shape: boons `{hd 1–20, ap ±1000,
  fx ≤500}`, draws `{ap, fx}`, disabled lists of names, `dmAllows` booleans for the four known calls; ≤32 KB), and rebuilds the
  event from a whitelist. No other patch field is opened to the DM. Tested in `testing/sql/dm-house-rules-test.sql` (35
  assertions, in `sql-guards.yml`). DM Console feature-detects the refusal from an un-migrated server and tells the DM in plain
  words; nothing else changes until it is applied.

- **Q3 — append or rewrite?** **Append**, always: one new event after everything else, so the player's own history (including
  their original house-rules event) is never rewritten, and the DM edit is stamped `dmEdit`/`dmId` like every other. The event
  carries no `_slot`, on purpose: CharGen replaces "the slot's event" in place and prices it with every `_slot` event removed, so a
  second `_slot:'houseRules'` event would double-count in that pricing. Without `_slot` the DM's event simply folds last and wins.

- **Q4 — what does the event cost?**
  - A. The AP delta of `compute().total` (what CharGen's own pre-lock slot edit stamps): repricing a held boon down refunds AP,
    up charges it.
  - B. Always 0: a rules change is not a purchase.
  - **Decision: B, enforced by the server** (it stamps `cost: 0` whatever the client sends). It never grants AP through the
    ledger (H2), keeps the dm-edit invariant that a DM line never moves the player's frozen ledger, and follows D-GH30 — what a
    boon cost when it was bought is what was paid; later purchases use the new price. While a character is still a creation
    draft, `repriceDraft()` re-stamps every purchase at today's prices on the player's next save anyway, which is the draft
    semantics everywhere. One effect is NOT ledger-borne: a drawback the character HOLDS is worth its new value at once, because
    `compute()` derives the drawback grant from current values. DM Console therefore shows the AP-left change in its confirm
    (frozen ledger: `compute().spendable − economy().spent`, the card's own figure) and **refuses** a change that would leave the
    character below 0 AP left — the same direction as the player tools' over-budget gates.

- **Q5 — what the DM may do in the editor.** Toggle the four calls; add a custom boon/drawback or reprice a built-in one (AP 0–1000
  whole numbers — a negative boon would be a hidden AP grant, so it is not offered); remove an override (back to the printed
  price) or re-enable a disabled built-in. **Refused:** deleting a CUSTOM rule the character currently holds (it would orphan the
  purchase — "no longer in the rules data" — refunding a boon or dropping a drawback's grant); the DM removes the boon first.
  Not offered (left for later): disabling a built-in from the DM Console. Turning a call off does not remove anything the
  character owns (CharGen's own toggle offers to clear selections; here that is the existing "remove a boon" control).

- **Q6 — the #638 H2 decisions.** Unchanged and still **provisional**: the owner kept them under I1. This change does not
  revisit solo self-awards (not `noLock`), DM Calls being read-only for a solo character after their own lock, or starting gold
  refused both ways after the lock. The only text changed is CharGen's campaign refusal, which now points the player at the DM
  Console instead of saying there is no DM editor.

**Known, left alone.** The player can still write `houseRules` into their own row directly (the server exempt list — the
`feat/server-freeze-at-lock` follow-up, `D-GH-2026-10-12-player-free-ap` Q5). Dropping `houseRules` from that list would not
refuse these DM events: they are appended, and the projection only freezes what is already stored.

**Why.** It gives the DM the one control #638 took from the player, on the smallest surface that works: one character, one
appended and audited event, no engine change, no AP moved through the ledger, and the server still validates every byte.

**Status.** Provisional — owner away, taken under standing instruction H2, reversible. The migration is written and tested but
**not applied**; the PR must not be merged until the owner applies it (then folds it into `sql/rls-policies.sql` and runs
`get_advisors`). Rollback: `sql/migrations/2026-10-12-dm-house-rules-edit-rollback.sql` (byte-identical restore, tested).
