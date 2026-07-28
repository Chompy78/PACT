# D-GH-2026-07-12-campaign-rules-snapshot — Ship drawback/art bans as enforcement-only; defer live-picker hiding

Status: Active

- **Context:** The retire-PACTRULES plan (`docs/plans/2026-07-12-campaign-rules-snapshot.md`) adds
  `bannedDrawbacks` + `bannedArts` to the cloud campaign rules so the DM-authoritative rules cover what the
  old local PACTRULES code did. Two things a ban can do differ in surface: (1) **enforcement** —
  `validate()` flags a chosen banned item as a violation (already wired at `PACT-CharGen-Webtool.html:3064`
  and `PACT-Live-Char-Sheet.html:1529`); (2) **live-picker hiding** — the item is filtered out of the
  picker before it can be chosen, via `cloudRuleBarred()`. Recon surfaced that these two tools' picker
  filters have *diverged*: CharGen's `cloudRuleBarred()` derives its ban-field map from the shared engine
  export `RULE_BAN_FIELDS` (so it picks up new fields for free), but Live Sheet's `cloudRuleBarred()`
  hardcodes `{masteries, boons}` and today doesn't live-filter even species/class bans. So adding
  live-hiding for drawbacks/arts would mean touching both tools' drawback/art picker render paths (with
  grandfather semantics for already-selected items) *and* reopening the Live Sheet hardcoded-map divergence.
- **Options:** (A) ship enforcement only (`validate()` + `RULE_BAN_FIELDS` + DM Console editor) — small,
  self-contained, and immediately functional since `validate()` is already consumed. (B) ship enforcement +
  live-picker hiding in both tools in one change. (C) ship enforcement + hiding, and while in there, refactor
  Live Sheet's `cloudRuleBarred()` onto `RULE_BAN_FIELDS` so it stops diverging (also fixing its pre-existing
  species/class gap).
- **Decision:** (A). Banned drawbacks/arts are enforced-by-violation now; live-picker hiding is a documented,
  purely-additive fast-follow.
- **Why:** Enforcement is the load-bearing behaviour and `validate()` is already wired, so (A) is genuinely
  functional, not inert. Live-hiding is a strict *superset* — (A) is a subset of both (B) and (C) with **zero
  rework** to build on later — so deferring it costs nothing but de-risks this slice from the Live Sheet
  divergence (which is really its own bug: Live Sheet's live-filter ignores species/class bans regardless of
  this work). Bundling (C)'s refactor here is exactly the "small task quietly turns big" pattern this session
  was trying to avoid. Known, accepted UX gap until the fast-follow: banned drawbacks/arts are *warned* on
  save rather than *hidden* from the picker, unlike boons/species/masteries which are hidden.
- **Status:** In force. Enforcement shipped, and the fast-follow (option B/C) shipped immediately after:
  banned drawbacks/arts are now hidden from the pickers in both tools, and Live Sheet's `cloudRuleBarred()`
  was folded onto `RULE_BAN_FIELDS` (option C — removing its hardcoded `{masteries, boons}` divergence). The
  UX gap noted above (warned-not-hidden) is therefore closed. Still open from the broader plan
  (`docs/plans/2026-07-12-campaign-rules-snapshot.md`): retiring the `b.campaign`/PACTRULES `#3` code and the
  LOG rules-snapshot + resolver for offline carry.
- **Addendum (kind-vocabulary reconciliation, code-review follow-up):** the two ban-checkers speak different
  kind vocabularies for the *same* category — the legacy local path uses `'draws'` (`campBarred`,
  `isDisabled`, `HOUSE.disabled.draws`, `CG_CAMPAIGN.draws`, `dmAdd`, `_campRows` — some of it *persisted*),
  while the new cloud path uses `'drawbacks'` (via `RULE_BAN_FIELDS`). Adjacent `campBarred('draws')` and
  `cloudRuleBarred('drawbacks')` calls were a fail-open footgun (a `'draws'` typo into `cloudRuleBarred`
  resolves to nothing and silently stops hiding bans). **Options:** (A) blanket-rename `'draws'→'drawbacks'`
  everywhere — rejected: migrates two persisted formats and is thrown away by retire-PACTRULES; (B) a
  comment — rejected: documents the trap without removing it; (C) make `RULE_BAN_FIELDS` (the shared export
  whose job is to centralize the tools' kind vocabulary) accept `draws` as a documented alias of
  `drawbacks`, and unify the call sites onto `'draws'`. **Decision: (C)** — zero migration, and *either*
  token now resolves in *both* checkers, so the fail-silent path is structurally impossible. The alias is
  marked to retire alongside the PACTRULES `'draws'` subsystem.

---
