# Plan — CharGen records a purchase made AFTER the lock as an in-play purchase (B2)

> **Status: APPROVED — owner answers in §7; phase 1 in progress.** Written 2026-10-04. Task: `fix/chargen-post-lock-purchases` (NEXT
> board). This is owner decision **B2** from the roll "Accept" discussion; the Accept button itself
> (`feat/roll-lock-then-spend`) depends on it. Related: `docs/plans/2026-10-04-chargen-creation-ceiling.md` §8, the restart
> note's follow-up list ("CharGen edits patch slots in place after the lock"), `fix/no-purchase-refunds`.

## 1. The bug, observed

Probe, 2026-10-04, real browser, CharGen: set Hit Dice 3, **Finish creating**, then set Hit Dice 4.

| | Event | Cost |
|---|---|---|
| after the lock | `seq 10 · buy · patch · "Hit Dice & Proficiency" · hd 3` (before the lock at seq 11) | 5 |
| after HD 3 → 4 | the **same** event, seq 10, rewritten to `hd 4` — still **before** the lock | 8 |

No new event, no in-play price, no gold/downtime stamp, and the *creation* history was rewritten.

**Why.** `replacePatchSlot()` replaces a slot's event **in place** on purpose (keeps the ledger readable pre-lock; see its own
comment on `fix/species-pack-not-charged`). That is right while creating and wrong afterwards. 19 patch slots work this way
(`PATCH_SLOTS`: identity, stats, hdProf, economy, languages, attunement, ki, sorcery, armour, weaponProf, appearance,
houseRules, customProfs, freeSub, traditions, names, vigor, innate, misc). Flat categories (skills, boons, feats, arts…)
already go through `emit()` as appended events and are not the problem.

**Compare Live Sheet.** It never edits history: every purchase is `buy(cat, payload)` → one **appended** event of a
fine-grained category (`hd`, `abil`, `armour`, `wprof`, `language`, `vigor`, …; the engine's `MUT` table) carrying `cost`, `level`
and, when the campaign economy charges, a frozen `gp`/`days`. Undo steps back one purchase. Lock integrity (and the server's
`pact_enforce_locked_history`) assume exactly that shape.

## 2. Goal and non-goals

**Goal.** For a **locked** character, an edit made in CharGen that *adds* something is recorded the way Live Sheet would
record it: appended after the lock, in-play priced, gold/downtime stamped when the economy charges (owner decision Y1a),
one undo step per purchase, creation history untouched.

**Non-goals.** Any pre-lock behaviour (unchanged, byte for byte). Pricing rules (no `DATA.version` bump expected). The
server (the guard already protects lock entries). The Accept button and the roll's in-play remainder (phase 4 below,
after this lands).

## 3. Design

**Where.** One branch in `replacePatchSlot()`: if the character is locked, hand the slot to
`_cgPostLockSlotEdit(slot, newPatch)` instead of replacing in place. Pre-lock path untouched.

**What it does, per edit.**
1. Diff `newPatch` against the slot's *current folded value* (`readBuild()`), field by field.
2. Each **increase** becomes the matching fine-grained purchase through the *same* mutation vocabulary Live Sheet uses
   (`MUT` categories), appended with `commitHistory()` first (so undo is one step per purchase), priced as the
   `compute()` delta of the real folded log (not by re-implementing prices), legality-checked with the same `legalCheck`
   path Live Sheet calls, gold/downtime stamped by the economy helpers CharGen already imports
   (`_engineEcon.purchaseCost`/`chargesGoldAndTime`; CharGen already renders "· N gp · M days in play").
