# D-GH-2026-10-04-wound-aliases — 15 more DM-only wounds: 8 same-effect aliases and 7 new mechanics

**Status:** DONE · `DATA.version` `v0.367` → `v0.368`

## Context

After the Wounds system shipped (`D-GH-2026-10-04-permanent-wounds`) the owner asked for "more options, even if the effect is the
same", and then whether every skill is affected by at least two drawbacks. A count of every skill name in the 94 drawback effect
texts (2026-10-04) showed **10 of 18 skills named by only one** — in each case only the Affliction for their ability:
Arcana, History, Religion, Investigation, Nature (Dull-Witted only); Insight, Medicine, Survival (Dim-Willed only);
Intimidation, Performance (Hollow only). (The count is by effect text. Stat caps such as Forgetful's INT ≤ 10 touch skills
indirectly and were not counted; an Affliction is one drawback that hits a whole ability, so it counted once.)

## Decision

Add 15 wound-only drawbacks, all `dmOnly` (DM-impose only, not on `drawbackList`), appended to the END of `DATA.drawbacks`:

- **8 aliases** — a different name and a line of flavour, with the same price, tier, place and mechanics as an existing wound:
  Crushed Leg = Lame (3), Shattered Hand and Lost Fingers = Maimed Hand (2), Burned Eye = One-Eyed (4), Ruined Hearing = Hard of
  Hearing (2), Scorched Lungs = Asthmatic (2), Cracked Ribs = Brittle Bones (2), Mangled Arm = Withered Arm (4).
- **7 new mechanics**, each 2 AP minor: Addled Memory (head: disadvantage on History, Religion, Arcana), Rattled Skull (head:
  Investigation, Nature), Scarred Throat (throat: Intimidation and Performance that rely on voice), Shell-Shocked (no place:
  Insight, and Medicine to treat a battle wound), Frostbitten Limbs (no place: Survival, and speed −5 ft in cold), Torn Shoulder (arm:
  thrown-weapon attacks and Athletics to climb), Wrenched Back (torso: carrying, push, drag and lift limits halved).

Result: every skill is named by at least two drawbacks (`wounds-ci.mjs` now pins this, with a control that the counter can fail).

## Why a separate entry per alias (and not a label on the existing drawback)

The owner chose real entries ("K2"), as well as a free-text "how it happened" line on the impose window ("K1", PR #572). A real entry
means the picker, the guide table and the buy-off list all show the injury by name. The cost is that each alias is its own drawback:
buy-off matches by name (first-in-first-out), so a character holding Lame and an imposed Crushed Leg holds two different drawbacks,
not two copies of one. Aliases share the original's `slot`, so the same-place warning still fires for them.

## Judgement calls (the owner approved the list, not these details)

1. **Effects and prices of the 7 new mechanics are new rules**, priced by analogy with `Maimed Hand` and `Bad Knee` (2 AP for a
   narrow penalty on two or three skills). `Rattled Skull` was drafted at 3 AP and set to 2 so that a two-skill penalty does not cost
   more than the three-skill `Addled Memory`.
2. **Alias text is not a copy of the original's:** each has its own flavour sentence plus the original's mechanical sentence. The
   originals' stat-cap sentences (Lame, Asthmatic) are left out because a DM-only entry can never be player-taken, so no cap applies.
3. **New places** `head` and `throat` were added; `Shell-Shocked` and `Frostbitten Limbs` have no place (like the Afflictions), so
   they never trigger the same-place warning. `Torn Shoulder` shares `arm` (now seven arm wounds) and `Wrenched Back` shares `torso`.
4. **Speed −5 ft in cold weather** (Frostbitten Limbs) and **carrying capacity halved** (Wrenched Back) lean on table adjudication;
   the engine does not compute them.

## Evidence and blast radius

The 15 names did not exist before, so no stored character can hold one: nothing existing changes. Gates: `wounds-ci.mjs` (82),
`wounds-ui-e2e.mjs` (12; its list of wound-only names is now read from the engine data), `dm-impose-picker-e2e.mjs` (60; the picker reads
`DATA`, so the new entries appear without a code change), parity 82. `verify-guide.mjs`: "drawback text" went from failing ("15 missing
from the guide entirely") to passing (103 descriptions and prices agree), in both guide copies (served copy and the `pact-guide` master,
edited in place, never copied over each other).

## Known limits

- The "at least two per skill" goal is measured by effect text; a skill-affecting drawback that does not name the skill is not counted.
- `pact-guide`'s `py/vendor/engine/` snapshot is refreshed by that project's own sync, not here.
