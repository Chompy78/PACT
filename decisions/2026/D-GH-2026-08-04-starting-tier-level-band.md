# D-GH-2026-08-04-starting-tier-level-band — starting tier is a level and a band, and an unconfigured campaign grants nothing

Status: Active

Supersedes part of `D-GH-2026-08-04-join-grant-followups` (see its addendum).

## Context

Two problems, reported by the owner reading the Players-code tooltip and not being able to tell what
their own campaign hands out.

**1. The tooltip was stale, in three places.** All three predated the join grant and described
behaviour the app no longer had — the Players-code tooltip ("with no preset AP/budget"), the invite
note ("creates a blank character with no preset AP"), and the Starting-tier tooltip ("its only effect
is to pre-fill the Creation budget box"). Each was also wrong about a second thing: CharGen's "Join
campaign" binds the character the player is **currently building**, not a new blank one.

**2. The tier model conflated two questions.** A single ratio off L1 — Prelude 0.7×, Standard 1.0×,
Veteran 1.3×, Legendary 1.6× — was really asking "what level is this character?" and "how
well-resourced are they for it?" at the same time, and answering both with one number. Off a Standard
L1 of 79 the presets are *literally* levels: 55 = L0, 79 = L1, 103 = L2, 126 ≈ L3. A DM choosing
"Veteran" was choosing "level 2" without being told so.

**3. Absent was being paid out as 79.** Covered in the superseded record; the correction is below.

## Decision

### Starting tier = level × band

Two dropdowns. **Level 0–20**, priced off the campaign's *own* budget curve using the same
`l1 + inc × (L − 1)` formula as `js/ap-by-level.js`'s `budgetLadder`, so a tuned campaign curve and the
engine's fixed ladder agree by construction rather than coincidence. Then a **band**: Gritty 0.85×,
Standard 1.0×, Heroic 1.15×.

Each level option carries its live AP figure in the label ("Level 3 (127 AP)"), recomputed when the
curve moves, so the DM never has to open the curve panel and do arithmetic to answer "how much is
that?".

**Band naming.** "Gritty / Standard / Heroic" names the campaign *tone* the DM is choosing rather than
judging the character ("weak / strong"). It also stays clear of the curve's own "Standard / Generous",
which is a different axis — how fast everyone advances, not how well-equipped a new arrival is.

**Bands are narrow (±15%) on purpose.** The old ratios spanned 0.7–1.6 because they were carrying the
level axis too. With level split out, the band only answers "relative to a normal character of this
level", and a range wider than about ±15% would just be a different level.

`rules.startingTier` becomes `{level, band, ap, custom}`. **`ap` stays authoritative** — it is what
`bind_character_to_campaign` reads server-side — with `level`/`band` recording how it was arrived at so
the panel can rebuild itself and follow the curve. Typing over the AP figure sets `custom`, and nothing
recomputes over it until a dropdown is touched again; touching a dropdown is an explicit re-derive in
the model's own terms, so it clears the override.

Old `{preset, ap}` maps across **exactly**, not approximately, because of the coincidence above:
prelude→L0, standard→L1, veteran→L2, legendary→L3, all at band `standard`. An unknown preset or
`custom` keeps the DM's number, flagged as an override.

### Absent grants nothing

`2026-08-04-join-grant-absent-means-zero.sql`. The `absent -> 79` default shipped that morning was
justified by "DM Console displays 79, so granting 0 breaks a promise the UI made". That was wrong: the
79 is a hardcoded `value="79"` on the input, and the panel is a collapsed `<details>`. A DM who never
expanded it made no choice at all.

The new panel always writes an explicit `ap` when rules are saved, so a campaign whose rules have been
saved even once is never ambiguous again — the fallback only ever applies to campaigns predating the
advancement dials.

### The grant is shown where the code is

The most-asked question about the Players code — "how much AP does this hand out?" — had its answer
three collapsed panels away. The code row now carries a live line: *"Joining with this code grants
**N AP**, once per character"*, with a link that opens the panel it comes from. It reads the **saved**
rules, not the unsaved form fields, because the code grants what the server holds; showing a pending
form value would state a number the database has not agreed to.

For a campaign with nothing saved it says so plainly — *"grants 0 AP — no starting tier has been saved
for this campaign, so players arrive unable to build anything"* — which is what makes the
absent-means-zero decision safe to ship rather than a silent trap.

## Why not the alternatives

- **Block the join when no tier is set.** Rejected: it stops a player joining over a setting they can
  neither see nor control. A visible 0 plus a DM-facing warning puts the problem where it can be fixed.
- **Write a default `startingTier` on `createCampaign()`.** Attractive, and partly achieved as a side
  effect (any rules save now writes one), but it does nothing for existing campaigns, so the
  absent-case fallback is needed regardless. Not worth a second code path.
- **Keep one dropdown, relabel it by level.** Would fix the naming without fixing the model — a DM
  wanting "level 5, slightly under-resourced" still could not say it.

## Verification

`cloud-e2e`'s bare-rules scenario is inverted to assert the new contract (0 granted, and *no*
`ap_awards` row written for a zero grant) — the check that stops the 79 default drifting back. Audit
28/0. Confirmed against live data that Amble and other campaigns with a saved `79` are unaffected, and
only the never-configured ones change.
