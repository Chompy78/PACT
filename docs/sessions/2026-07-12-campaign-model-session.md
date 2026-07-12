# Session 2026-07-12 — campaign-model program (ban-fields shipped; AP model started)

Started from `/pick-task dm`; expanded into a design+build sweep across PACT's campaign model. One feature
shipped, one foundation laid, several plans captured. This note records the *pivots and decisions* worth
preserving; the mechanics live in `CHANGELOG.md`, the "why"s in `DECISIONS.md`, the designs in `docs/plans/`.

## What shipped / landed
- **PR #174 (merged to `preview`)** — campaign rules can ban **drawbacks + arts**: `validate()` +
  `RULE_BAN_FIELDS` + DM Console editor (enforcement), then hidden from the pickers in both tools, then a
  kind-token consistency fix. See `DECISIONS.md` `D-GH-2026-07-12-campaign-rules-snapshot`.
- **AP model — engine foundation on `preview`** (`compute()` two-pool documentation comment) + a
  cold-reviewed, recon-enriched plan (`docs/plans/2026-07-12-campaign-ap-model-cold-review.md`). Tool
  migration not yet started.
- **Roadmap** — added `refactor/retire-pactrules-code` and `feat/campaign-ap-model` (in-progress) entries.
- **Process** — added a "Fix depth — surface shallow vs deep" convention to `AGENTS.md`.

## Pivots & decisions a future agent might second-guess
- **`refactor/house-rules-rename` abandoned mid-session.** The intended rename (`b.campaign` → `b.houseRules`)
  collided with an existing engine-read `b.houseRules` feature. Pivoted to *retiring* the redundant PACTRULES
  `#3` code path instead (`docs/plans/2026-07-12-campaign-rules-snapshot.md`). The ban-fields MVP is the first
  slice of that; the retire + LOG-snapshot resolver is the remaining roadmap task.
- **Kind-token fix: chose the deeper option.** `campBarred('draws')` vs `cloudRuleBarred('drawbacks')` was a
  fail-silent footgun. Rejected the cheap comment; instead aliased `draws → bannedDrawbacks` in the shared
  `RULE_BAN_FIELDS` and unified call sites, so either token resolves in either checker (zero data migration).
- **AP model: 4 cold reviews triaged, not applied blindly.** Consensus finding (the `ignore_player_ap` ×
  frozen-ledger retroactivity — "remaining ≠ spendable" after a toggle flip) was **real and folded in**
  (define `remaining`, `min(ledgerRemaining, spendable)` display cap, grandfather + warn on flip). **Two
  "critical" findings were rejected** as cold-review false-positives (no repo access): CharGen can't
  overwrite the DM-AP column (server-only RPC + column-restricted writes), and the anti-double-count
  invariant is already partly structural (`compute()` returns derived values separate from the stored build).
  Recorded in the plan's "Review outcome" so they aren't re-litigated.
- **Cross-project lesson (not yet logged):** cold AI reviewers with no repo access confidently false-positive
  on things the code already handles — triage every finding against the actual code before acting.

## Handoff for the AP-model implementation (fresh session)
Continue `feat/campaign-ap-model` off `preview` (foundation already there). Order per the plan's
"Implementation recon": (1) Live Sheet migration off the DM-AP pre-mix + before/after blocker check;
(2) **verify FIRST** whether CharGen can read the character's DM AP (`characters.ap`) + campaign
`ignore_player_ap` — unconfirmed, and the gating dependency for the CharGen half; (3) CharGen display + lock
+ four states + tooltips; (4) the `displayRemaining` cap + toggle-flip warning.

## Environment note
This ran in an ephemeral remote container. A user-global `~/.claude/CLAUDE.md` written here does NOT persist
to the user's real machine — the "Fix depth" convention was mirrored into `AGENTS.md` (durable) and handed to
the user as a snippet to paste into their local `~/.claude/CLAUDE.md` for cross-project effect.
