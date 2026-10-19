# D-GH-2026-10-17-names-before-spending — a locked character cannot spend AP while a language or spell slot is unnamed; on by default everywhere, a campaign can switch it off

**Status:** IN FORCE once PR 2 (`feat/names-before-spending`) merges. Play-time legality rule in the tools; no `compute()` change, no
`DATA.version` bump. PR 1 (`D-GH-2026-10-15-names-slot-helper`) supplied the slot list.

## Context

Owner request 2026-10-12: a character should not be able to spend AP until its languages and spells are chosen. Players could buy
language and spell slots and never name them (names live in the separate ✎ Name spells & languages dialog; `compute()` prices counts
only), so sheets carried blank slots indefinitely. The cold plan (`docs/plans/2026-10-15-names-before-spending.md`, one Gemini review
folded in) and eight owner decisions below settled the design.

## Decision

- **When (C1):** from the creation lock on. Before the lock players buy slots and name them at the end, so nothing is blocked; but
  "Finish creating" (CharGen) asks for the names first. Buying a slot is allowed; the NEXT purchase waits for the name.
- **What it blocks (Q1):** purchases that cost AP (cost above 0), the Live Sheet's drawback buy-off included. Not blocked: free
  purchases, drawbacks (they give AP), DM awards, and the naming itself (`saveNames` never goes through `buy()`).
- **Which slots (M1):** languages and spells only: language, out-of-tradition cantrip, innate spell, discipline cantrip, known spell,
  Mystic Arcanum. Not counted: fighting styles, Metamagic, maneuvers, choice-grant spells, the epic-boon ability.
- **Switch (D1, E2, J1):** `rules.requireNames`, **on when absent** — so on in every existing campaign on release day and for a
  character in no campaign. Only an explicit `false` turns it off (`requireNamesOn()`). DM Console has the checkbox (in the rules
  group, so it is locked/unlocked and saved with the rest). No grace period and no migration (owner E2).
- **No stuck character (I1):** a slot with no legal name is skipped. Each tool passes a pool-size callback because the spell-list logic
  (`eligibleSpells`) is still a copy in each tool. Languages are never empty: the campaign list falls back to the standard list.
- **CharGen (N1):** counts every kind except Mystic Arcanum, which its dialog cannot render yet; board task
  `feat/chargen-names-arcanum-rows` removes the exception.
- **Where it lives:** `namesGate(events, build, {rules, kinds, poolSize})`, `namesOutstanding(build, opts)` and `requireNamesOn(rules)`
  in `js/engine.js`; applied in the Live Sheet's `buy()`, `buyoffDrawback()` and buy panel (greyed with the reason) and in CharGen's
  `_cgPostLockAppend()` and `cgFinishCreating()`. The gate is asked ONCE per edit, against the character as it stood before it, so the
  purchase that creates a blank slot passes and a multi-step edit is not stopped by its own first step.

## Why

One engine rule and one slot list mean the dialog and the gate cannot disagree. On-by-default-everywhere was the owner's explicit
choice (E2) over a per-campaign opt-in and over a grace period, knowing it freezes spending for every character with a blank slot on
release day; the answer for a table that dislikes it is the DM switch, and the release note says so. The server does not enforce it
(like the other play-time legality rules), so it is a convenience for honest players and a DM guideline, not a security boundary.

## Consequences to watch

- Release day: every locked character with a blank slot (all 10 characters of one campaign had one on 2026-10-12) cannot spend until it
  names them or its DM unticks the rule. The changelog entry carries a short note for DMs.
- A character whose slots a tool cannot name (an Arcanum slot in CharGen) is covered by the kinds list, not by a bypass.

## Status

IN FORCE (on merge). Follow-ups: `feat/chargen-names-arcanum-rows`; the Players Guide text (both copies).
