# PACT — Ki / Sorcery-Point Usage Audit (handoff for a fresh AI session)

**Purpose.** Authoritative, source-verified list of which **Monk** features spend/use **Focus (Ki) Points** and which **Sorcerer** features spend/use **Sorcery Points**, so the `needsKi` / `needsSorc` resource-gates (build v0.088) tag exactly the right `DATA.features` entries. Hand this file to the session that will apply the corrections.

**Criterion (John's words):** lock a feature behind owning ≥1 of the resource if it *"requires or can use"* that resource. This audit separates **Required** (the feature's signature use always costs the resource), **Optional** (free base use + an optional spend), **Recharge-only** (free 1/rest use + optional points to refresh the use), and **None** (passive, free, or *regains* the resource).

**Sources (2024 / 5.5e):**
- Official base classes: `http://dnd2024.wikidot.com/monk` and `/sorcerer` (full feature text, quoted below).
- Subclasses cross-checked against Roll20 D&D 2024 Compendium, dnd-wiki.org (SRD 5.2 / PHB pointers), and WorldAnvil PHB statblocks — all agree.
- PACT `DATA.features` band labels from `PACT-Players-Guide-v0.203.docx` (band: Passive / Per-Rest / At-Will / Situational) as a secondary cross-check. The Guide prices features but defers in-play mechanics to the 2024 PHB, so the official text above is the authority for "does it spend the resource."

**PACT resource model (already implemented in `compute`):**
- Ki present ⟺ `(b.ki||0) >= 1` (pool = `DATA.kiCum[b.ki]`).
- Sorcery present ⟺ Sorcerer discipline (base pool = Hit Dice) **or** bought extras: `_spTot = (hasSorcererDisc ? b.hd : 0) + b.sorcery*3 >= 1`.
- Gates: a `needsKi`/`needsSorc` feature emits `⛔ … requires at least 1 …` when the total is 0. No compute change is needed to fix tags — only the `DATA.features` flags.

---

## 1. MONK — Focus (Ki) Point usage

| PACT `DATA.features` key | Official 2024 mechanic | Spend type | Tag `needsKi`? |
|---|---|---|---|
| `Monk: Flurry / Patient Defense / Step` | Flurry = expend 1 FP; Patient Defense & Step have a free base + optional 1 FP | **Required** (Flurry) | ✅ YES |
| `Monk: Deflect Attacks` | reduce damage free; **expend 1 FP** to redirect | Optional | ✅ YES |
| `Monk: Stunning Strike` | expend 1 FP | Required | ✅ YES |
| `Monk: Hand of Healing` | expend 1 FP (free only as a Flurry substitution) | Required | ✅ YES |
| `Monk: Hand of Harm` | expend 1 FP | Required | ✅ YES |
| `Monk: Hand of Ultimate Mercy` | expend 5 FP | Required | ✅ YES |
| `Monk: Shadow Arts` | expend 1 FP to cast Darkness (also passive Darkvision/Minor Illusion) | Required | ✅ YES |
| `Monk: Improved Shadow Step` | **expend 1 FP** to lift the dim/dark requirement + strike | Optional | ✅ YES **(NOT tagged in v0.088 — ADD)** |
| `Monk: Cloak of Shadows` | expend 3 FP | Required | ✅ YES |
| `Monk: Elemental Attunement` | expend 1 FP to enter the attuned state | Required | ✅ YES |
| `Monk: Quivering Palm` | expend 4 FP | Required | ✅ YES |
| `Monk: Manipulate Elements` | PACT band = **Per-Rest**; maps to the elemental-effect/burst spend (official Elemental Burst = 2 FP). Exact PACT intent unverified in the Guide text. | Required (likely) | ⚠️ **LIKELY — confirm vs Guide** |
| `Monk: Wholeness of Body` | 2024 = roll Martial Arts die, **uses = Wisdom mod per Long Rest, NO Focus cost** | None | ❌ NO **(tagged in v0.088 — REMOVE)** |
| `Monk: Elemental Epitome` | PACT band = **Passive**; benefits apply *while attuned* (the FP was paid for Attunement) | None (own) | ❌ NO **(tagged in v0.088 — REMOVE)** |
| `Monk: Open Hand Technique` | imposes effects on a Flurry hit — **no FP of its own** (rides on Flurry) | None (own) | ❌ no (already untagged) |
| `Monk: Stride of the Elements` | passive movement while attuned | None | ❌ no (already untagged) |
| `Monk: Fleet Step` | grants a free Step of the Wind after another Bonus Action | None | ❌ no (already untagged) |
| `Monk: Physician's Touch` | passive rider that improves Hand of Harm/Healing | None | ❌ no (already untagged) |
| `Monk: Perfect Focus / Body & Mind` | Perfect Focus *regains* FP; Body & Mind = +ability scores | None (regain) | ❌ no (already untagged) |
| `Monk: Empowered Strikes / Self-Restoration` | Empowered = Force damage (passive); Self-Restoration = free condition removal | None | ❌ no (already untagged) |
| `Monk: Martial Arts die`, `Unarmored Defense`, `Unarmored Movement`, `Extra Attack`, `Evasion` | passive chassis | None | ❌ no |

