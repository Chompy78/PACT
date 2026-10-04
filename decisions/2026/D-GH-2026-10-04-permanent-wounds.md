# D-GH-2026-10-04-permanent-wounds — a DM-only Wounds system (minor and moderate only)

**Status:** DONE · `DATA.version` `v0.366` → `v0.367`

## Context

The owner wanted a range of drawbacks that come from permanent wounds, balanced. Through the 2026-09-30 → 2026-10-04 design
rounds this became: wounds are lasting injuries a DM **imposes in play** on campaign characters, never chosen by the player,
bought off after a recorded story beat, and only **minor (2 AP)** or **moderate (3–4 AP)** — there is no Grievous tier. It
depends on two earlier changes: an imposed drawback is exempt from stat caps and grants 0 AP
(`D-GH-2026-09-30-imposed-drawback-cap-bypass`, `D-GH-2026-10-04-imposed-drawbacks-grant-no-ap`) and a DM can unlock a locked
imposed drawback (`D-GH-2026-10-04-dm-unlock-drawback`).

## Decision

- **Four new wound-only drawbacks**, appended to the END of `DATA.drawbacks` (key order is load-bearing): `Maimed Hand` 2,
  `Bad Knee` 2, `Brittle Bones` 2, `Withered Arm` 4, each with `drawbackFx` and `drawbackCat` "Body" and no stat cap. They are
  in `DATA.drawbacks` but **not** in `DATA.drawbackList`, which is what hides them from players (drawbacks 90 → 94,
  `drawbackList` stays 90).
- **`DATA.wounds`** (19 entries) records tier, body place (`arm`/`leg`/`ear`/`lungs`/`bones`/`torso`/`face`/`eye` or none) and
  `dmOnly:true` for the four new ones. Existing drawbacks are reused (C2) and stay player-takable (G2).
- **`compute()`**: a wound-only drawback that is not DM-imposed is a hard `⛔` warning; two wounds in the same place give a soft
  warning (a DM normally imposes only one).
- **UI**: CharGen's picker hides the four unless already held; the DM Console impose dropdown is grouped (Wounds minor,
  Wounds moderate, Other drawbacks), and choosing a wound defaults to Locked + flat buy-off. Live Sheet needs no picker change
  (it reads `drawbackList`).
- **Guide**: a Wounds section in both copies (served `docs/PACT-Players-Guide.html` and the `pact-guide` master), edited in
  place, plus the nav entry. The table rows carry the engine's text and price verbatim (`verify-guide.mjs` "drawback text").

## Judgement calls (the owner did not rule on these; each is easy to change)

1. The six **Afflictions** are minor and slotless; **Frail** is moderate and slotless — no obvious body place.
2. Slots are **arm and leg**, plus ear/lungs/bones/torso/face/eye for the rest. Two wounds in one place warn but do not block
   (a hard block would stop a DM telling a story that needs both), and the warning fires **only when at least one of the pair is
   DM-imposed**, counted by position so an imposed copy of a wound the player already took still counts. Found in code review:
   firing on two player-chosen drawbacks was wrong (it told a player "a DM normally imposes only one" about their own build) and,
   because the Live Sheet blocks any purchase raising a warning not in its `SOFT_WARN` list, would have hard-blocked a player
   buying Lame while holding Peg Leg. `SOFT_WARN` now includes it. `EV-022` (imposed Peg Leg on a player-taken Peg Leg) now
   expects the extra warning.
3. A **non-imposed wound-only** drawback is a hard `⛔` rather than a soft warning, because the whole point is that players
   cannot take them.
4. Fixtures `EV-025`/`EV-026` used `Lame` twice-over with another leg wound; the new slot warning would have changed their
   expected output, so they now use `Frightening Visage` (same price, no place). New fixtures: `EV-027` (four imposed wounds,
   different places: no warnings), `EV-028` (imposed `Lame` + `Peg Leg`: one slot warning), `EV-029` (player-taken `Maimed Hand`: `⛔`).
5. `Missing Arm`, `Glass Frame`, `Slow to Mend`, `Mute` are **not** wounds (heavier), but a DM can still impose them.

## Why

Reusing existing drawbacks keeps the system small; only injuries with no good existing equivalent were added. Because an
imposed drawback pays nothing, its table value is purely the buy-off price, so 2 / 3–4 AP is a story-sized cost rather than a
refund. Hiding the new four by list membership needs no new gate in the player tools.

## Evidence and blast radius

Live check 2026-10-04 (a dated snapshot — re-measure): 50 characters, 0 DM-imposed drawbacks, none holding any reused wound,
a new wound-only entry, both `Lame` and `Peg Leg`, or `Missing Arm`. No existing character changes. Gates: `wounds-ci.mjs`
(37 assertions, 3 mutations caught), `wounds-ui-e2e.mjs` (24, CharGen filter mutation caught), engine parity.

## Known limits

- The lock/unlock is still client-honoured (`feat/server-enforced-drawback-lock`).
- `pact-guide`'s vendored `py/vendor/engine/` copy is refreshed by that project's own sync, not here.
