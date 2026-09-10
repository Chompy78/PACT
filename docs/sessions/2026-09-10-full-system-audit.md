# 2026-09-10 — a full-system audit: what the test suite already caught, and what it couldn't

**Decisions:** `D-GH-2026-09-10-full-system-audit-delete-save-race`,
`D-GH-2026-09-10-full-system-audit-ap-grant-dedupe`.

## How it started

The owner asked for "a full check of the PACT system finding errors, logical errors, user interface
issues etc." — an open-ended audit, not a scoped task-board item.

## Step 1 — run everything that already exists, before looking for anything new

Before writing a single manual review, every headless CI gate in `testing/scripts/` was run (installing
`playwright` locally via `npm install playwright --no-save`, no repo change — two scripts needed a
browser and had been silently unrunnable without it). Over **1,000 assertions** across engine parity,
XSS-escaping, tool pricing, sync concurrency, undo barriers, the sync state machine, autosave races,
cost customisation, version-sync, CharGen/DM-Console/economy e2e flows, guide theming, the service
worker, and randomiser quality — **all passed, zero failures**. This meant the audit's actual value-add
was whatever that suite structurally cannot check, not re-deriving what it already locks down.

`docs/TASK_BOARD_NOW.md`, `_NEXT.md`, and `_LATER.md` were then read in full. This project already
tracks an unusually thorough open-issues list — a dedicated, not-yet-started security audit
(`security/privilege-and-character-integrity`), several known pricing edge cases, SQL/migration hygiene
gaps, and more. Every finding below was cross-checked against that list, `DECISIONS.md`, and
`CHANGELOG.md` before being treated as new, specifically to avoid re-reporting known work as a fresh
discovery.

## Step 2 — live infrastructure check

`get_advisors` against the live Supabase project (security + performance) turned up:

- `character_backups` RLS-enabled-no-policy — **confirmed intentional**, `D-GH-2026-08-07-character-
  backups`'s dashboard-only access model. Not a finding.
- 40 `SECURITY DEFINER` RPCs callable by `authenticated`, and 16 RLS policies re-evaluating
  `auth.uid()` per row — **already documented as expected/pre-existing** (CHANGELOG, 2026-09-06, from
  the `feat/player-basic-mode` rollout). Not a finding.
- **Genuinely new:** 11 unindexed foreign keys (a different set from the one already fixed for
  `basic_mode_set_by`) and leaked-password-protection still disabled in Supabase Auth.

The 11 indexes were fixed live: `sql/migrations/2026-09-10-unindexed-foreign-keys.sql` (purely
additive, same pattern as the earlier `basic_mode_set_by` fix), folded into `sql/schema.sql`, applied via
`mcp__Supabase__apply_migration`, advisor re-checked clean afterward (the new indexes briefly show as
"unused" — expected for indexes seconds old, not a problem). Leaked-password-protection is a one-click
Supabase Auth dashboard setting outside what the available tools can flip — left for the owner.

## Step 3 — three parallel background reviews, deliberately pointed away from what's already covered

Given the suite's density, three `Explore`/`general-purpose` agents were sent after specific, bounded
territory the automated suite and task board don't already own:

1. **UI/UX and accessibility** across the three tools. Found: CharGen's/Live Sheet's collapsible
   sections and DM Console's roster rows/cards were mouse-only (no `tabindex`/keyboard handling); the
   Live Sheet Spell Browser's close button had no accessible name; one hardcoded error color; two raw
   exception-text UI messages.
2. **Dead code and doc drift.** Found a `_mod`/`_abilName` pair duplicated verbatim across all three
   tools (a pre-engine-bridge leftover), several orphaned functions, `PENDING_CLAIM_KEY` exported but
   never imported (CharGen hand-duplicated the literal instead, directly contradicting that constant's
   own "shared so the two can't drift" comment) — and confirmed AGENTS.md's own "don't read large files
   wholesale" section had drifted stale again: `js/engine.js` had grown from a documented ~930 lines to
   an actual 2,660 (2.9×), and all three tool files were 1.5–3× their documented sizes. This is the
   *third* time this exact section has been caught stale (see its own updated warning) — worth noting as
   a pattern, not just a one-off correction.
3. **Error-handling/race-condition review** of `js/sync.js`, `js/campaign.js`, `js/dm.js`, `js/auth.js`,
   `js/character-store.js` (read in full — small enough, per AGENTS.md). Found one genuine bug: a save
   already in flight when `deleteCharacter()` runs can race the delete's own server confirmation and get
   silently re-inserted, because `pushCharacter()`'s zero-rows branch couldn't distinguish "row never
   existed" from "row was just deleted." No existing gate covered it — `sync-concurrency-ci.mjs`'s own
   header scopes itself to save-vs-save races, never delete-vs-save.

One thing the dead-code agent flagged that turned out NOT to be a bug on inspection:
`AP_BY_LEVEL_GENEROUS` in `js/ap-by-level.js` looked unused, but its own adjacent comment states it's
"exported for completeness" as a deliberate design choice (both budget-curve presets expand through one
code path even though only STANDARD is the live default) — left alone. Worth recording as a reminder
that "no other file imports this" and "this is dead code" are not always the same claim; the second
requires checking whether the code's own comment already answers the question.