**Official quotes (Monk base, wikidot):** Flurry "*expend 1 Focus Point to make two Unarmed Strikes*"; Stunning Strike "*expend 1 Focus Point*"; Deflect Attacks "*expend 1 Focus Point to redirect*"; Self-Restoration removes a condition with no cost; Perfect Focus "*regain expended Focus Points*"; Wholeness of Body "*a number of times equal to your Wisdom modifier … regain all expended uses when you finish a Long Rest*" (no Focus Point).

---

## 2. SORCERER — Sorcery Point usage

| PACT `DATA.features` key | Official 2024 mechanic | Spend type | Tag `needsSorc`? |
|---|---|---|---|
| `Sorcerer: Metamagic` | spend the option's Sorcery-Point cost | **Required** | ✅ YES |
| `Sorcerer: Sorcery Incarnate` | **spend 2 SP** to activate Innate Sorcery with no uses left | Required | ✅ YES **(NOT tagged in v0.088 — ADD)** |
| `Sorcerer: Psionic Sorcery` | cast Psionic spells by **spending SP equal to the spell level** | Required | ✅ YES |
| `Sorcerer: Bastion of Law` | **expend 1–5 SP** to create the ward | Required | ✅ YES |
| `Sorcerer: Bend Luck` | **spend 1 SP** (Reaction) to ±1d4 a roll | Required | ✅ YES |
| `Sorcerer: Elemental Affinity` | 2024 = **passive** Resistance + add Cha to one damage roll. **SP cost was removed vs 2014** | None | ❌ NO **(tagged in v0.088 — REMOVE)** |
| `Sorcerer: Warping Implosion` | free 1/Long Rest; **spend 5 SP** (no action) to restore the use | Recharge-only | ⚠️ policy (currently tagged) |
| `Sorcerer: Dragon Wings` | free 1/Long Rest; **spend 3 SP** to restore the use | Recharge-only | ⚠️ policy (currently untagged) |
| `Sorcerer: Trance of Order` | free 1/Long Rest; **spend 5 SP** to restore the use | Recharge-only | ⚠️ policy (currently untagged) |
| `Sorcerer: Clockwork Cavalcade` | free 1/Long Rest; **spend 7 SP** to restore the use | Recharge-only | ⚠️ policy (currently untagged) |
| `Sorcerer: Sorcerous Restoration` | *regains* SP on a Short Rest | None (regain) | ❌ no (already untagged) |
| `Sorcerer: Arcane Apotheosis` | lets you use Metamagic **without spending** SP | None | ❌ no (already untagged) |
| `Sorcerer: Restore Balance` | Cha-mod uses per Long Rest, **no SP** | None | ❌ no (already untagged) |
| `Sorcerer: Dragon Companion` | cast Summon Dragon free 1/rest, no SP | None | ❌ no (already untagged) |
| `Sorcerer: Innate Sorcery` | free Bonus Action, 2/Long Rest (the SP *enabler*, not a spender) | None | ❌ no (already untagged) |
| `Sorcerer: Telepathic Speech`, `Psychic Defenses`, `Draconic Resilience`, `Wild Magic Surge`, `Tides of Chaos`, `Controlled Chaos`, the four `… Sorcery` subclass markers | passive / free | None | ❌ no |

