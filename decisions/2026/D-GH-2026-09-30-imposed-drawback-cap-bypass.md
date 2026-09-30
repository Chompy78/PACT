# D-GH-2026-09-30-imposed-drawback-cap-bypass — a DM-imposed drawback is exempt from its stat cap

**Status:** DONE · `DATA.version` **not** bumped (see Why) · first of the permanent-wounds task set

## Context

`DATA.drawbackMaxStats` caps an ability score while you hold a drawback (`Peg Leg` → DEX ≤ 12). The cap
is enforced in both directions by one check in `compute()`: a `⛔` hard warning whenever the score is
above the cap, whether you were already above it when you took the drawback or raised it afterwards.
Its purpose is stated in the engine comment: without it the drawback is a loan — take Frail at CON 10,
keep the AP, buy CON to 16.

The DM Console's "impose a drawback" (`D-GH-2026-08-10-dm-edit-events`) records the drawback at
`cost: 0`, so the player gains no AP. Verified 2026-09-30: imposing `Peg Leg` on a DEX 16 character made
`compute()` emit `⛔ Peg Leg: drawback requires DEX 12 or lower`, and the Live Sheet's `buy()` refuses
anything a `⛔` marker covers. The cap was policing a loan that did not exist.

Cause: `MUT.drawback` keeps only the drawback's name in `b.drawbacks`, so the server-stamped `dmEdit`
flag on the log event was dropped at the fold and `compute()` could not tell imposed from chosen.

## Options

- **A. Exempt by name** — a set of drawback names `compute()` never caps. Shallow. Wrong: it would also
  exempt the same drawback when a player took it for AP, reopening the loan.
- **B. Stamp the imposed purchases by position and exempt only those.** `_replay()` records the index in
  `b.drawbacks` of every `dmEdit` drawback; `compute()` skips the cap for exactly those slots.
- **C. Drop the caps from the drawbacks that DMs are likely to impose.** Changes the player-facing rule
  for everyone and removes a real guard.

## Decision

**B.** `_replay()` pushes `b.drawbacks.length` onto `b._imposedDrawbackIdx` for each `dmEdit` drawback,
just before `MUT.drawback` runs. `compute()` treats a drawback at a recorded index as uncapped. Owner
decision J1 (2026-09-30): the exemption covers **both** halves — the entry check and the going-forward
"can never exceed" ceiling — and both are one code path, so it is one skip.

## Why

- **Positional, not by name.** A character can hold a player-taken `Peg Leg` and a DM-imposed one.
  EV-022 pins this: exactly one `⛔` remains (the player's), where the pre-fix engine gave two. An
  imposed drawback must not launder a cap violation the player chose.
- **`dmEdit` is trustworthy.** `dm_edit_character_log` stamps it server-side, so a client cannot mark its
  own drawback as imposed to dodge a cap. (A player can already hand-edit their own `stats`, a
  pre-existing capability recorded in `D-GH-2026-08-10-dm-edit-events`.)
- **No `DATA.version` bump.** No rule, price or existing fixture's output changed: all 73 prior fixtures
  still match their expected values unchanged, and the two new fixtures' totals (26) are the same before and after — only the
  warning list differs, and only for a DM-imposed capped drawback. Live check 2026-09-30 (a dated
  snapshot, re-measure rather than quote): 42 characters, 11 with any drawback purchase (27 events),
  **0** DM-imposed, **0** holding any of the seven capped wound-like drawbacks.
- **Differential proof.** EV-021 and EV-022 were run against the pre-fix engine (the committed engine, copied to a
  scratch directory): pre-fix EV-021 warned, pre-fix EV-022 warned twice; post-fix 0 and 1.

## Code review (`/code-review high`, before opening the PR)

Seven findings, each checked against the code before acting:

- **Fixed — imposed means `dmEdit` AND `cost >= 0`.** The exemption rests on there being no AP loan, but
  `dm_edit_character_log` does not check a drawback's cost server-side and `_economyFrom` credits any
  drawback event's negative cost. A `dmEdit` drawback that grants AP now stays capped (fixture EV-023).
- **Fixed — a legacy `patch` event that replaces `b.drawbacks` resets `_imposedDrawbackIdx`.** `MUT.patch`
  is a bare `Object.assign`, so the stored positions would otherwise point at whatever now sits there.
- **Fixed — documentation.** The new build field is listed in the `compute()` API header comment (a
  hand-built `b` without it gets no exemption, i.e. today's behaviour), and the DM Console impose tooltip
  now says an imposed drawback carries no stat cap.
- **Not changed — buy-off matches the oldest purchase of a name, imposed or not.** Real, but existing
  behaviour and not a loophole: buying off the player-taken one costs 3× and leaves the uncapped imposed
  one, so nothing is gained. It does matter to `feat/dm-unlock-drawback`, which must key its unlock to a
  specific purchase — noted there.
- **Not changed — persisted derived field.** No path saves the folded build (CharGen's `JSON.stringify(b)`
  calls are in-memory undo snapshots), and `_lostPurchases`/`_raceTraitLocked` set the same precedent.
- **Deferred — the Players Guide.** `AGENTS.md` says a mechanics change is half-done until engine and guide
  both land. The guide has no text about DM-imposed drawbacks at all (checked: its four uses of "impose"
  are unrelated), so nothing in it now contradicts the engine, and a note would need editing both the
  `pact-guide` master and the served copy. Folded into `feat/permanent-wounds`, whose Wounds section is
  where imposed drawbacks first get documented. Zero live characters are affected in the meantime.

## Not changed, deliberately

- `drawbackReq` (the caster-only gate on `Mana Leak`, `Ritual-Blind`, `Wild Surge`) still applies to an
  imposed drawback. Imposing a caster-only penalty on a non-caster is a DM mistake, not a loan, and the
  warning is a useful nudge. Revisit if a DM reports it as friction.
- CharGen's checkbox guards read `drawbackMaxStats` directly, but imposition only happens through the
  DM Console on campaign characters, so CharGen never sees an imposed drawback.

## Verification

`engine-parity-ci.mjs` 76 passed / 0 failed (73 existing + EV-021/EV-022/EV-023) · `log-fuzz.mjs` 500/500 clean ·
`undo-barrier-ci.mjs` 44/0 · `protected-events-roundtrip-ci.mjs` 8/0 · `tool-pricing-ci.mjs` 189/0 ·
`audit.py` 0 failed. The two browser gates need Playwright; the worktree has no `node_modules`, so they
were run with the main checkout's copy symlinked in (removed before committing).
