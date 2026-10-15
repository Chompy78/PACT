# D-GH-2026-10-15-boon-drawback-notes — some boons and drawbacks need a player-written description, which the DM approves and so locks

**Status:** code in PR (`feat/boon-drawback-notes`). **The SQL migration is NOT applied** — merging does not apply it; the
owner applies `sql/migrations/2026-10-15-boon-drawback-notes.sql`, then runs `get_advisors`. The tools work before it is
applied (see *Deploy order*). `DATA.version` **not** bumped: `DATA.notePrompts` is display-only (`compute()` never reads it).
Solo-character rule is **provisional** (see *Owner decisions*).

## Context

Owner request 2026-10-14: some boons and drawbacks mean nothing at the table without a description the player writes —
"Code of Honour" needs the code, "Phobia" needs the fear, "Nightmares" needs the nightmares. "Oath of Poverty" is
self-explanatory and needs nothing. For the flagged ones: the description is required when the item is bought, the player
can edit it until the DM approves it, and after approval it is locked — in both player tools AND on the server — until a
DM unlocks it. Shown on the Live Sheet, the 📋 Sheet, CharGen and the DM's card.

## Owner decisions (2026-10-14)

- **(a) Which items.** Review every boon and drawback in `js/engine-data.js` one by one (name + effect text) and flag only
  those whose name/effect needs a player-written description to mean anything at the table; give each its own question.
- **(b) Solo characters (no DM).** Not picked by the owner. **Provisional default: the note is required but never locked**
  (there is no DM to approve it). Recorded here so the owner can overturn it; changing it later is a client-only change
  plus one line of the trigger (it already skips solo characters).

## The reviewed list (all 109 drawbacks and 89 boons read, 2026-10-15)

The test: does the effect text refer to something specific that the rules leave undefined (a "what / who / which"), or did
the owner name it? Flagged items get `DATA.notePrompts[cat][name]` = the question asked.

**Flagged — 16 drawbacks**

