# Handover prompt — land the 2026-08-27 Fortune-boon changes in `js/engine-data.js`

**Give this whole file to the AI working in the PACT web-tools repo (`chompy78/pact`).**
Source of the change: `PACT-guide`'s `DECISIONS.md`, entry
`D-2026-08-27-heroic-inspiration-fortune-family`. Guide `content-version` is now **v0.334**;
engine `DATA.version` was **v0.342** when these values were read.

---

## What you are doing

The PACT Player's Guide has been changed. `js/engine-data.js` has not. Until it is, the guide and the
engine disagree on 25 rules-carrying values — a live rules bug with a player audience. Your job is to
make `js/engine-data.js` match the guide exactly, bump `DATA.version`, and stop.

**Do not** edit `PACT-guide/py/vendor/engine/` (a sync snapshot, refreshed by re-running the sync) or
`PACT-guide/py/generated/engine-prices.json` (generated). Do not "improve" any value below — every
number is a settled design decision, not a suggestion.

Boon schema, for reference:
`{"hd": <int>, "ap": <int>, "fx": "<string>", "cat": "<category>", "minStats"?: {"STAT": <int>}, "minStatsAny"?: {"val": <int>, "stats": ["STAT","STAT"]}}`

---

## 1. New category value: `"Fortune"`

Eight boons move to a new `cat` value, `"Fortune"`. Existing values are Combat, Defence,
Skill & Utility, Social, Magic, Wild & Story, Epic.

**Check every consumer of `cat` before you finish** — any UI that renders boon categories from a
hard-coded list, any filter, any ordering array, any switch statement. A new category that no renderer
knows about will silently drop eight boons from the character builder. In the guide it sits between
Magic and Wild & Story.

After this change: Magic has 7 boons (all genuinely Spellcasting-Foundation-gated), Wild & Story has 4,
Fortune has 8. Non-Epic boon total stays 80.

## 2. Four new boons

```json
"Defiant Spark":        {"hd": 3, "ap": 9,  "cat": "Fortune", "fx": "You may expend Heroic Inspiration to reroll one attack roll or damage die rolled against you; the roller must use the new roll."},
"Twin Flame":           {"hd": 5, "ap": 11, "cat": "Fortune", "fx": "When you expend Heroic Inspiration to reroll, roll two dice and use the better result."},
"Rising to the Moment": {"hd": 5, "ap": 9,  "cat": "Fortune", "fx": "If you have no Heroic Inspiration, gain 1 when you roll a natural 1 on a d20 test or fail a death saving throw."},
"Undying Ember":        {"hd": 9, "ap": 14, "cat": "Fortune", "fx": "If you have no Heroic Inspiration, gain 1 at the start of each of your turns in combat while at or below a quarter of your hit point maximum.", "minStats": {"CON": 14}}
```

**`DATA.boonList` must gain all four names too.** It is a parallel array of every boon name (88
entries today, 92 after this) and is what the UI iterates. A boon added to `DATA.boons` but not to
`boonList` exists in the data and renders nowhere. Insert them wherever the array's existing ordering
convention puts them.

## 3. Changed boons

| Boon | Field | From | To |
|---|---|---|---|
| Renewed Fire | `fx` | `At the end of every short rest, gain 1 Heroic Inspiration.` | `If you have no Heroic Inspiration, gain 1 at the end of every short rest.` |
| Renewed Fire | `cat` | `Magic` | `Fortune` |
| Blazing Moment | `hd` / `ap` / `cat` | 9 / 14 / Magic | **5 / 9 / Fortune** |
| Touched by Fortune | `cat` | `Skill & Utility` | `Fortune` |
| Coincidence | `cat` | `Wild & Story` | `Fortune` |
| Unkillable | `ap` | 14 | **13** |
| Unkillable | `fx` | `...drop to 1 instead and stand if prone. You then gain one level of exhaustion.` | `Once per long rest, when you would drop to 0 HP, drop to 1 instead and stand if prone. You gain resistance to all damage until the end of your next turn.` |
| Unkillable | `minStats` | `{"CON": 14}` | `{"CON": 18}` |
| Indomitable Spirit | `ap` | 14 | **13** |
| Indomitable Spirit | `minStatsAny` | `{"val": 14, "stats": ["CON","WIS"]}` | `{"val": 16, "stats": ["CON","WIS"]}` |
| Avatar of Resolve | `minStats` | `{"WIS": 14}` | `{"WIS": 18}` |
| Martyr's Resolve | `ap` | 10 | **7** |
| Commanding Aura | `ap` | 10 | **9** |
| Inspiring Word | `ap` | 7 | **6** |
| Resolute Caster | `ap` | 7 | **6** |
| Truesight Flicker | `ap` | 7 | **6** |
| Font of Will | `ap` | 8 | **11** |
| Beast-Bonded | `ap` | 10 | **12** |

