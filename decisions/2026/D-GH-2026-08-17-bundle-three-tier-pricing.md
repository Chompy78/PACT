# D-GH-2026-08-17-bundle-three-tier-pricing — §13's spell-access exemption covers the spell *economy*, not spell-*granting* features, so subclass bundles carry the ordinary cross-class surcharge

**Status:** Settled and implemented (`DATA.version` v0.350).

## Context

A subclass's expanded spell-list bundle had **two** prices, not three. `engine.js` charged
`_isO ? bundle.origin : bundle.cross` — so a character who had paid the §11 class unlock and one who
had never touched the class paid the **identical** bundle price. Unlocking bought a 0 AP reduction on
a bundle while saving real AP on that same class's abilities. Every other purchase type in PACT has
three tiers: `origin` / `sticker` (unlocked) / `cross` (= sticker + Tier).

The obstacle was a reading of §13:

> "Spell access is free of the class tax… a Foundation opens a spell list directly, and you do not pay
> the section 11 class-unlock (7 × the classes you already own) just to cast from it."
>
> "Nor does the +Tier feature surcharge ever touch a spellcasting purchase. Instead, the spell economy
> uses its own, gentler modifier: a flat ±1 AP per purchase."

Taken at face value that says a bundle — being spell-shaped — must never carry +Tier. **Three of the
four external cold reviewers reasoned exactly that way** and recommended bundles be exempt
(`docs/plans/cold-reviews/`). This session's own first analysis did too, and flagged the owner's
proposal as contradicting the guide.

That reading is wrong, and the engine had already settled it. Every spell-**granting** feature in
`DATA.features` carries the full +Tier surcharge with all three tiers:

| Feature | Grants | Origin | Unlocked | Cross | +Tier |
|---|---|---|---|---|---|
| `Bard: Magical Secrets` | spells from **any** class list | 13 | 17 | 22 | +5 |
| `Warlock: Pact of the Tome` | 3 cantrips + 2 rituals, any list | 18 | 18 | 19 | +1 |
| `Wizard: Signature Spells` | free casts of known spells | 14 | 20 | 27 | +7 |
| `Druid: Beast Spells` | casting while shapeshifted | 17 | 23 | 30 | +7 |
| `Rogue: Spell Thief` | steal a spell | 12 | 18 | 25 | +7 |

**Pact of the Tome is the exact structural analogue of a bundle** — one purchase, a fixed set of
granted spells — and it carries the surcharge. So bundles taking it is the *consistent* treatment.

The distinction §13 is actually drawing: the exemption protects the spell **economy** — Foundations,
Ranks, slots, spells known, cantrips — where a per-purchase +Tier surcharge **compounds** across
dozens of purchases into something crushing. A one-off feature that happens to grant spells is not
that, and never was.

## Options

- **AG1 — Price bundles wholly on the Tier-3 ability model**: origin = sticker − 2 (flat), cross =
  sticker + 3.
- **AG2 — Ability structure, §13's flat ±1 modifier**: origin = sticker − 2, cross = sticker + 1.
- **AG3 — Ability structure, keep the spell-list-derived origin**: origin unchanged (per-spell −1,
  floored at 1), sticker = the undiscounted spell sum, cross = sticker + 3. ← **chosen**
- **AC3 (the reviewers' position) — exempt bundles from class access and the surcharge entirely.**

## Decision

**AG3, with the ordinary Tier-3 cross-class surcharge.** A bundle now prices:

- **origin** — the per-spell derived figure, *unchanged for all 21 bundles*
- **unlocked (sticker)** — the undiscounted spell sum, which is *exactly the figure the engine already
  charged everyone non-origin*
- **cross-class** — sticker + 3, Tier 3 being where subclasses open

Life Domain: **6 / 8 / 11**. `spellBundle` gains `sticker` and `tier`; the old `cross` field becomes
`sticker`, and `cross` is the new surcharged figure.

## Why

**The double-discount hazard is what forced the data shape.** The stored `origin` already had the
spell-economy −1 baked in per spell. Folding bundles into an ability model that applies its *own*
`origin = sticker − (tier−1)` would have discounted twice. Storing the **undiscounted** sum as the
basis makes that impossible by construction — the discount can only ever be applied once, whichever
rule reads off it.

**AG3 over AG1/AG2** because a flat −2 ignores the 1 AP floor. Nine bundles (the four Paladin Oaths,
both Ranger subclasses, Stars, Land, Moon) are flat-cost *because* every spell in them already sits on
the floor — there is no discount left to give. A flat −2 hands one anyway, halving the Oaths from 4 to
2 and making Appendix J's newly-printed working wrong for all nine. AG3 changes **no** origin price and
**no** unlocked price; the only new number is the cross-class rung that didn't exist.

**Against the reviewers on AC3.** They had the guide but not the engine, and §13's wording genuinely
reads their way in isolation. The engine's consistent treatment of Magical Secrets, Pact of the Tome and
Signature Spells is the tiebreaker — and `AGENTS.md`'s own rule applies: *the shipped artifact wins over
the written guide*. The guide is what needed fixing, and now carries an explicit paragraph naming those
features, so the next reader doesn't repeat the inference.

**Incentive effect.** Unlocking Cleric (7 AP) now saves 3 AP on a domain bundle plus 4 AP on each domain
ability — it repays inside two purchases, where before it never repaid on a bundle at all.

## Consequences and follow-ups

- Guide rows needed **no** edit: a bundle now prints `Sticker (Origin)` exactly like every other feature
  row, cross-class implied by the ordinary +Tier rule.
- Both `guide-price-check` and `guide-bundle-check` needed updating for the new field shape. The former
  caught the author feeding it `sticker` where it derives `sticker = cross − tier` itself, which
  double-subtracted and reported all 26 bundle rows as mismatches — the gate doing its job.
- The **structural** half (bundles as literal `subAbilMap` entries, dropping the 192-entry
  `DATA.features` mirror) is deferred to `refactor/subclass-purchase-unify` on the NEXT board. It needs
  a LOG-migration decision and a fix for Circle of the Land's terrain variants.
