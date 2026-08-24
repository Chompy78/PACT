# D-GH-2026-07-14-advancement-tracks — Campaign advancement dials (budget curve · award pace · starting tier)

Status: Active

- **Context:** the roadmap's "Advancement tracks + D&D 2024 level equivalency" asked for DM-selectable
  per-campaign advancement tracks plus a D&D-2024-equivalent level label, display-only. The design went
  through several cross-AI review rounds; the load-bearing findings, all verified against the actual code
  before acting: (1) the PACT Players Guide defines **two distinct** AP-per-level curves — a *pace* curve
  (AP earned by level: 1→50…20→491, which is exactly what `js/ap-by-level.js`'s `AP_BY_LEVEL` already is)
  and a separate, larger *budget* curve (AP a complete level-N build is expected to have spent: Standard
  1→79…20→535 at +24/lvl, Generous 1→83…20→615 at +28/lvl). Conflating them (reusing `AP_BY_LEVEL` as the
  "standard track") was a real error in two of the reviews. (2) Live Sheet **already** shows two level
  numbers in its header: `Level {b.hd}` (the character's actual level — and, per the guide's own
  "PACT level = Hit Dice = D&D 2024 level" identity rule, already the D&D-equivalent) and
  `≈ AP-Level {apLevel(eco.earned)}` (earned AP mapped to the fixed default table). A proposed third
  "≈ D&D N" chip would just restate `Level {b.hd}` one comma over.
  > Correction (2026-08-24, see D-GH-2026-08-03-ap-budget-curve-standard): the
  > "AP earned by level 1→50…20→491" framing above is wrong — that ladder was the
  > Emberwatch sample characters, not an earned-per-level rule. PACT defines a
  > *budget* curve (Standard L1 79/+24) and a separate *award pace* (~7/session).
  > The follow-up note below predicted a `DATA.version` bump would be needed; that
  > prediction came true — see D-GH-2026-08-03-ap-budget-curve-standard.
- **Options:** (A) implement the four-axis model literally as the latest handoff proposed — including a
  distinct `DND_LEVEL_EQUIVALENT` table + chip, consolidating `ap-by-level.js` into `advancement.js` with a
  deprecation shim, and adding the new level chip *alongside* the existing two. (B) implement only the
  genuinely-new, non-redundant pieces: the three DM dials + a single tuned-curve level indicator that
  *replaces* the existing earned-AP chip, drop the D&D chip, and leave `ap-by-level.js` alone.
- **Decision (B).** New `js/advancement.js` exports `LEVEL_BUDGET_CURVES` (Standard/Generous),
  `AWARD_PACES` (Slow/Average/Fast AP-per-session — a documented baseline only; nothing auto-awards), and
  `STARTING_TIER_RATIOS` (Prelude/Standard/Veteran/Legendary multipliers of the tuned L1), surfaced on
  `DATA.levelBudgetCurves`/`DATA.awardPaces`/`DATA.startingTierRatios`. None are read by `compute()` or
  `_replay()` (verified: engine's import + `DATA` assignments are the only additions; parity 20/0, no
  `DATA.version` bump). The DM sets them per-campaign in the existing `campaigns.rules` JSONB via the
  existing `setCampaignRules` whole-object replace — no new column/RPC/RLS. Live Sheet's `apLevel` chip is
  **replaced** by `trackLevel` (AP *spent* vs the tuned budget curve, Standard fallback when unbound/
  untuned); the orphaned `apLevel` helper was deleted from Live Sheet (still lives, unrelated, in CharGen
  and DM Console). The player-invite "Starting budget" field pre-fills from the campaign's starting tier,
  visible and editable per invite.
- **Why:** (A) adds two failure modes for no user-visible gain — a second level number that duplicates
  `b.hd`, and a deprecation shim + `ap-by-level.js` churn touching a file whose `AP_BY_LEVEL` **is**
  mechanics (read by `compute()`'s creation-lock via `DATA.level1AP`), i.e. risk on the exact file the
  budget curves must NOT be conflated with. (B) ships what the DM actually asked for (tuning dials) and
  fixes the "which level number do I trust" confusion by *replacing* rather than *adding*.
- **Deferred / dropped (explicitly, so they aren't lost):** the D&D-2024-equivalent label/table — dropped
  as redundant with `Level {b.hd}`. Custom DM-authored per-level curve UI — deferred (the data shape leaves
  room; the three presets plus a free-edit "Custom" numeric override cover v1). The `DATA.level1AP`
  creation-lock threshold still hardcodes the default L1 rather than a campaign's tuned `levelBudgetCurve.l1`
  — that IS a `compute()`/`_replay()` mechanics change (needs a `DATA.version` bump + fixture refresh), so
  it's its own follow-up PR, out of this display-only change's scope.
- **Status:** Shipped (`feat/advancement-tracks`). Parity 20/0 (headless CI); `DATA` fields confirmed to
  surface with correct L20 math (535/615); `DATA.version` unchanged. **Not** browser-E2E'd end-to-end: the
  DM rules panel and a bound player's Live Sheet require Supabase auth + a live campaign, impractical to
  drive headlessly here — the `trackLevel` algorithm and tier-prefill math were verified directly in Node
  instead, and a manual in-browser pass of the DM-panel↔bound-player round-trip is recommended before
  release. Also left for a follow-up decision (flagged, not silently changed): Live Sheet's `#eco` economy
  line still shows an earned-AP "Lv L · X AP to reach Lv L+1" pace readout using the fixed default table —
  a distinct earning-pace widget, deliberately out of this task's "replace the identity chip" scope.
