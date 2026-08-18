# Cold review — PACT: unify the two purchase paths for subclass content

Reviewers have **no access to the codebase**. Everything needed is in this document.

## Goal

One purchase path for everything a subclass sells, so that buying a thing twice is impossible rather
than merely discouraged.

## Context — the system, in brief

PACT is a point-buy tabletop RPG. Characters spend **AP** on everything; a character is stored as an
event **LOG** of purchases, and all pricing is derived by one function, `compute()`, replaying that log.
There are 12 classes, each with 4 subclasses.

A subclass sells two kinds of thing:

- **abilities** — 192 of them, e.g. *Barbarian › Path of the Berserker › Frenzy*
- **expanded spell lists** ("bundles") — 21 of them, one per subclass that grants bonus spells

### The defect

These are sold by two independent mechanisms that do not know about each other.

| | Abilities | Bundles |
|---|---|---|
| Data | `DATA.subAbilMap`, keyed `Class\|Subclass\|Name` | `DATA.subclasses[cls][sub].spellBundle` |
| LOG field | `subAbilities` | `subSpellBundles` |
| Pricing | its own branch in `compute()` | a second branch |

**And every one of the 192 abilities is *additionally* mirrored into the general class-feature
catalogue** (`DATA.features`), 188 of them offered by the character generator's *feature* picker
alongside its *subclass* picker.

The two routes have **separate deduplication domains**. Measured on the live engine:

```
A Cleric buys "Preserve Life" through BOTH pickers:
    Class features       6
    Subclass abilities   6
    total 24    warnings: NONE
Same ability bought once: 18
→ 6 AP charged twice, for one ability, silently.
```

It also skips subclass-unlock accounting (every subclass beyond your first in a class costs a flat 15 AP
to open; the mirror route never registers one).

## Assumptions vs. verified facts

**Verified**, by querying the live dataset on 2026-08-18:

- 192 abilities in `subAbilMap`; **all 192** are mirrored into `DATA.features`; **188** appear in the
  feature picker's list. The 4 that do not are *Bard: Magical Discoveries*, *Fighter: Additional
  Fighting Style*, *Fighter: Heroic Warrior*, *Fighter: Superior Critical*.
- **The mirror never disagrees on price. All 192 match on origin price, cross-class price and tier —
  zero divergences.** This is the single most important fact in this document: unification is a
  **deduplication** problem, not a reconciliation one. No price has to be decided, and no character's
  cost should change.
- 21 bundles. Prices are stored per subclass with three tiers (origin / unlocked / cross-class).
- Circle of the Land has **one** engine bundle but **four** player-facing terrain variants (Arid, Polar,
  Temperate, Tropical), keyed in the LOG as `Class|Subclass|Terrain` — a shape `subAbilMap`'s
  `Class|Subclass|Name` cannot express without conflating a terrain with an ability name.

**Assumed** — your judgement is wanted:

- That "one path" is the right goal at all, rather than "two paths that share a dedup domain".
- That the saved-character format matters more than internal tidiness. PACT is pre-launch with no live
  characters, but files are already exportable and importable.

## Proposed approach

1. **Decide which mechanism survives.** The board calls this "the call that makes the rest mechanical",
   and this review exists mainly to test it. Three candidates:
   - **(a) Everything becomes a subclass purchase.** Bundles stay where they are; the 192 mirrors are
     removed from `DATA.features` and the feature picker stops offering them.
   - **(b) Everything becomes a feature.** `subAbilMap` and `spellBundle` collapse into `DATA.features`
     with a subclass tag; one LOG field, one pricing branch.
   - **(c) Keep both representations, share one dedup domain.** Smallest change: a single "already
     owned" check spanning both fields, plus a warning. Leaves the duplication in the data model.
2. **Resolve the `subSpellBundles` LOG field** — retain it as a legacy key that replays into whatever
   the survivor is, or migrate. Old exported files must still load.
3. **Resolve Circle of the Land.** The four terrains must stay separately buyable and each must still
   cost the 15 AP subclass unlock beyond the first. Either give each terrain its own entry, or keep the
   terrain as a parameter of one purchase.
4. **Close the double-charge** with a regression fixture that buys the same ability through both routes
   and asserts one charge.

## Components involved

- The rules dataset (`subAbilMap`, `subclasses[…].spellBundle`, `features`, `featureList`).
- The pricing function's two subclass branches, and the log-replay mutators for both fields.
- Both tools' pickers (a *feature* picker and a *subclass* picker in the character generator).
- The saved-character format and its import path.
- The fixture set: 37 parity fixtures, plus a tool-pricing gate.

## Out of scope

- **Any price change.** Prices are verified identical across the mirror; this refactor must move no
  character's cost. A diff in `compute()` output for any existing fixture is a bug in the work, not a
  finding.
- The class-unlock price (settled 2026-08-18: flat 8 AP).
- Whether cross-class subclass purchases should be gated (settled: no; a gate was removed the same day
  precisely *because* the mirror let players bypass it).

## Alternatives considered

- **Do nothing.** The double-charge needs a player to use both pickers for the same ability, which is
  unlikely but silent when it happens. Cheapest, and it leaves a known way to lose AP with no warning.
- **Warn instead of dedup.** One line of code. But PACT's convention is that warnings do not change
  prices, so the player still pays twice.

## Risks

- **The saved-character format is the real hazard.** Everything else is internal. A migration that
  silently drops a purchase is exactly the failure this project has already hit once, with renamed
  feature keys (fixed 2026-08-18 with an alias map after two keys were removed with no migration).
- **No gate covers the pickers or LOG round-tripping.** The parity and pricing gates catch price drift;
  nothing catches "the picker no longer offers this" or "the file no longer loads". New coverage is part
  of the work, not a follow-up.
- Option (b) is the tidiest data model and the largest blast radius.

## Verification

- The parity gate reports **0 failed**, with **no fixture total changing** — that is the specific
  assertion, not merely "still passes".
- A new fixture buys the same ability through both routes and is charged once.
- A saved character exported before the change loads after it, with an identical total.
- The character generator still offers every ability it offered before: 188 in the feature picker or
  192 in the subclass picker, depending on the option chosen — the count is an explicit check, not an
  eyeball.

## Done when

One representation is authoritative, buying the same thing twice is impossible rather than
discouraged, old files still load at unchanged cost, and a fixture proves it.

---

## Reviewer instructions

**Begin your response with your model name and any relevant settings**, on the first line.

Judge **logic, clarity, scope and risk** — not code correctness, which you cannot verify from this text.

1. **Which of (a), (b) or (c) would you choose, and why?** This is the question the plan exists to
   answer. (c) is the smallest change and leaves the data model duplicated; (b) is the tidiest and
   touches the most.
2. **Is "one path" even the right goal?** The two things being unified — an ability and an expanded
   spell list — are arguably different in kind. Is a shared dedup domain (option c) the honest answer?
3. **What is the riskiest step**, and is the plan's ordering right?
4. **What's missing?** In particular: is there a failure mode in the saved-character migration this plan
   has not named?
5. **Is the verification section objectively checkable** by someone who did not write it?
6. **Should this split into multiple changes?** If so, where is the seam?

Also: the fact that **all 192 mirrored abilities already agree on price** is doing a lot of work in this
plan — it is why this is framed as deduplication rather than reconciliation. If you think that
conclusion is load-bearing in a way it should not be, say so.

Output your response as a Markdown file named
`subclass-purchase-unify-review-<your-model-name>.md`.

---

## Review outcome

*(to be filled in after the round returns)*
