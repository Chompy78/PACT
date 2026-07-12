# Plan: Campaign AP model — interchangeable AP display, DM-AP-aware CharGen

> **Status: design capture (pre-implementation).** This is the prerequisite engine/AP-model work that the
> campaign invite/join feature (`docs/plans/2026-07-11-campaign-join-invite-flow.md`) depends on. It is
> engine-model + tool-parity work touching `js/engine.js` and sits next to the known D-GH30 /
> `feat/ap-model-reconcile` tension, so it is intended for a cold plan review before implementation.

## Goal
Make CharGen and the Live Sheet show the **identical spendable-AP total for the same character**, because
the two tools are explicitly interchangeable (the "⇆ Open in Live Sheet" / "switch to CharGen" handoff,
D-GH38). Today they disagree, and CharGen is entirely unaware of DM-granted AP — which also blocks the
desired "invited campaign character builds from DM AP, Player AP gated by campaign settings" model.

## Context — the two AP pools (verified in code)
PACT tracks two kinds of AP:
- **Player AP** — the player's build points. Stored *with the character* as `award` events in its event
  log; they fold into the build field `b.budget` (`foldBuild` sets `b.budget = economy(log).earned`).
- **DM AP** — DM/campaign-granted, campaign-authoritative. Stored *separately* in the Supabase
  `characters.ap` column, written only via the `award_ap()` SECURITY DEFINER RPC (which also writes an
  `ap_awards` audit-ledger row).

The engine's `compute(b, opts)` is *designed* to combine them:
`spendable = (opts.ignorePlayerAp ? 0 : b.budget) + opts.dmAp`, and it returns `spendable` (plus
`playerAp`, `dmAp`) as public fields. **But the shipping tools don't use `opts.dmAp`:** the Live Sheet
pre-mixes DM AP into `b.budget` itself and calls `compute(b)` with no opts; CharGen calls `compute(b)`
with no DM-AP concept at all.

## The problem (why the tools disagree)
- **CharGen** displays **Player AP only** — it has zero DM-AP awareness (no references to DM AP or
  `ignore_player_ap` anywhere).
- **Live Sheet** displays **Player AP + DM AP** (pre-mixed into `b.budget`), and honors the campaign's
  `ignore_player_ap` toggle.
- So the *same* character (e.g. 50 Player AP + 20 DM AP) reads **50** in CharGen and **70** in the Live
  Sheet — a broken interchangeability contract, and it worsens under `ignore_player_ap`.
- Root cause: **each tool does its own AP arithmetic** (CharGen none; Live Sheet its own pre-mix). Nothing
  forces them to agree.

## Core requirement (the thing to capture)
> **CharGen and the Live Sheet MUST display the identical spendable-AP total for the same character —
> computed by a single shared path, honoring DM AP and the campaign `ignore_player_ap` toggle — because
> the two tools are interchangeable.** The headline number is the total; a small breakdown
> (e.g. `70 AP — 50 player + 20 DM`) is shown alongside so the number is explainable.

## Design decisions

**D1 — One shared composition, done in the engine (resolves the "should budget include both?" question).**
Keep **`b.budget` = raw Player AP** in *both* tools (the authored, persisted value). Do the combining
*once, in `compute()`* via its existing opts, and have both tools **display `compute().spendable`**:
```
compute(b, { dmAp, ignorePlayerAp })   →   spendable = (ignorePlayerAp ? 0 : b.budget) + dmAp
```
This is the "stop pre-mixing" structural fix (previously called C3). It simultaneously: (a) makes the two
tools agree by construction, (b) removes the `b.budget` overloading that made the code confusing, and
(c) structurally prevents the double-count trap in D5. The Live Sheet migrates off its manual pre-mix onto
this path; CharGen starts passing `dmAp`/`ignorePlayerAp` for cloud/campaign characters.

**D2 — `ignore_player_ap` honored by BOTH tools.**
The campaign toggle (DM allows/disallows player-entered AP) must be read by CharGen too, not just the Live
Sheet — otherwise the totals diverge again. When **disallowed**, `spendable = DM AP only`, and CharGen must
**lock/grey the Player-AP input** so the player isn't editing a value that silently does nothing.