`Avatar of Resolve` keeps `ap: 13`. `Renewed Fire` keeps `ap: 10`.

## 4. Boon prerequisites are guide-only — do NOT invent a field

The guide gates five of these on owning another feature: Defiant Spark, Twin Flame, Rising to the
Moment and Renewed Fire on **Feature: Resourceful** (the Human `Heroic Inspiration` racial trait), and
Blazing Moment and Undying Ember on **Feature: Renewed Fire**.

The boon schema has no prereq field and no boon currently carries one. **Leave it that way** unless you
are separately asked to add prereq support. If you do add it, it is a schema change affecting all 88
boons and needs its own decision entry — not a silent addition buried in this sync.

## 5. Bump the version

`DATA.version` was `v0.342`. Bump it once, here, in the engine. The guide never carries a rules
version. After you land this, the guide side runs `py/tools/stamp_guide_rules.mjs` to stamp its
`documents-rules:` pointer at your new version — that is a separate, deliberate act, not something you
do.

---

## 6. Racial and boon corrections — the ENGINE is wrong here, not the guide

Writing this sync turned up pre-existing disagreements between the guide and the engine. All were put to
the guide's owner and **the guide is correct on every one**; `js/engine-data.js` is what changes.

The heritage-pack ones are a single systematic bug, not three coincidences. Every pack costs 5 AP, and
in the guide every pack contains 7-10 AP of a-la-carte trait value. The engine breaks that on exactly
three species, each time by marking `pack: true` on a trait the guide sells separately:

| Species | Guide in-pack value | Engine | Offending trait |
|---|---|---|---|
| Dwarf, Halfling | 7 | 7 | — |
| Gnome, Tiefling, Aasimar | 10 | 10 | — |
| Goliath | 8 | 8 | — |
| **Elf** | 7 | **12** | `Fey Ancestry` |
| **Orc** | 8 | **13** | `Relentless Endurance` |
| **Dragonborn** | 10 | **13** | `Breath Weapon` |

Fixing all three brings every species back into the 7-10 band. Each fix needs **two** edits: the
`pack` flag on the racial entry, and the species' `DATA.packBasics` display string, which names the
trait as pack contents and would otherwise keep telling players it is included.

### 6a. `Orc: Relentless Endurance` — remove from the heritage pack, and reprice

It is **not** in the Orc heritage pack. Its price also changed this session from `T1 Per-Rest` 3 / 4 to
`T1 · special` **6 / 7** — deliberately off-grid, because the effect outruns any T1 band (there is no
T1 band worth 6; `MASTER[1]` is `[2,3,4,5,12]`).

```json
"Orc: Relentless Endurance": {"race": "Orc", "origin": 6, "cross": 7, "band": 1, "tier": 1, "pack": false}
```

Was: `{"race": "Orc", "origin": 0, "cross": 4, "band": 1, "tier": 1, "pack": true}`

Keep `band: 1, tier: 1`. An explicit `origin`/`cross` that deviates from the `MASTER` grid is an
existing, supported convention — see `Dragonborn: Larger breath dice` (origin 4, grid 3),
`Aasimar: Celestial Revelation` (7, grid 8) and `Goliath: Large Form` (10, grid 11). **Confirm the
pricing code reads the stored `origin`/`cross` and does not recompute from `tier`/`band`**; if anything
derives the price from the grid, this trait will silently revert to 3.

**`DATA.packBasics.Orc` must change too.** It is the display string listing what the pack contains, and
it currently names this trait:

- From: `"Darkvision 120ft; Relentless Endurance (drop to 1 HP, 1/long rest); Adrenaline Rush (Dash as bonus + THP, Prof. Bonus uses/short-or-long rest)"`
- To:   `"Darkvision 120ft; Adrenaline Rush (Dash as bonus + THP, Prof. Bonus uses/short-or-long rest)"`

Leaving it would keep telling players the pack includes a trait they now have to buy.

**Player-facing consequence, intended:** an Orc currently gets Relentless Endurance free inside the
5 AP pack. After this they pay **6 AP** for it on top of the pack. `DATA.pack.Orc` stays **5** — the
pack price is a flat per-species value, not derived from how many traits it contains, so do not adjust
it. The Orc pack simply contains one fewer trait for the same price.

### 6b. `Orc: Adrenaline Rush` — wrong tier, and missing its cross price

The guide has it at **T1 Per-Rest, 3 / 4, in pack**. The engine has it at tier 2 with no cross price.

```json
"Orc: Adrenaline Rush": {"race": "Orc", "origin": 0, "cross": 4, "band": 1, "tier": 2 -> 1, "pack": true, "tb": "T2 Per-Rest" -> "T1 Per-Rest"}
```