3. Each **decrease** is **refused** with a plain message ("Nothing you've bought can be removed once creation is
   finished"). This is the owner's rule from `fix/no-purchase-refunds` applied to the form, and it is what stops CharGen
   being a refund route.
4. Slots that carry no AP (appearance, names, free text) keep editing in place — they are labels, not purchases.

**Mapping (phase 1 = the first two rows; the rest follow the same shape).**

| Slot | Post-lock event(s) |
|---|---|
| `hdProf` | `hd` (`to: N`), `prof` (`to: N`) |
| `stats` | `abil` (`ab`, `to`) per raised score |
| `armour`, `weaponProf`, `languages` | `armour`/`wornArmour`, `wprof`, `language` |
| `vigor` | `vigor`, `grit` |
| `traditions` | `rank`, `slot`, `known`, `cantrip` per added item |
| `attunement`, `ki`, `sorcery`, `innate`, `customProfs`, `freeSub` | their `MUT` equivalents |
| `identity` (species / origin class) | **refused** (the server already freezes species once sealed; creation-only) |
| appearance / names / houseRules / economy / misc | in place (no AP) or DM-only |

**Parity guarantee (the main safety net).** A differential test builds the *same* purchase twice — once through CharGen's
new path, once through Live Sheet's `buy()` — and asserts the appended event has the same `cat`, `payload`, `cost`,
`gp`/`days`, and that the two logs fold to byte-identical builds. If CharGen's result ever differs from Live Sheet's, the
test fails.

## 4. Phasing (one PR each)

1. **Infrastructure + `hdProf` + `stats`.** The branch, the diff helper, refusal of decreases, the parity test. These two
   slots are what the roll's remainder needs and what the probe broke.
2. **Remaining priced slots** from the table.
3. **Hardening:** reload/restore of a log with post-lock events, cloud round-trip, the Live Sheet opening a CharGen-made
   post-lock log (handoff), `fix/no-purchase-refunds` interplay.
4. **The Accept button** (`feat/roll-lock-then-spend`): lock, then drive the roller's remainder through this path.

## 5. Risks

- **Highest:** mapping a *slot diff* back to the right fine-grained events. A slot can change several fields at once
  (stats edits several abilities; traditions adds a rank and slots together). Mitigation: phase 1 covers the two simplest,
  most common slots first and proves the parity test before the others are touched.
- **Price drift between tools.** Mitigated by pricing as the `compute()` delta and by the differential test above — never
  by a hand-copied price table.
- **Undo.** Each purchase is its own frame, and the lock stays the undo wall (`undoFloor`), so undo steps back through the
  in-play purchases one at a time and stops at the lock. The owner marked this "maybe": confirm when phase 1 is in hand.
- **A locked character edited in CharGen today** (the interim, wrong, in-place behaviour) may already carry rewritten
  creation events. Measured 2026-10-04: all six campaign characters are locked; this plan does not repair them (that is
  the separate live-log repair, which should move their locks to the agreed points first).

## 6. Open questions for the owner (not decided)

- **A. Decreases after the lock — refuse (recommended)** or allow with no refund? Refusing matches the "nothing bought can
  be un-bought" rule; allowing-with-no-refund would let a player drop something they paid for at no benefit, which only
  creates confusion.
- **B. Phase 1 scope — `hdProf` + `stats` only (recommended)** versus all priced slots in one PR. The first is reviewable;
  the second is a large diff in a ~600 KB file.
- **C. Should CharGen simply be read-only for purchases after the lock** (the player advances in Live Sheet, which already
  does this correctly) instead of gaining this path? That is far less code, but it changes what CharGen is for after
  creation and it cannot serve the roll's automatic remainder. **Recommendation: build it** — the owner chose B2 knowing
  the cost, and the Accept button needs it — but this is the cheaper alternative if the scope worries you.

## 7. Owner answers and the server side (2026-10-04, later)

- **A (decreases after the lock): refuse.** **B (phase 1): `hdProf` + `stats` only.** **C: build it** (B2 stands; CharGen does
  not become read-only after the lock).
- **D2 (owner):** the server freezes everything **before the lock** for a campaign character — no change, removal or
  reordering of events before the lock; events after it can still be added, and undone before they are saved. Closes review
  finding H3 and turns CharGen's old in-place rewrite from a silent history change into a visible refusal.
- **E1 (owner): priced `patch` events freeze completely** once a character is locked or has an award/seal — content, stamped
  cost, position and existence. Found 2026-10-04: `pact_ap_ledger_protected()` excludes every `cat = 'patch'` purchase, so
  after an award a player can lower Hit Dice, strip armour proficiency, change a stamped cost to 0 or delete the event
  (proved on the Docker copy of the live rules). Priced patch slots: stats (already ratcheted), hdProf, languages, armour,
  weaponProf, vigor, traditions, ki, sorcery, attunement, innate, customProfs, freeSub. No-AP slots (appearance, names) stay
  editable.
- **Staging.** The server rule for a slot goes live only when CharGen can buy that slot the proper way, otherwise it would
  refuse legitimate edits: phase 1 → freeze `hdProf` + `stats`; phase 2 → the rest. D2 (freeze before the lock) goes live
  with phase 1. **Both come after the Amble repair** (`docs/plans/2026-10-04-amble-lock-repair.md`), or they would freeze
  Caspian's refund and Skylar's post-lock rewrites in place.
- **Why the Caspian refund got through:** it was recorded as a priced `patch` event *after* the automatic lock and *before*
  any award; the server's freeze only starts at the last award/seal and never covered patch events.

## 8. Phase 1 — built (2026-10-04)

Shipped on `fix/chargen-post-lock-purchases` (stacked on `refactor/engine-priceof`, PR #564). Slots: `hdProf` and `stats`.

- **Prerequisite found and done first.** The Live Sheet's pricer (`priceOf` + `_CTX_PRICERS`, with the HD-gate "what this
  level-up legalises" correction) lived **only in the tool file**. It moved verbatim into `js/engine.js` as `priceOf(cur, cat,
  payload)`; a frozen copy of the original is compared with the engine over 5,720 purchases, and the test was proven to go red
  under mutation. CharGen now prices through the same function.
- **Behaviour.** Raising appends `hd` / `prof` / `abil` purchases after the lock (one per die / point step, +2 at a time for
  abilities), stamped `gp`/`days` when the economy charges; lowering is refused; an unaffordable or rules-breaking edit is
  refused whole, before anything is appended; a multi-step edit is one undo frame and undo stops at the lock.
- **Two bugs found by the tests and fixed:** `render()` does not repaint a control from the LOG (a refused edit left the control
  showing the refused value — now `restoreFrame(snapshot)`), and a locked character's no-change write appended a zero-cost armour
  slot event whenever STR changed (now skipped).
- **Proof of parity.** A head-to-head test makes the same purchases in both tools and requires identical events and totals, with
  the economy on (25 gp / 7 days each).
- **Not in phase 1:** the other priced slots (languages, armour, weaponProf, vigor, traditions, ki, sorcery, attunement, innate,
  customProfs, freeSub) still use the old in-place path after the lock; the Live Sheet's wallet-short warning and §16 trade offer
  are not reproduced in CharGen (the charge is stamped; the player is not asked); the server freeze (`feat/server-freeze-at-lock`)
  still waits for the Amble repair.

