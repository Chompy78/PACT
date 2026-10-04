# D-GH-2026-10-04-missing-arm-penalty-undefined — `Missing Arm` gets a real penalty

**Status:** DONE · display text only — **`DATA.version` not bumped**

## Context

`Missing Arm` pays **5 AP** at character creation, but its description (engine `drawbackFx` and both Players Guide copies) said
only *"Lost an arm; defined mechanical penalty."* — and nothing was defined. A player took 5 AP for a restriction that did not
exist. That is exactly the failure `D-GH-2026-08-19-drawbacks-phobias-expansion` prices against ("over-paid — real AP for a
penalty that rarely bites"), and the guide's own rule that a DM must reject a drawback that "will never bite" had nothing to
enforce against, because there was no stated penalty to bite. Production check, 2026-10-04 (a dated snapshot — re-measure rather than
quote): 50 characters, **0** hold it, so nobody's sheet changes.

## Decision

The penalty is now stated, identically, in the engine's `drawbackFx` and in **both** guide copies:

> Lost an arm. You have one hand free: no two-handed weapons, no wielding a weapon and a shield together, and somatic spell
> components need that hand free. You have disadvantage on physical ability checks where having only one arm reasonably
> matters, such as Athletics, Animal Handling or Sleight of Hand, at the DM's call. DEX cap: …

The first sentence group is the gear/casting restriction agreed on 2026-09-30. The **disadvantage on physical checks** is the
owner's addition (2026-10-04): "disadvantage on skills — all physical checks when appropriate, such as animal handling,
athletics etc". The existing DEX ≤ 12 cap and its entry condition are untouched.

## Why 5 AP still holds (checked against the engine's own prices, not assumed)

| AP | Drawback | Penalty |
|---|---|---|
| 3 | `Lame` | speed −10 ft |
| 4 | `Peg Leg` | speed −5 ft + disadvantage on Athletics and Acrobatics (unconditional, narrow) |
| 4 | `One-Eyed` | disadvantage on ranged attacks past 30 ft and sight-based Perception |
| **5** | **`Missing Arm`** | gear restrictions + broader, DM-judged disadvantage on physical checks |
| 5 | `Thin-Skinned` | −1 AC, always |
| 5 | `Slow to Mend`, `Glass Frame`, `Mute` | HP-healing / max-HP / speech penalties |
| 6 | `Leaden Reflexes` | no reactions at all |

One point above `Peg Leg` is right: its skill penalty is unconditional but covers two skills, while `Missing Arm` removes the
standard weapon-and-shield and two-hander options and adds a wider (conditional) check penalty. It is level with `Thin-Skinned`
— a one-armed fighter gives up roughly a shield's worth of defence or a heavy weapon — and below `Leaden Reflexes`.

## Two judgement calls worth recording

- **"At the DM's call" is deliberate.** "Physical checks where one arm reasonably matters" cannot be an exhaustive list, and
  pretending otherwise would invite a different dispute at the table. The named skills (Athletics, Animal Handling, Sleight of
  Hand) anchor it so it is not left entirely to taste. The cost is some variance between tables; the guide's existing rule
  that the DM approves a drawback only if it will bite is the backstop.
- **The 5 AP is fairest for a martial character** and weaker for a pure caster, whose main loss is the free hand. Not fixed by
  price — one number serves both ends, the same reasoning that gated caster-only drawbacks (`DATA.drawbackReq`). If it proves
  too soft for casters, a `drawbackReq`-style gate or a split into two drawbacks is the lever, not a repricing.

## How the two guide copies were edited

Each copy was edited **in place on its own current text** — never copied over the other, which the repo's guide procedure
forbids (the served copy legitimately differs from the master by its images, theme code and chapter-banner CSS). The master
was edited through the home-server connector with an exact-match replacement of just the short undefined-penalty phrase (the
tool refuses unless it matches exactly once), so everything after it in that cell — which may differ between the copies — was
untouched; the connector backed the previous master up automatically. `node testing/scripts/verify-guide.mjs` was run before
and after on the served copy: **identical result** (10 of 11 checks pass; the one failure, "feature prices", is pre-existing,
about *features* not drawbacks, and shows the same counts before and after).

## Left alone, on purpose

- `py/vendor/engine/engine-data.js` in `pact-guide` still carries the old phrase: it is a point-in-time vendored snapshot of this
  repo's engine data, refreshed by that project's own sync and never hand-edited. It will pick up the new text then.
- `docs/engine-data-update.json` also contains the phrase; it is a historical v0.322-era patch note, not a live source.
- The guide's `documents-rules:` stamp: set only by `pact-guide`'s stamping tool after a deliberate reconciliation.

## Verification

`engine-parity-ci.mjs` 77/0 · `version-label-ci.mjs` 10/0 · `audit.py` 0 failed · `undo-barrier-ci.mjs` 44/0 ·
`dm-unlock-drawback-ci.mjs` 30/0 · `tool-pricing-ci.mjs` 189/189 (it renders drawback descriptions in all three tools). `engine.js`
never references `drawbackFx`, so `compute()` cannot be affected — which is why there is no version bump.