Change `tier` 2 to **1**, `tb` to **"T1 Per-Rest"**, and `cross` from `null` to **4**. Keep
`pack: true` and `origin: 0` — that is the stored convention for pack traits (cf. `Orc: Darkvision
120 ft`, `origin: 0, pack: true`), with the guide's Origin column showing à-la-carte worth derived from
`tier`/`band`. With `tier: 1, band: 1` that derives to 3, matching the guide. `cross: null` currently
reads as "not cross-buyable", which is wrong — the guide lists it at 4.

### 6c. `Elf: Fey Ancestry` — remove from the heritage pack

```json
"Elf: Fey Ancestry": {"race": "Elf", "origin": 5, "cross": 6, "band": 3, "tier": 1, "pack": false}
```

Was `origin: 0, pack: true`. With `pack: false` the trait needs its real a-la-carte price, and
`tier 1 / band 3` derives to 5, matching the guide.

- `DATA.packBasics.Elf` from: `"Darkvision 60ft; Fey Ancestry (adv vs charm, no magic sleep); Trance (rest in 4 hours)"`
- to: `"Darkvision 60ft; Trance (rest in 4 hours)"`

**Consequence, intended:** Elves start paying 5 AP for Fey Ancestry instead of getting it free in the
pack. `DATA.pack.Elf` stays 5.

### 6d. `Dragonborn: Breath Weapon` — remove from the heritage pack

```json
"Dragonborn: Breath Weapon": {"race": "Dragonborn", "origin": 3, "cross": 4, "band": 1, "tier": 1, "pack": false}
```

Was `origin: 0, pack: true`. `tier 1 / band 1` derives to 3, matching the guide.

Note `Dragonborn: Larger breath dice (L5/L11/L17)` each carry
`"reqRace": "Dragonborn: Breath Weapon"` — check that prerequisite still resolves once the base trait
is a separate purchase rather than a pack inclusion.

- `DATA.packBasics.Dragonborn` from: `"Darkvision 60ft; Breath Weapon (base dice); resistance to ancestry damage type"`
- to: `"Darkvision 60ft; resistance to ancestry damage type"`

**Consequence, intended:** Dragonborn start paying 3 AP for Breath Weapon. `DATA.pack.Dragonborn`
stays 5.

### 6e. `Unbowed` (boon) — restore the missing clause

The engine's `fx` is missing a sentence the guide has. The guide is right, and its 7 AP price is what
proves it: with the clause it is a T1 Passive (class origin 5) at the standard +2 premium; without it,
it would be a Situational or Per-Rest effect worth 4-6, and 7 would be an overprice. Do **not** change
the price.

- `fx` from: `"When you drop to 0 HP but are not killed outright, immediately make one death save with advantage."`
- to: `"When you drop to 0 HP but are not killed outright, immediately make one death save with advantage. Further death saves are made with advantage."`

## 7. Done when

- All 22 values in sections 1–3 match the guide exactly, and `DATA.boonList` has all four new
  names (88 → 92 entries).
- Every consumer of `cat` handles `"Fortune"`; no boon is dropped from any UI.
- `DATA.version` bumped once.
- All five section 6 corrections applied (6a-6e), and the pricing code verified to read stored
  `origin`/`cross` rather than recomputing `Orc: Relentless Endurance` from the grid.
- All three pack fixes done in both places — the `pack` flag AND the species' `DATA.packBasics` string.
  `DATA.pack` values unchanged: Orc 5, Elf 5, Dragonborn 5.
- Re-run the pack check: every species' in-pack a-la-carte value should now be 7-10.
- `Dragonborn: Larger breath dice` prerequisites still resolve against the now-unpacked Breath Weapon.
- Nothing in section 8 touched.

---

## 8. Out of scope — pre-existing mismatches found while verifying this sync

These are **not** part of this change and are **not** yours to fix. They predate it, they are tracked on
the guide project's board (the "Chunk 4" audit task), and each needs a human ruling on which side is
right — the two Orc rows in section 6 went that way and both were resolved in the guide's favour, but
that is not a rule you can generalise. Listed only so you do not "helpfully" reconcile them, and do not
mistake them for something this sync broke.

| Item | Engine | Guide |
|---|---|---|
| `Desperate Recovery` (boon) | "...saving throw; you must use..." | "...saving throw. You must use..." (punctuation only) |
| `Quick Patch` (boon) | "grant it 1 HP without a kit" | "grant it 1 HP, without a kit" (punctuation only) |

`Unbowed` and `Elf: Fey Ancestry` were on this list and have since been ruled on — they are now
sections 6e and 6c, and you *do* fix them.

Three further boons (`Light Sleeper`, `Ear to the Ground`, `Elemental Affinity`) differ only in curly
vs straight apostrophes. Ignore them.

Boon counts reconcile otherwise: the guide has 80 non-Epic boons, the engine 76, and the four new ones
in section 2 close the gap exactly — no orphan boon on either side.

