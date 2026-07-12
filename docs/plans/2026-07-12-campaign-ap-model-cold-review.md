# Plan: Campaign AP model — one interchangeable spendable-AP total across both tools

Derived from: docs/plans/2026-07-12-campaign-ap-model.md (internal design doc with repo-specific refs).
Status: **cold-reviewed (4 independent reviews, 2026-07-12) and revised** — see "Review outcome" at the end.
The one consensus finding (below, §"Remaining vs. spendable") has been folded in; implementation-ready.

## Goal
Make two interchangeable character tools — a build tool ("CharGen") and a live play sheet ("Live Sheet") —
display the *identical* spendable-AP ("action points", the build currency) total for the same character.
Today they disagree: CharGen shows only the player's own points; the Live Sheet shows player + DM-granted
points. Same character reads e.g. 50 in one tool and 70 in the other — a broken contract, since the app
lets you hand a character back and forth between the two tools.

## Context
- Static vanilla-JS tabletop-RPG toolset. All game rules live in ONE shared engine (`compute()` is its
  pricing/derivation function); UI tools must call the engine, never re-implement rules. A hosted database
  (row-level security) stores character data.
- TWO kinds of AP:
  - **Player AP** — the player's own build points. Stored *with the character* as "award" events in its
    event log; the engine folds these into a build field (`budget`).
  - **DM AP** — granted by the game master, campaign-authoritative. Stored *separately* in a database
    column, writable ONLY through a server-side, permission-checked routine (never by the client directly).
- The engine's `compute(build, opts)` ALREADY combines them:
  `spendable = (opts.ignorePlayerAp ? 0 : build.budget) + opts.dmAp`, returning `spendable`, `playerAp`,
  `dmAp`. **But the shipping tools don't use this:** the Live Sheet manually pre-adds DM AP into `budget`
  and calls `compute(build)` with no opts; CharGen has no DM-AP concept at all.
- `ignore_player_ap` — a per-campaign toggle: the DM can disallow player-entered AP (build from DM AP only).
  Only the Live Sheet honors it today.
- **Frozen-ledger rule (prior decision):** for event-sourced characters, "AP spent/remaining" comes from a
  *frozen* economy ledger computed from the event log — NOT from a fresh recompute, because a recompute
  would retroactively re-price earlier purchases. This plan composes only the spendable *ceiling*; it must
  not rewrite the frozen ledger.
- **Repo rule:** store only raw character data; derive everything at runtime — never persist a derived
  value. DM AP is server-authoritative and DM-only.

## Assumptions vs. verified facts
- **Verified (checked in code):** `compute()` already contains the opts-based formula and returns
  `spendable/playerAp/dmAp`; the Live Sheet pre-mixes DM AP into `budget`; CharGen has zero DM-AP awareness;
  `budget` = the player's folded award total; DM AP lives only in the DB column written via the server
  routine; the two tools have an explicit hand-off making them interchangeable. **Also verified (closes two
  cold-review "criticals"):** the client physically CANNOT write the DM-AP column — `characters` client
  writes are column-restricted and the DM-AP column is set only by the server routine (hardened in a prior
  change) — so a CharGen save cannot overwrite or zero DM AP; and `compute()` returns derived values on its
  OWN result object, separate from the stored `build`, so the anti-double-count invariant is already partly
  structural.
- **Assumed (please attack):**
  1. Migrating the Live Sheet off its manual pre-mix onto `compute(build, {dmAp, ignorePlayerAp})` is a
     *pure refactor* — same formula moved into the engine — with no change to ANY compute output (AP, HP, AC,
     warnings, tier) for existing characters. **This is now a BLOCKER-gated check, not a footnote** (see
     Verification).
  2. CharGen can read the character's DM AP and the campaign's `ignore_player_ap` for cloud/campaign
     characters (its cloud wiring already exposes these). If false, this is a hidden work item.
  3. Local/offline characters have `dmAp = 0`; the two tools already agree there with no new plumbing —
     but "offline" must be shown as *DM AP unavailable*, not silently as zero (see §Display states).

