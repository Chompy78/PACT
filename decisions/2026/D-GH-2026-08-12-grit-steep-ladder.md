# D-GH-2026-08-12-grit-steep-ladder — Grit moves onto the Steep ladder (Nth purchase = 2N)

Status: **Active**, 2026-08-12. Rules **change** (owner). `DATA.version` v0.342 → v0.343.
Supersedes the pricing half of `D-GH-2026-08-05-grit-ladder-correction` (its level-independence half
stands unchanged and is preserved by this change).

## Context

`D-GH-2026-08-05-grit-ladder-correction` fixed Grit being priced by the character's *tier* (so it got
more expensive as you levelled) and re-indexed it by *purchase number*, using the owner's stated ladder
`2/4/6/9/12/15/18` with a `m*(m+1)` extrapolation past the seventh entry. That was correct as of that
date and matched the Players Guide.

On 2026-08-12 the owner decided Grit should instead run at a flat **2 × N for the Nth purchase** —
"the steep curve" — and had already finalised that change on the guide side.

A bug brief circulated claiming the ladder was already *supposed* to be 2N and citing three sources.
Investigated before acting: two of the three said the opposite (the 2026-08-05 decision record quoting
the owner's own `4:9`, and the Players Guide's printed *"Situational by tier — 2 / 4 / 6 / 9 / 12 / 15 /
18"*), and the third — an "independent Python re-implementation" — turned out to be
`pact-guide/py/pricing.py`'s `metamagic_ap()`, which is the Steep ladder but prices **Metamagic**, not
Grit. There is no Grit pricing function anywhere in that Python model. So the brief reached the right
destination by the wrong route; this change is made on the owner's decision, not on the brief's evidence.

## Options

- **A1 — keep `2/4/6/9/12/15/18` + quadratic tail.** Status quo. Steeply discourages stacking Grit; a
  12-Grit character pays 226 AP before the CON-mod surcharge.
- **A2 — flat 2N (Steep).** Cheaper past the third purchase and strictly linear per purchase; the same
  12-Grit character pays 156.

## Decision

**A2.** `_gritPrice(n)` is now `2 * n`. `_GRIT_LADDER` and the `m*(m+1)` extrapolation are deleted.

## Why

1. **Owner's call on game balance** — Grit stacking should not be punished as hard as the old curve did.
2. **"Steep" is this project's own name for exactly this ladder.** `pact-guide/py/pricing.py:70` defines
   `metamagic_ap()` as `sum(2*n …)` with the comment `# Steep: 2,4,6,8...`, and
   `py/catalog.py:329` carries `# Ladder (Steep) 2/4/6/8/10/12…`. Adopting it for Grit reuses an
   established name rather than inventing a shape.
3. **It makes Grit consistent with every other track in `DATA`.** Every other ladder escalates *linearly
   per purchase* (cumulatively quadratic): `attune` steps 4/6/8/10…, `expertise` 5/6/7/8…, `mastery`
   2/3/4/5…, `rankCum` 5/6/7/8…, `slotSticker` 4/6/8/10…. The old Grit tail was *quadratic per purchase*
   — cubic cumulative — and was **the only track in the game shaped that way**. This removes an outlier
   rather than creating one.
4. **It deletes a whole class of bug.** 2N is defined for every N, so there is no seven-entry table to
   run off the end of and no extrapolation branch to get wrong. The function is one line.

## What is NOT changed

- **The flat +1 surcharge per purchase past the CON modifier stays**, exactly as
  `D-GH-2026-08-05-grit-ladder-correction` established it (`_gritPrice(n) + (n > vgcap ? 1 : 0)`).
  Separate rule, separately confirmed by the owner, untouched here.
- **Level-independence stays.** Grit still does not read `tier` — the property the 2026-08-05 correction
  existed to establish. CG-010/CG-011 continue to pin it (same Grit line at HD 1 and HD 9).
- **Vigor is untouched** and remains deliberately tier-locked. The two are priced on different principles
  on purpose; they should not be tidied into a shared helper.

## Migration — none needed

Verified against the live Supabase database before making the change: **23 characters exist and not one
has a single Grit purchase** (`select … where stats::text like '%tough%'` returns 4 rows, all with zero
Grit events). No repricing, no grandfathering, and nothing added to `fix/ledger-reconciliation-pass`'s
scope. This was as clean a moment to change Grit pricing as the project will get.

## Test coverage

`testing/expected/expected-results.csv` updated in the same change: CG-010 165 → **135**, CG-011
197 → **167**. Verified the entire 30-AP delta is the Grit line and nothing else — CG-010's full ledger
is now `Ability scores 16 + Hit Dice 2 + Grit 117 = 135`, where 117 = `2×(1+…+10)` = 110, plus the flat
+1 on the 7 purchases past CON mod 3. `engine-parity-ci` **30/0**, `tool-pricing-ci` **134/0**.

## Outstanding — the guide, and version drift

The Players Guide is maintained in a **separate project** (`pact-guide` on the home server), and its 2N
change was finalised there before this one landed. Two follow-ups came out of that:

1. **The guide's Grit table must be confirmed to match this.** The copy readable at the time of writing
   (`PACT-Players-Guide-v0.332.html`) still showed the *old* ladder, so the finalised 2N text is
   somewhere not yet located. Until that is reconciled, treat `js/engine.js` as authoritative per
   `AGENTS.md`.
2. **`pact-guide` mirrors `DATA.version` by hand and it has drifted repeatedly** — four different values
   across four files (v0.332 / v0.333 / v0.336) against this repo's v0.342, plus a fossilised
   `BUILD: v0.107` from before the v1.x scheme. Agreed fix (owner, 2026-08-12): the guide stops carrying
   copies, declares a single `documents-rules:` pointer stamped automatically at generation time from the
   public `engine-data.js`, and gets its own independent doc revision. Tracked separately; not part of
   this change.

## Related

- `decisions/2026/D-GH-2026-08-05-grit-ladder-correction.md` — superseded on pricing, upheld on
  level-independence.
- `pact-guide/py/pricing.py` — the "Steep" ladder naming precedent.