**Official quotes (cross-verified):** Psionic Sorcery "*spending a number of Sorcery Points equal to the spell's level*" (Roll20/dnd-wiki); Bastion of Law "*expend 1 to 5 Sorcery Points*" (wikidot); Bend Luck "*a Reaction and 1 Sorcery Point … add or subtract 1d4*" (dnd-wiki); Sorcery Incarnate "*spend 2 Sorcery Points*" (wikidot); Elemental Affinity 2024 "*Resistance … add your Charisma modifier to one damage roll*" — **no SP** (Roll20/dnd-wiki; "*Resistances no longer cost sorcery points*", Dungeon Mister); Warping Implosion / Dragon Wings / Trance of Order / Clockwork Cavalcade all share "*unless you spend N Sorcery Points (no action required) to restore your use of it*".

---

## 3. The one policy decision — "recharge-only" abilities

Four features are **free to use 1/Long Rest** but let you **spend points to recharge the use**: Warping Implosion (5), Dragon Wings (3), Trance of Order (5), Clockwork Cavalcade (7). They *work at 0 points*, so the only question is whether "can use" covers an optional recharge.

- **Strict reading** ("must spend to get the effect") → **do NOT tag** any of the four. (Then Warping Implosion, currently tagged, should be **removed**.)
- **Broad reading** (John's literal "can use") → **tag all four** uniformly. In PACT these are Sorcerer subclass features and the resource = the Sorcerer Discipline, so the gate mainly catches buying them cross-class with no discipline — harmless for real Sorcerers.

**Recommendation:** pick ONE and apply to all four for consistency. Either is defensible; the current v0.088 state (Warping Implosion tagged, the other three not) is the one outcome to avoid.

---

## 4. Delta vs shipped build v0.088 (apply these)

Current v0.088 tags — Monk `needsKi`: Flurry/Patient/Step, Deflect Attacks, Stunning Strike, Hand of Healing, Hand of Harm, Hand of Ultimate Mercy, Shadow Arts, Cloak of Shadows, Elemental Attunement, **Elemental Epitome**, **Wholeness of Body**, Quivering Palm. Sorcerer `needsSorc`: Metamagic, Psionic Sorcery, **Warping Implosion**, Bastion of Law, **Elemental Affinity**, Bend Luck.

**Monk:**
- ➕ ADD `needsKi`: `Monk: Improved Shadow Step` (spends 1 FP)
- ➖ REMOVE `needsKi`: `Monk: Wholeness of Body` (no Focus cost in 2024)
- ➖ REMOVE `needsKi`: `Monk: Elemental Epitome` (passive while attuned)
- ❓ CONFIRM: `Monk: Manipulate Elements` — verify against the Guide; tag if its elemental effect costs a Focus Point (recommended).

**Sorcerer:**
- ➕ ADD `needsSorc`: `Sorcerer: Sorcery Incarnate` (spends 2 SP)
- ➖ REMOVE `needsSorc`: `Sorcerer: Elemental Affinity` (passive in 2024 — SP cost removed)
- ❓ POLICY: resolve the recharge-only four uniformly (see §3). If **strict** → also REMOVE `Sorcerer: Warping Implosion`. If **broad** → KEEP Warping Implosion and ADD `Dragon Wings`, `Trance of Order`, `Clockwork Cavalcade`.

---

## 5. How to apply (mechanical)

The engine already enforces `needsKi` / `needsSorc`; only the `DATA.features` flags change. For each key, add or remove the flag inside the entry object, e.g.:
- ADD: `"Monk: Improved Shadow Step":{ … ,"needsKi":true}` ; `"Sorcerer: Sorcery Incarnate":{ … ,"needsSorc":true}`
- REMOVE: delete `"needsKi":true` from `Monk: Wholeness of Body` and `Monk: Elemental Epitome`; delete `"needsSorc":true` from `Sorcerer: Elemental Affinity`.

Apply **identically** to `PACT-CharGen-Webtool-*.html`, `PACT-Live-Char-Sheet-*.html`, and all 5 `dm-consoles/DM-Console-*.html` (the `DATA` blob must stay byte-identical across the two tools; the consoles embed the same feature entries). Then bump the build (→ v0.089), MD5-verify the 5 shared blocks, `node --check`, and re-run the gate tests (a tagged feature warns at 0 resource; an untagged one does not).

## 6. Confidence
- HIGH (multiple official 2024 sources agree): every row except `Monk: Manipulate Elements` (MEDIUM — PACT naming vs official; resolve against the Players Guide) and the §3 policy call (a design choice, not a fact).