## Proposed approach
1. **Stop pre-mixing.** Keep `budget` = raw Player AP in *both* tools. Combine once, in `compute()`, via its
   existing opts. Both tools display `compute(build, {dmAp, ignorePlayerAp}).spendable`.
2. **Live Sheet:** migrate its render path off the manual `budget` pre-mix onto the `compute()` opts path;
   keep `budget` raw.
3. **CharGen:** read the character's DM AP + campaign `ignore_player_ap` (cloud/campaign characters); pass
   to `compute()`; display `spendable` + a breakdown ("70 — 50 player + 20 DM"); lock/grey the Player-AP
   input when `ignore_player_ap` is on.
4. **Both tools honor `ignore_player_ap`.**
5. **Anti-double-count invariant:** the combined `spendable` is derived, display-only, recomputed each
   render, NEVER written back into stored data (award event / persisted `budget`) or into any export. DM AP
   stays only in its DB column, layered in at compute time.
6. **Display states:** same three AP-source states in both tools — (a) not in a campaign: player only, "no
   DM AP"; (b) in a campaign, player AP allowed: player + DM; (c) player AP switched off: DM only, player
   input locked. Add a FOURTH, visually distinct state: **DM AP unavailable (offline / campaign not
   loaded)** — must not read as "no DM AP." Inactive jars greyed (not hidden), with a tap-to-reveal
   (mobile-safe, accessible — focusable, keyboard-reachable, `aria` text, not hover-only) tooltip.
7. Keep the "Player AP / DM AP" names; add a `compute()` comment documenting the two-pool model and the
   anti-double-count invariant — worded so it does NOT imply there can only ever be exactly two pools.

## Remaining vs. spendable, and the `ignore_player_ap` transition (added post-review — the consensus gap)
The original plan defined `spendable` but never defined **`remaining`**, and assumed the ceiling/ledger
split "wouldn't produce a mismatch a user notices." All four cold reviews independently flagged this as the
#1 risk. Resolution — **display-side only, no ledger rewrite:**
- **Define remaining:** `displayRemaining = min(ledgerRemaining, spendable)`, where `ledgerRemaining` comes
  from the frozen economy ledger and `spendable` from `compute()`. The `min()` is a *display* cap; it does
  NOT recompute or mutate the frozen ledger (frozen-ledger rule preserved). This guarantees remaining is
  never shown as more headroom than the player actually has, and never goes negative in the UI.
