# D-GH-2026-10-11-lineage-spell-gates — lineage spells are gated by the PHB character level, stated per spell, and CharGen enforces it

Status: Active. Rules `v0.372` → `v0.373`. Players Guide updated in both the served copy and the `pact-guide` master.

## Context

The owner asked (2026-10-11) why a Tiefling's ability said "L3", and reported that the restriction did not work: a
Tiefling could buy Darkness in CharGen without 5 Hit Dice, and Hellish Rebuke had the same problem.

`DATA.lineageSpells[lineage]` entries were `[name, AP, n]`, and `n` did two jobs. The engine read it as a spell level
through `DATA.hdGate` (level 1/2/3 → 1/3/5 HD), and CharGen printed it as `'L'+n`. To give the lineage's last spell the
PHB's character-level-5 gate, every one of them (Darkness, Misty Step, Pass without Trace, Hold Person, Ray of
Enfeeblement — all 2nd-level spells) was stored as `n = 3`, so it was labelled "L3". The six 1st-level lineage spells
(Faerie Fire, Detect Magic, Longstrider, Hellish Rebuke, Ray of Sickness, False Life) had `n = 1` → 1 HD, i.e. no gate,
though the PHB 2024 grants them at character level 3. Enforcement: the engine warned (a hard warning); the Live Sheet
blocked via its own local copy of the `hdGate` rule (so it inherited the missing gate); CharGen did not gate at all.

## Options

- **E1** — relabel "L" as "T". Rejected: "T3" means 3 HD everywhere else (`DATA.tierHD`), but Darkness needs 5.
- **E2** — spell out the gate (owner choice), which needs the gate to be a stated number rather than a derived one.

## Decision

1. Entries become `[name, AP, true spell level, Hit Dice]`: cantrip 1 HD, 1st-level spell 3 HD, 2nd-level spell 5 HD;
   Forest gnome's Speak with Animals stays 1 HD (PHB grants it at level 1). **Prices unchanged.**
2. `js/engine.js` exports `lineageSpellHD(sp)` (stated HD; falls back to the old `hdGate` derivation for a three-element
   entry) and `lineageSpellLabel(sp)` ("2nd-level · 1/long rest · needs 5 HD"). compute()'s warning uses them; CharGen's
   picker and character sheet and the Live Sheet's buy group and sheet use them — no tool derives the gate itself.
3. CharGen greys a lineage spell below its Hit Dice exactly like a tiered racial trait (disabled unless owned, faded,
   tooltip).
4. Players Guide (§10 lineage rows): each gated spell's Tier/Band cell reads "needs 3 HD · special" / "needs 5 HD ·
   special", plus one intro sentence giving the rule.

## Why

- Same principle as `requiredHD()` (owner ruling 2026-08-27, "tier sets price, not availability"): a requirement is
  stated, not inferred from a number that also means something else.
- Blast radius measured on live data before the change: 7 characters own lineage spells, all of them only cantrips,
  so 0 characters hold a newly-gated spell below its Hit Dice.

## Open (owner's call, not changed here)

The guide prices 1/long-rest lineage spells at "1st 6, 2nd 9, 3rd 12", but the five 2nd-level lineage spells cost 12 —
the 3rd-level rate, inherited from the old "store it as level 3" workaround. Either they should cost 9, or the guide's
rule should say the lineage's last spell costs 12. Prices were deliberately left alone in this change.

Tests: `testing/scripts/lineage-spell-gates-ci.mjs` (engine against an independent copy of the PHB table, wording,
warnings, purchaseLegality, and CharGen's greying in a browser), wired into `engine-parity.yml`.