**D3 — Local/offline characters are unaffected.**
DM AP only exists for cloud/campaign characters. A purely local character has `dmAp = 0`, so `spendable =
Player AP` and the two tools already agree — no change, no new data plumbing needed for the local case.

**D4 — The anti-double-count guard (non-negotiable invariant).**
The combined `spendable` total is a **derived, display-only** value, recomputed each render. It must
**NEVER** be written back into the character's stored data (the LOG `award` event / persisted `b.budget`).
DM AP lives only in `characters.ap` and is layered in at compute time. Writing the combined total into the
saved Player-AP award is exactly what would bake DM AP into the log and double-count on the next load.

**D5 — Naming kept as-is for now (Player AP / DM AP).**
No rename of `playerAp`/`dmAp`/`b.budget`/`opts.dmAp` this round (the rename is wide, touches the engine's
public API, and buys little). Instead, add a clarifying comment at `compute()` documenting the two-pool
model and the D4 invariant, and fix the stale return-shape doc block. (This was "C1"; the deeper
de-overloading is folded into D1, so a standalone rename is unnecessary.)

## Files involved
- `js/engine.js` — clarifying comment + stale-doc fix at `compute()`; no formula change (the
  `opts`-based composition already exists).
- `tools/PACT-Live-Char-Sheet.html` — migrate the render path off manual `b.budget` pre-mix onto
  `compute(b, {dmAp, ignorePlayerAp})`; keep `b.budget` raw.
- `tools/PACT-CharGen-Webtool.html` — read the character's DM AP (`characters.ap`) and the campaign
  `ignore_player_ap` for cloud/campaign characters; pass them to `compute()`; display `spendable` + a
  breakdown; lock the Player-AP input when `ignore_player_ap` is on.
- `js/campaign.js` — CharGen needs the campaign's `ignore_player_ap` (already exposed via `getCampaign`
  / `listMyCampaigns`).

## Out of scope (for this piece)
- Renaming any identifier (`playerAp`/`dmAp`/`b.budget`/SQL names) — deferred (D5).
- The generation→live **creation-lock trigger** (`creationLocked`/`campaignBound`) — a separate, related
  piece; tracked with this model work but not required to fix the interchangeable-AP display.
- The invite/join UI itself — depends on this piece, planned separately.

## Risks / open questions
- **D-GH30 / frozen-ledger tension:** this piece composes the *ceiling* (`spendable`); the *spent/remaining*
  side must keep using the frozen `economy()` ledger for event-sourced characters, per the existing rule —
  do not introduce a recompute-based remaining that reprices earlier purchases.
- **CharGen offline vs cloud:** CharGen must degrade cleanly when there's no cloud/campaign context
  (`dmAp = 0`, no toggle) — the common local-authoring case must be untouched.
- Whether the Live Sheet's migration off manual pre-mix changes any displayed number for existing
  characters (it should be a pure refactor: same formula, moved into `compute`). Verify with a
  before/after on a DM-AP character.

## Verification
- `testing/tests/engine-parity.html` → still **20/0** (the composition formula is unchanged; only call
  sites move).
- **Interchangeability check:** a cloud character with non-zero `characters.ap` shows the *same* spendable
  total in CharGen and the Live Sheet; toggling the campaign's `ignore_player_ap` changes both identically.
- **Double-count regression:** edit/save a DM-AP character in CharGen, reload in the Live Sheet — the DM AP
  is counted exactly once (the saved Player-AP award is unchanged).
- **Local-character regression:** a local/offline character's displayed AP is unchanged.

## Done when
- Both tools display an identical spendable total (Player + DM, honoring `ignore_player_ap`) for the same
  character, computed via `compute(b, {dmAp, ignorePlayerAp})`.
- `b.budget` holds only raw Player AP in both tools; DM AP is never persisted into the log.
- CharGen locks the Player-AP input when the campaign disallows player AP.
- `compute()` carries a comment documenting the two-pool model + the D4 invariant; parity stays 20/0.

## Relationship to other work
- **Prerequisite for** `docs/plans/2026-07-11-campaign-join-invite-flow.md` Path A: an invited character
  seeded with DM AP only relies on CharGen actually honoring DM AP (this piece).
- **Sibling of** the creation-lock trigger work (emit `creationLocked`/`campaignBound` at the
  generation→live handoff) — same model area, separate deliverable.
