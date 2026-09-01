# D-GH-2026-09-01-feature-cost-customization — a DM may re-price any row of their campaign's band

Status: Active

- **Context:** The gold-and-downtime economy (`D-GH-2026-08-19-tool-coin-time-costs`) shipped with
  three settings and no dial between them: Off, or one of two fixed band tables taken verbatim from
  Players Guide §16. A DM who wanted Standard's *rhythm* but half its gold, or Fast's thresholds with
  a longer calendar, had nothing to turn — the only exits were switching bands wholesale (which moves
  the thresholds too, and §16 warns against mid-campaign switches) or the grant-back workaround
  recorded on the deferred `feat/economy-purchase-discount` task.

  The owner asked for per-feature cost customisation with two methods, a multiplier and a flat
  override, one each for gold and time. Presented with the granularity choice, they picked **per band
  row** rather than per named purchasable or per category.

  Worth recording because the shape was anticipated: the `economy` key in `campaigns.rules` was
  deliberately nested rather than left as a bare `economyBand`, with a code comment naming *"a
  per-campaign gold multiplier, a custom band"* as the growth it was reserving room for. This is that
  growth, and it needed no migration.

- **Options:**

  On **granularity** (what a customisation attaches to):
  1. *Per named purchasable* — one entry per feat, mastery, spell. Most expressive; hundreds of
     entries, and a per-name key breaks the moment a name is edited in the dataset.
  2. *Per category* — one entry per purchase type (~30 knobs). Middling on both axes.
  3. *Per band row* — re-price the rows of the table the campaign already plays on. **Chosen.**
  4. *Per row plus a global fallback multiplier.*

  On **where it is set**: DM Console campaign-wide (**chosen**); or that plus a solo/local setting;
  or local-only.

  On **the two methods coexisting**: override wins over multiplier; override then multiplier compose;
  or the **UI makes them mutually exclusive (chosen)**.

- **Decision:** **Per band row, campaign-wide from the DM Console, with the two methods offered as a
  radio per row per currency.**

  Concretely:
  * `js/engine.js` gains `effectiveBandRows(settingOrRules)` and `bandRowKey(row)`.
    `purchaseCost()` — still the single pricing function — now matches against *effective* rows, so
    every existing caller picks customisation up with no change at its call site.
  * Storage is `campaigns.rules.economy.rowCosts[bandToken][rowKey] = {gp?:{mode,value}, days?:{mode,value}}`,
    `mode` being `'mult'` or `'flat'`. **No SQL migration**: `rules` is a free-form JSON column, and the
    key is omitted entirely when nothing is customised, so an untouched campaign's rules JSON is
    byte-identical to before.
  * `tools/DM-Console.html` gains the editor, with a live preview of each row's effective price beside
    its list price.
  * Gate: `testing/scripts/cost-customization-ci.mjs` (81 checks) + `.github/workflows/cost-customization.yml`.