- **`ignore_player_ap` flips ON for a character that already spent player AP:** purchases are
  **grandfathered** — never deleted, refunded, merged into DM AP, or rewritten in the log (matches the
  app's existing grandfather semantics). `spendable` drops to DM-only; `displayRemaining` caps at it; the
  player-AP input locks. Surface a **non-blocking warning** ("built with player AP this campaign no longer
  counts; existing choices are kept") rather than silently overspending OR hard-blocking the character.
- **Purchasing while capped:** new purchases are gated by `displayRemaining` (the capped value), so a
  toggled-off character can't spend phantom player-AP headroom.

## Files involved
- The engine (`compute()`): clarifying comment + stale-doc fix; NO formula change. (`displayRemaining` cap
  is applied at the tools' display layer, reading the engine's `spendable` + the frozen ledger's remaining —
  it is NOT a new engine formula, to avoid touching the frozen-ledger path.)
- The Live Sheet tool: move render off manual `budget` pre-mix onto `compute(build, {dmAp, ignorePlayerAp})`;
  apply the `displayRemaining` cap; keep `budget` raw.
- The CharGen tool: read DM AP + `ignore_player_ap` for cloud characters; pass to `compute()`; show
  `spendable` + breakdown + capped remaining; lock the Player-AP input when player AP disallowed; the four
  display states incl. "DM AP unavailable."
- The campaign-data helper: expose `ignore_player_ap` to CharGen (assumed already available — verify).

## Out of scope
- Renaming any identifier (the AP field/opts names) — deferred.
- The separate "generation → live" creation-lock trigger — but add a one-line confirmation that it does not
  interact with the DM-AP opts path (a reviewer flagged it as possibly load-bearing).
- The invite/join UI, and **local→cloud import under `ignore_player_ap`** (the grandfather question at
  import time) — both belong to the invite/join plan; note the cross-reference there.
- Any pricing change / rules-version bump.

## Alternatives considered
- **Leave each tool doing its own AP arithmetic** (status quo) — rejected: nothing forces agreement; the bug.
- **Make CharGen pre-mix DM AP into `budget`** like the Live Sheet does now — rejected: bakes DM AP into the
  persisted player-AP field, double-counts on reload, overloads `budget`.
- **Persist the combined total** — rejected: a derived value must never be stored.
- **Recompute the frozen ledger on `ignore_player_ap` change** (a "hard" reconciliation) — rejected:
  violates the frozen-ledger rule and would re-price history. The `min()` display cap achieves a coherent UI
  without touching the ledger.

## Risks / open questions
1. **Ceiling/remaining coherence** — now addressed by the `displayRemaining = min(...)` rule above; the open
   question is only whether the soft-cap warning copy is clear enough (UX wording, not architecture).
2. Does the Live Sheet migration change ANY compute output (not just AP — HP/AC/warnings/tier) for existing
   DM-AP characters? Expected no; treated as a blocker check.
3. CharGen must degrade cleanly with no cloud/campaign context (local authoring untouched); and while
   campaign data is loading, show "DM AP unavailable/loading," never a premature total.
4. Greyed-jar tooltip must be tap-reachable + keyboard/screen-reader accessible; "no campaign" vs "DM AP
   unavailable" vs "player AP off" must be visually distinguishable, not all just grey.

## Verification
- Engine parity regression suite → **20 passed / 0 failed** (composition formula unchanged; only call sites move).
- **Blocker gate:** before/after the Live Sheet refactor, compare ≥3 existing DM-AP characters — every
  compute output (AP, HP, AC, warnings, tier) identical. Zero delta or the refactor is wrong.
- **Interchangeability round-trip:** a cloud character with Player 50 / DM 20 → open Live Sheet, open
  CharGen, save, reload, reopen Live Sheet → shows Player 50 / DM 20 / Spendable 70 throughout; no drift, no
  double-count, no combined total persisted.
- **Toggle-flip case:** Player 50, DM 20, Spent 60, then `ignore_player_ap` ON → `spendable` = 20,
  `displayRemaining` = min(ledgerRemaining, 20) (never negative, never > 20), purchases blocked above it,
  grandfather warning shown, no log rewrite.
- **`player AP < spent` case:** Player 50, DM 20, Spent 60 → remaining shown as 10 (not −10); DM AP makes the
  build legal without re-pricing.
- Local-character regression: AP unchanged AND explicitly "no campaign, no DM AP"; offline cloud character
  shows "DM AP unavailable," not a silent 50.
- All four display states render identically in both tools; mobile tooltip reachable by tap + accessible.

## Done when
Both tools display an identical spendable total (Player + DM, honoring `ignore_player_ap`) via
`compute(build, {dmAp, ignorePlayerAp})`; `remaining` is defined and capped (`min(ledgerRemaining,
spendable)`) so it never contradicts the ceiling; an `ignore_player_ap` flip grandfathers purchases + warns
(never silently overspends or rewrites the log); `budget` holds only raw Player AP in both tools; DM AP is
never persisted into the log/exports; CharGen locks the Player-AP input when player AP is disallowed; the
four display states render identically in both tools; `compute()` carries the two-pool/anti-double-count
comment; parity 20/0.

---

## Implementation recon (2026-07-12 — verified in code, for the session that implements this)
Engine foundation is already committed (the two-pool `compute()` comment). Confirmed by reading the code:
- **`compute()` already returns everything needed:** `spendable = (ignorePlayerAp ? 0 : playerAp) + dmAp`,
  `remaining = spendable − total`, and the returned **`budget` is an ALIAS of `spendable`**. So a tool only
  needs to pass `{dmAp, ignorePlayerAp}` and display `r.spendable` — no tool-side arithmetic. `remaining` is
  already "spendable − spent" in-engine (the reviewers' A1 interpretation); the `min(ledgerRemaining,
  spendable)` display cap matters only where the **Live Sheet uses the frozen `economy()` ledger**
  (`eco.available`) for live buy-gating — reconcile the display there, NOT in the engine.
- **Live Sheet — three render paths disagree today (the whole bug, intra-tool):**
  - `refreshBuy()` and the time-travel render path both **pre-mix**: `b.budget = (ignPlr?0:eco.earned)+dmAp`
    then `compute(b)`. → keep `b.budget = eco.earned` (raw), call
    `compute(b, {dmAp: window._dmAp, ignorePlayerAp: window._ignorePlayerAp})`, display `r.spendable`.
  - `renderSheet()` calls `compute(b)` with **no opts** (shows player-only) — the intra-tool inconsistency;
    give it the same opts.
  - Globals already populated on load: `window._dmAp = rec.ap`; `window._ignorePlayerAp = camp.ignore_player_ap`.
- **CharGen — the harder half, VERIFY FIRST:** it displays `r.total + ' / ' + r.budget` plus an apText
  summary, with **no DM-AP concept**. It has cloud campaign-**rules** wiring (from the ban work:
  `window._cloudCampaignRules` / `cloudRuleBarred`), but whether it can read the character's **DM AP
  (`characters.ap`) and the campaign `ignore_player_ap`** is **UNVERIFIED**. Confirm this dependency before
  building the CharGen display/lock/four-states/tooltip work — if the plumbing is absent, wiring CharGen to
  read `characters.ap` + the campaign toggle is an added work item (CharGen's module bridge historically had
  no cloud/auth wiring beyond campaign rules).
- **Suggested order:** (1) Live Sheet migration (contained) + the before/after blocker check on real DM-AP
  characters; (2) verify CharGen's DM-AP access; (3) CharGen display + lock + four states + tooltips;
  (4) the `displayRemaining` cap + toggle-flip grandfather warning.

---

## Reviewer instructions (for the cold review — now complete)
[Retained for provenance.] You are reviewing this plan cold, with no repo access — judge logic, clarity,
scope, and risk, not code correctness you cannot verify. Find gaps, shaky assumptions, better alternatives,
missing verification. Weigh the ceiling-vs-frozen-ledger split hardest. Write findings as a plain list; if a
section is solid, say so rather than inventing concerns.

---

## Review outcome (4 independent cold reviews, 2026-07-12)
- **Reviewer findings:** ~14 distinct across 4 reviews → **accept/fold-in ~7**, **reject 2** (verified
  already-handled), **defer+convert ~3**, remainder redundant.
- **Consensus (all 4):** the plan under-specified `remaining` and the `ignore_player_ap` transition — the
  ceiling/frozen-ledger split could show "remaining 20, spendable 0." **Accepted** → new §"Remaining vs.
  spendable" (define remaining; `min()` display cap; grandfather + warn on toggle-flip).
- **Rejected (cold-review false positives — no repo access):** (1) "CharGen save overwrites the DM-AP
  column" — the client cannot write that column (server-only routine + column-restricted writes, verified);
  (2) "make the anti-double-count invariant structural, not a comment" — `compute()` already returns derived
  values separate from the stored `build`, so it is already partly structural. Recorded here so they are not
  re-litigated.
- **Deferred+converted:** local→cloud import under `ignore_player_ap` → invite/join plan; creation-lock
  interaction → one-line confirmation in this plan's scope; automated tool-level parity test → verification
  note (currently manual).
- **Materially changed the plan?** **Yes** — added the remaining/transition rule, the "DM AP unavailable"
  fourth display state, the before/after blocker gate, and the two `player-AP < spent` / toggle-flip test
  cases.
- **Best/worst of the four:** the deepest review (assumption-by-assumption + numbered failure scenarios) and
  the sharpest single framing ("`remaining` is never defined") drove all the real changes; two reviews were
  largely redundant checklists.
- **Without the review:** implementation would have passed 20/0 engine parity and shipped, then a DM
  toggling `ignore_player_ap` mid-campaign would have produced "remaining ≠ spendable" nonsense — a real risk
  caught before a line of code.