## Step 4 — what got fixed vs. what got logged

The owner chose to fix everything found in this same session rather than logging it all as separate
task-board entries, including both of the two real bugs (the delete/save race and the AP-grant-code
duplication) — a deliberate departure from this repo's usual one-task-per-branch discipline, made
explicitly for an audit session rather than by default. Each fix was verified against the relevant
slice of the test suite immediately after making it, not batched to the end:

- **Doc fixes:** AGENTS.md's and `js/engine.js`'s stale size/line-count figures corrected to
  2026-09-10 measurements, with the "this keeps happening" pattern called out explicitly this time.
- **Dead code:** removed the triplicated `_mod`/`_abilName`, several orphaned functions
  (`currentCharId`, `sgn`, `_bundleBoxes`, `_dstamp`, the duplicated `_spSubclassesFor`, and Live
  Sheet's `opt`/`buyBtn`/`nextCostLabel`/`awardToNext`/`_nameSwapHD`), each confirmed as truly unused by
  grep (occurrence count = 1, the definition itself) before deletion. `PENDING_CLAIM_KEY` is now
  actually imported and bridged in CharGen instead of hand-duplicated.
- **Accessibility:** `role="button"`/`tabindex="0"`/Enter-Space handling and visible `:focus-visible`
  styles added to CharGen's section accordions, Live Sheet's three collapsible cards, and DM Console's
  roster table rows and cards; `aria-expanded` kept in sync on toggle. The Spell Browser close button
  gained `class="close-btn" aria-label="Close" title="Close"`, matching the convention already used
  elsewhere in the same file.
- **UI polish:** the hardcoded `#c00` error color became `var(--bad)` (theme-aware across all four
  themes); the two raw-`err.message` UI strings became a friendlier lead-in with the detail still
  visible in parentheses, rather than a bare "Error: …".
- **The delete/save race** (`js/sync.js`): a new `DeletedError`, thrown from `pushCharacter()`'s
  zero-rows branch when this device's own tombstone list (`lsDeletes()`) already names the id — before
  either the guarded conflict-check or the plain insert gets a chance to read "zero rows" as "safe to
  insert." Covered by a new differential regression test in `sync-concurrency-ci.mjs`
  (`deleteRaceScenario()`): a reverted copy (tombstone check stripped) is proven to reproduce the
  resurrection; the live copy is proven not to. Full reasoning, including the deliberately-accepted
  residual edge case (an extremely stale save arriving after the tombstone itself has already been
  cleared), is in `D-GH-2026-09-10-full-system-audit-delete-save-race`.
- **AP-grant-code dedupe:** the byte-for-byte-duplicated, untested `_AK`/`_apHash`/`_apEnc`/`_apDec`
  logic in DM Console and Live Sheet moved into `js/ap-grant-code.js`, bridged into both tools' existing
  local-module engine bridge the same way `DATA`/`compute`/`MUT` already are. New
  `testing/scripts/ap-grant-code-ci.mjs` (13 assertions, zero prior coverage existed) includes a
  byte-for-byte backward-compatibility pin proving a grant code minted by the old duplicated algorithm
  still decodes identically after the refactor — so a code a DM already pasted into a chat stays
  redeemable. Full reasoning in `D-GH-2026-09-10-full-system-audit-ap-grant-dedupe`.

## What this audit did NOT do

It did not re-run or expand the still-open `security/privilege-and-character-integrity` task on
`docs/TASK_BOARD_NEXT.md` — that is explicitly scoped as its own large, `/make-code-cold-plan-review`-
gated effort, and duplicating even part of it here would have made that task's own eventual scope harder
to reason about. It did not attempt the flaky `tool-pricing-ci.mjs` tab-contention issue already filed
on the board (hit once during verification, confirmed as the documented pre-existing flake by a clean
re-run, not touched). Leaked-password-protection in Supabase Auth is a dashboard setting outside the
available tools' reach — flagged for the owner, not fixed here.

## Full verification

Every automated gate that could be run in this environment was run at least once more after all fixes
landed, several multiple times as each change was made: `engine-parity-ci`, `esc-gap-verify`,
`tool-pricing-ci`, `sync-concurrency-ci` (now 29 assertions, up from 26), `undo-barrier-ci`,
`sync-state-machine-ci`, `dm-ap-award-filters-ci`, `autosave-flush-latest-push-ci`,
`cost-customization-ci`, `version-label-ci`, `sync-autosave-toggle-ci`, `protected-events-roundtrip-ci`,
the new `ap-grant-code-ci`, and the browser e2e suite (`chargen-flows-e2e`, `dm-console-ui-e2e`,
`economy-ui-e2e`, `guide-theme-e2e`, `sw-cache-e2e`, `random-quality-ci`) — all green throughout, no
regressions introduced by any fix in this session.