- **Why:**

  **Why per row, and why it is not the compromise it looks like.** Every purchase in PACT is already
  priced *by its AP cost* — that is the whole design of §16's "one universal band". So a band row is
  not an approximation of "a feature"; it is the actual unit the economy prices in. Per-name entries
  would have added a second, parallel pricing model beside the band, and a key (the feature's name)
  that the dataset is free to change underneath it.

  **Why the row key is `maxAp`, not the array index.** An index silently re-targets every
  customisation if a row is ever inserted into a band. A threshold that no longer exists simply stops
  matching — the failure is inert rather than wrong. The open-ended top row is keyed `'top'`.

  **Why keyed by band token first.** Standard and Fast have different thresholds *and* different row
  counts (9 vs 8), and `economy-bands.js` states outright that one is not derivable from the other. A
  DM's Standard tuning re-targeting Fast's rows on a band switch would be silent corruption. Each
  band therefore holds its own map, and switching bands shows that band's own settings.

  **Why one `{mode,value}` pair rather than two nullable fields.** It makes "a multiplier and an
  override at once" *unrepresentable* rather than merely discouraged, which is what lets the engine
  carry no precedence rule at all. The UI enforces the same thing structurally, via one radio group
  per row per currency — the browser does it, not a change handler.

  **Why rounding is one rule per currency.** Gold rounds to nearest; downtime rounds **up**. A
  part-day of training still costs you the day, and `ceil` can never make a multiplier cheaper than
  the DM asked for. Applied to both modes, so a DM never has to ask which mode they are in.

  **Why malformed input falls through to list price.** Same fail-closed posture `economySetting()`
  takes on an unknown band token: a typo in stored JSON shows the book price, never 0 gp. A silent
  free purchase is a worse failure than a silently un-applied discount.

  **Why history is not re-priced.** `_paidFor()` still prefers the `gp`/`days` frozen onto each
  purchase event, so customisation moves the *list* price and therefore future purchases only. This is
  the same guarantee a band switch already carried (§16: *"Don't switch mid-game, or a purchase's
  price will move under the players' feet"*), and it is what makes the dial safe to touch mid-campaign.

  **Why the downtime phrase is regenerated.** `economy-bands.js` stores the canonical integer (`days`)
  and the guide's own wording (`time`) as two separate fields, on purpose. A customised row that kept
  its original phrase would print "6 weeks" beside a 21-day cost — the label would simply lie. Rows
  whose `days` did not change keep their original wording untouched, so the book's phrasing survives
  wherever it is still accurate.

  **Why no guide edit, and why that question was asked rather than assumed.** `AGENTS.md` requires a
  mechanics change to land in the Players Guide too. This is not one. The default band tables are
  unchanged, `compute()` is untouched, and §17 already grants the DM exactly this licence in the
  book's own words: *"waive or reduce any cost at any time, AP, gold, or downtime… The numbers in this
  book are a default to lean on, never a cage."* The feature gives a DM a control for a permission the
  guide already states; it does not introduce a rule the guide lacks. `DATA.version` is therefore **not
  bumped** — bands are not read by `compute()`, and no band's default numbers moved.

  **Why campaign-only, with no solo equivalent.** The dial belongs to the DM (§17's pre-session
  checklist). An unbound character resolves to a bare band *token*, and a token structurally carries
  no customisation — so "a solo player cannot inherit a table's pricing" is a property of the data
  shape, not a check that could be forgotten. The same fallback covers unresolved campaign rules: a
  network hiccup quotes the book rather than guessing at the table's numbers.

- **Status:** Active. Shipped on `claude/feature-cost-customization-s8bnk3`.

  **Known adjacent work, deliberately not folded in.** The deferred `feat/economy-purchase-discount`
  task (per-*purchase* DM discount, `docs/TASK_BOARD_LATER.md`) is a different axis and stays deferred
  — this prices a whole row for a whole campaign, not one character's one purchase, and neither
  substitutes for the other.

  **Pre-existing failure found while testing, NOT caused by this change.**
  `testing/scripts/economy-ui-e2e.mjs` fails **35 of 155** checks on an untouched `preview` (verified
  by stashing this work and re-running). Cause: `5a752b7` (*"creation ends by choice, not by accident"*,
  PR #480) retired the automatic threshold lock, so creation now ends only on an explicit
  `creationLocked` event — but that gate's fixtures still rely on the retired tripwire, never reach
  the in-play state, and so assert against an economy that never charges. Filed rather than fixed
  here: it is a separate task, and folding a 35-check fixture repair into this diff would bury the
  feature it is meant to review. Two further environmental notes from the same session: that script
  **exits 0 even when it crashes outright** (a missing `playwright` module printed a stack trace and
  still returned success — a gate that cannot fail is not a gate), and `tool-pricing-ci.mjs` is
  intermittently flaky on a contended machine with "never became ready" harness failures, observed on
  untouched code at 166/1, 179/1 and 184/0 across three consecutive runs.