| Drawback | Why it needs a description | Question asked |
|---|---|---|
| Code of Honour | "lose advantage when you break it" means nothing until the code is written (owner's example) | Write your code of honour: what will your character never do, and what must they always do? |
| Compulsion | "a vice you must indulge" — which vice is not stated | What is your character's compulsion or vice, and what tempts them into it? |
| Haunted / Phobia | applies "in a defined, recurring circumstance" that only the player defines (owner's example) | What haunts your character, or what are they afraid of? Describe the exact circumstance that sets it off. |
| Nightmares | mechanics are fixed, but the table needs to know what they are (owner's example) | What are your character's nightmares about? |
| Superstitious | triggers when "it" (the talisman) is lost or taken — the table must know what it is | What is your talisman, and why does it matter to your character? |
| Conspicuous | "an unhidable trait" — which trait is not stated | What is the trait that makes your character impossible to hide? |
| Dependent | "a loved one relies on you" — who, and where, is the whole drawback | Who relies on your character, and where are they? |
| Hunted | "a persistent enemy or bounty" — who is hunting is the whole drawback | Who is hunting your character, and why? |
| Outsider | applies only "with them" — the culture or faction must be named | Which culture or faction distrusts your kind, and why? |
| Notorious | applies where "your name is known" — what you are known for decides how every NPC reacts | What is your character notorious for? |
| Marked | "recurring suspicion and pursuit" — what marks them and who pursues is undefined | What marks your character out, and who keeps watching or pursuing them? |
| Mute | "verbal spell components need a workaround" — the workaround must be agreed | Why can't your character speak, and how do they communicate and handle verbal spell components? |
| Vulnerable | "one damage type, the DM picks" — the choice must be recorded | Which damage type is your character vulnerable to? (Your DM picks one that appears in the campaign.) |
| Prophesied Doom | applies only against the doom "the DM chooses at creation" — it must be recorded | What is your foretold doom? (Your DM chooses it at creation — record it here.) |
| Truename Known | "a recurring enemy … name them with your DM" | Who has learned your true name? |
| Two Souls | "the other personality surfaces" — who it is is undefined | Who is the other soul — what is the second personality like? |

**Flagged — 7 boons**

| Boon | Why | Question asked |
|---|---|---|
| Contacts | "one region" is a choice | Which region are your contacts in, and who is one of them? |
| Beloved | "one community" is a choice | Which community treats your character as family, and why? |
| Patron | "a powerful ally" — who is the whole boon | Who is your patron, and what do they expect in return? |
| Elemental Affinity | "choose a damage type" — the choice is recorded nowhere else | Which damage type did you choose? (Not slashing, piercing or bludgeoning.) |
| Font of Will | "one school of magic, chosen when you take this boon" — recorded nowhere else | Which school of magic did you choose? |
| Boon of Energy Resistance | "two damage types" — recorded nowhere else | Which two damage types do you resist? |
| Beast-Bonded | "a loyal animal companion" — which animal | What animal is your companion, and what is its name? |

**Deliberately NOT flagged (the borderline ones, with the reason)**

- Oath of Poverty (permanent) — owner: self-explanatory; its text says exactly what is forbidden.
- Doppelganger, Soul Debt, Cursed Wealth, Echo, Weather-Bringer, Geas of the Road — the effect is complete; the specifics
  are the DM's plot hooks, not a player choice.
- Honest to a Fault, Merciful, Berserk Temper, Quick to Quarrel, Reckless, Squeamish, Bad Liar — the behaviour is fully
  described by the text.
- Claustrophobic, Agoraphobic, Fear of the Dark, Fear of the Dead, Fear of Being Alone, Crawling Things, No Head for
  Heights, Gun Shy — named, already-defined phobias (unlike Haunted / Phobia, which leaves the fear open).
- Every injury, wound and Affliction (Missing Arm, Peg Leg, Burned Eye, Affliction — Clumsy, …) — fully defined.
- All other boons — complete effects (Folk Renown, Ear to the Ground, Scrounger, Animal Friend …: the DM adjudicates,
  nothing for the player to pin down). Epic boons that need an ability score already have their own pick in the Names
  dialog.

The list is data (`js/engine-data.js`, its own line after the generated dataset): trimming or extending it is a one-line,
display-only change.

## Options

- **Where the note lives.** (A) a `note` field on the buy event — rejected: after the creation lock a buy event is part of
  the protected history (`pact_ap_ledger_protected`), so an edit before approval would be refused by the server, and the
  Live Sheet/CharGen never rewrite a stored event anyway. (B) **a separate, append-only `itemNote` event — chosen**: an
  edit is a newer note (the latest wins), which also gives the DM an audit trail, and it needs no change to the history
  guards.
- **How it is keyed.** (A) the purchase's `seq` (like `dmUnlockDrawback`/`dmDiscount`) — rejected: CharGen renumbers a
  draft's purchases whenever it rebuilds the log (Randomise, New, legacy load), which would orphan every note. (B)
  **category + name — chosen**: a character holds at most one copy of a boon or drawback name (CharGen's picker is a
  checkbox, the Live Sheet shows a held one as Active). Re-buying an item after a buy-off finds its old note (pre-filled;
  an approved one is kept as is).
- **Approval path.** (A) a separate RPC — safer (no redefinition of `dm_edit_character_log`), but the owner asked for the
  DM-event route used by every other DM edit. (B) **two new allow-listed types in `dm_edit_character_log` — chosen**, built
  on the CURRENT definition (`sql/rls-policies.sql`, = the applied 2026-10-13 discount migration), with the reconcile
  note for the house-rules migration below.
- **Who may approve where.** Approvals carry the campaign they were made in (`campaignId`, stamped by the server) and count
  only in that campaign — in all three tools and on the server. So a character that moves campaign needs its new DM's
  approval, and approvals made elsewhere cannot lock a note here.

## Decision

**Data.** `DATA.notePrompts = {drawback:{name: question}, boon:{name: question}}` (23 entries above). Display-only.

**Events** (in the character's LOG):
- `{type:'itemNote', cat, refVal, text}` — player-written; 1–500 characters after trimming; the latest is the note.
- `{type:'dmApproveNote', cat, refVal, text, campaignId}` — only via `dm_edit_character_log`; `text` is copied by the
  server from the note it approved.
- `{type:'dmUnlockNote', cat, refVal, note?, campaignId}` — only via `dm_edit_character_log`; optional reason ≤ 200.
- State, read in log order (one reader per side, identical): a note → pending (blank → none); an approval made in the
  current campaign → approved; an unlock in the current campaign, or a newer note → pending. `js/ui-helpers.js`
  `pactNoteStates()` / `pactNoteItems()` in all three tools; `pact_item_note_state()` on the server.

**Tools.**
- Live Sheet `buy()` and CharGen's checkbox ask for the description after every other check has passed (browser
  `prompt()`, re-asked when blank or over 500 characters); Cancel = not bought. An approved note on a campaign character
  is kept as is when the item is re-bought.
- The note shows on the Live Sheet Character panel ("Descriptions"), the Live Sheet and CharGen 📋 Sheets, CharGen's build
  panel (under the drawbacks) and DM Console (a "Descriptions awaiting your approval" list above the cards, and a section
  on each card). Every note is `esc()`'d. A held flagged item with no note shows "needs a description" with a Write
  button (existing characters, and DM-imposed drawbacks).
- Edit is refused in both player tools when the note is approved in the current campaign; solo notes are never locked.
- DM Console: Approve on a pending note, Unlock (optional reason) on an approved one; blocked during an archived-campaign
  peek; "unsupported event type" from a server without the migration becomes "the server has not been updated…".

**Server** (`sql/migrations/2026-10-15-boon-drawback-notes.sql`, NOT applied). `dm_edit_character_log()` accepts the two
types (target must be held; approve needs a pending note; unlock needs an approved one; whitelist rebuild + campaign
stamp). `pact_enforce_item_note_lock()` (BEFORE INSERT OR UPDATE): only the campaign's DM may change approval events; on a
campaign character only its DM may change the `itemNote` events of an approved description; new notes 1–500 characters;
no inserting a campaign character carrying approvals made there. Identity by WHO writes (`is_campaign_dm`), admin
sessions exempt. Harness: `testing/scripts/creation-lock-guard-test/run-notes.sh` — 40 cases, 20 fail before (the gap),
all pass after, rollback byte-identical.

## Deploy order

The client is safe before the migration: players' notes are ordinary LOG events (no server change needed; the server
does not yet cap their length or lock them), and Approve/Unlock show a plain "server not updated" message. Apply the
migration whenever the owner is ready — before or after this client reaches `main`. Until it is applied, "locked" is
enforced by the two tools only.

## Reconciling with feat/campaign-house-rules (NOT applied either)

`2026-10-13-campaign-house-rules-server.sql` also redefines `dm_edit_character_log()` and adds the DM-family forgery guard
`pact_dm_family()` / `pact_enforce_dm_family()`. **Whichever is applied second must be rebuilt on the other:** take the
then-live `dm_edit_character_log()` and add the second migration's hunks (here: the two allow-list types and the [NOTES]
block; there: `dmHouseRules` and `pact_next_seq()`); add `dmApproveNote` and `dmUnlockNote` to `pact_dm_family()`'s list
of DM-only types (already covered by its truthy-`dmEdit` rule, but the list is meant to be complete); keep
`pact_enforce_item_note_lock()` (the DM-family guard does not freeze the player's `itemNote` events); and point the second
migration's rollback at the first one's definitions.

## Known gaps

- A solo character is unchecked on insert and joining a campaign does not compare its log, so hand-crafted approvals
  stamped with a campaign's id can arrive with it. Effect: only that player's own note looks approved and is frozen for
  them; no AP moves. Same class as the house-rules migration's residual.
- CharGen's Randomise/New rebuild the log and drop note events; on a campaign character with approved notes the save is
  refused (as it already is for other DM events).
- The prompt is the browser's own single-line `prompt()`, consistent with the tools' alert/confirm purchase questions.
  A multi-line editor is a possible follow-up.
- An approval is an undo barrier (like every DM edit): the player cannot undo past it.
- Blast radius not measured (no database access this session); expected 0 rows carrying the new event types — the
  migration header has the query.

## Why no rules-version bump

`compute()` and the economy never read a note or `DATA.notePrompts`; nothing a character can do or costs changes.
