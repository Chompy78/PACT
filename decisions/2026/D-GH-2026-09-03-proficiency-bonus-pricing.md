# D-GH-2026-09-03-proficiency-bonus-pricing — proficiency bonus re-priced to the Premium feature benchmark

Status: **Active**, 2026-09-03. Rules **change** (owner). `DATA.version` v0.364 → v0.365.

## Context

The proficiency-bonus ladder (`DATA.profCum`, `+2→+6`, tier-locked via `DATA.profGate`) was `4/7/10/13`
per step (cumulative `0/4/11/21/34`) — a flat, step-+3 ladder the Players Guide describes as "the
dearest climb in the game." That framing didn't hold up against what the purchase actually buys: `prof`
is added to every proficient skill (doubled again under Expertise), every proficient save, spell save
DC, spell attack, cantrip/pact-slot/arcane caps, and — via each tool's manual attack-bonus field — every
weapon a character is proficient with. It is the single broadest-reaching purchase in the build, priced
as if it were narrow.

Measured against `js/ap-by-level.js`'s standard budget curve (level ≈ Hit Dice; ~96 AP earned per tier
gap, ~72 for the last, shorter stretch to the level-20 cap): the old ladder's steps cost only 4%–18% of
the AP a character earns in the window each step unlocks in — for comparison, six saving-throw
proficiencies (a much narrower effect) cost 75 AP, ~14% of a max-level character's *entire* career
budget. The HD-gate (unlock at HD5/9/13/17) was doing all the real balancing; AP price was close to
irrelevant by the time any step was reachable. Owner confirmed in conversation that most players would
buy this regardless of price, which narrows what a price revision can realistically achieve — see
Options below.

## Options

Explored in a design conversation (not a cold plan review — single-file `DATA` constant, no engine
logic change, no tool-parity risk):

- **B — modest re-steepen, same shape (step +5 flat: 6/11/16/21, cum 54).** Costs more than Saves per
  step but still only ~10–20% of a tier's income — barely more felt than the status quo. Rejected: too
  small to create a real trade-off given players will pay "regardless of cost."
- **D — income-relative, escalating delta (12/20/28/36, cum 96).** Each step 13%–50% of that tier's
  income. Rejected as the final shape: the last÷first step ratio is 3.0×, so the +6 step alone is a
  disproportionate late-game spike (50% of its window) that reads as a forced toll rather than a choice.
- **G — gentler escalation (20/22/24/26, cum 92).** Same total ballpark as D, ratio 1.3×. Good shape,
  but the numbers were invented rather than anchored to an existing price the game already charges.
- **H — flat, no escalation (23/23/23/23, cum 92).** Ratio 1.0×, simplest to state. Same objection as G:
  arbitrary numbers, no existing anchor.
- **I — anchor to `DATA.MASTER`'s Premium band (raw, no origin-class discount): 18/20/24/28, cum 90.**
  `DATA.MASTER[tier][4]` is the game's own tier×band price for a "Premium"-bracket class feature (e.g.
  `Barbarian: Rage`, confirmed byte-for-byte against the stepped-feature pricing formula in
  `js/engine.js:480`). At each of the four gates (T4/T5/T6/T7), a profBonus step now costs exactly what
  a one-time Premium feature costs at that tier — no invented curve to justify, just "this purchase is
  priced like the biggest single-feature bracket the game already has," which is a defensible floor
  given profBonus outclasses any one feature in breadth. Ratio 1.56× (between G/H and D).

## Decision

**I.** `DATA.profCum` → `{2:0, 3:18, 4:38, 5:62, 6:90}`. `DATA.profGate` (HD thresholds) unchanged — the
gate stays the primary balance lever; this only fixes the AP price being priced for a narrow purchase
when it isn't one.

## Why

1. **Anchored, not invented.** Every other option on the table picked numbers to hit a target percentage
   of tier income; I instead reuses a price the game already charges for comparable one-time power
   (`DATA.MASTER`'s Premium row), so it needs no separate justification in the Guide and can't drift out
   of sync with how Premium features are priced as that table is tuned.
2. **Price alone has a ceiling here.** The HD-gate, not AP cost, sets how early this can be bought; no
   price makes a strictly-dominant, universally-wanted purchase feel optional. I triples the total cost
   (34→90) and makes each step a real fraction of a tier's income (19%–39%) without pretending price can
   fully solve a breadth/dominance problem that a scope change (not explored here — see Status) would be
   needed to fully address.
3. **No fixture regression risk.** Every build/event fixture in `testing/fixtures/` pins `profBonus: 2`
   (the free default) — none exercises the ladder above +2, so this change is provably invisible to
   `testing/tests/engine-parity.html` / `engine-parity-ci.mjs` (confirmed: 73 passed / 0 failed,
   unchanged before and after). That is itself a coverage gap worth a follow-up fixture, not evidence the
   price change is safe in the field — just that it can't be safety-checked by the existing suite.

## Status

**Active — engine and Guide both landed and live on `main`; one stamp still outstanding.**
`js/engine-data.js` (`profCum` + `version`) landed via PR #507, promoted to `main` in PR #511
(`BUILD v1.511`). The Guide sync (PR #510) promoted to `main` in PR #513 (`BUILD v1.513`) — both
promotions carried additional, unrelated concurrent-session work; see
`docs/sessions/2026-09-05-proficiency-bonus-pricing-and-concurrent-promotions.md` for the full sequence.
The Players Guide's "Proficiency Bonus" section is now synced in **both**
copies: this repo's served `docs/PACT-Players-Guide.html` (table → `18/20/24/28` per step / cumulative
`90`; the "dearest climb... 3 AP more than the last" prose reworded to describe the Premium-band anchor
instead, since the new deltas aren't a clean arithmetic step) and the `pact-guide` master (same table/
prose, patched directly via the home-server connector — not a full-file regenerate). Verified with
`node testing/scripts/guide-price-check.mjs` and `node testing/scripts/verify-guide.mjs`: both ran clean
against this change specifically — the one pre-existing `verify-guide.mjs` FAIL (`feature prices`:
`Empowered Strikes / Self-Restoration` price-mismatch plus several unrelated ambiguous/unparsed rows) was
confirmed present on the file *before* this edit too (via `git stash`), so it is not something this
change introduced or is responsible for fixing.

**Not done:** the `documents-rules:` reconciliation marker in the Guide's head comment. Per
`docs/VERSION-SYNC.md` and `pact-guide`'s own `AGENTS.md`/`CURRENT-WORK.md`, that marker is
machine-stamped by `pact-guide/py/tools/stamp_guide_rules.mjs` and is **not yet stamped at all in either
copy** (a pre-existing gap, not one this change created) — this session had file read/write access to
`pact-guide` via the home-server connector but no ability to execute that project's own scripts, so the
stamp still needs a session with shell access to that project. Per `AGENTS.md`'s "engine AND guide" rule,
the substantive half (matching prose/numbers) is done; the provenance-stamping half is a distinct,
mechanical follow-up.

Open follow-up worth a task of its own: no fixture exercises `profBonus > 2`, so this ladder (and any
future edit to it) is invisible to the parity gate. A fixture at, say, `profBonus: 4` on a Tier-5+ build
would close that gap.
