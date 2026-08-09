# D-GH-2026-08-09-campaign-ap-budget-enforce — block cloud save for over-budget campaign-bound characters

Status: Active. Implemented 2026-08-09.

## Context

Design settled by the owner and recorded in full on the task board (`docs/TASK_BOARD_NEXT.md`,
"Block cloud save for campaign-bound characters over AP budget"). Recorded here in full because the
task board only holds *open* work — this record is what survives once the task graduates off it.

Before this change, a campaign-bound character could go over their AP budget (`compute()`'s
`remaining < 0`) and keep saving to the cloud indefinitely — nothing stopped it. A DM wants the option
to require players to stay within budget before their build syncs.

## Decision

**New setting: `rules.enforceApBudget`** — a boolean key inside the campaign's existing `rules` jsonb
blob (`campaigns.rules`), **not** a new `campaigns` column. No migration, no RLS change. Default
**true** when absent/unset — the opposite default from the neighboring `ignore_player_ap` column,
because this setting protects against a real failure mode (silently-accepted over-budget saves) that
should be on by default, whereas `ignore_player_ap` changes what a character can spend and should not
surprise a DM who never touched it.

**Enforcement is client-side only, deliberately** — mirrors `validate()`'s existing banned-item
enforcement (also client-side-only today). True DB-level enforcement would mean reimplementing
`compute()`'s AP pricing math in SQL or a Postgres function, which violates the hard rule that
`js/engine.js` is the single source of truth for rules logic. `compute()` itself needed no change —
`remaining < 0` already means "over budget" (it was already computed for the AP ledger's own display).

**Scope — blocks only the CLOUD save path**, in both CharGen and Live Sheet:
- CharGen: `onSaveClick()` (manual) and `_cgCloudPushOnce()` (autosave).
- Live Sheet: the `cloudSaveBtn` click handler (manual) and `_lsCloudPushOnce()` (autosave).
- **Never** Local "Save to file" — a personal backup, not DM-visible, and not what this setting is about.
- **Never** DM Console — it has no save path of its own (read-only roster/awards, its own stated design
  principle). The new toggle there only sets the campaign's rules; it doesn't gate anything DM Console
  itself does.

**Manual save while blocked**: a clear `alert()` explaining why (over budget by N AP, DM has enforcement
on) and the save never runs. **Autosave while blocked**: skipped silently after **one** `flash()` warning
per session (`_cgBudgetWarned`/`_lsBudgetWarned`), mirroring the existing `_cgConflictWarned`/
`_lsConflictWarned` one-notice-per-session pattern exactly — autosave runs on every debounced edit, so
erroring/flashing on every cycle would be pure noise. The local autosave (a separate call that already
ran) still holds the player's work either way; nothing is lost, only the cloud push is refused.

**Grandfathering**: turning the setting ON never retroactively touches, hides, or reverts an
already-over-budget character — it only blocks that character's *next* save attempt. Nothing in this
change reads or rewrites existing characters' `stats`/LOG; the block is evaluated fresh at save time.

**Caching lifecycle for the block condition** (both tools): the "is this campaign enforcing" and "what's
the current DM AP" values are resolved and cached exactly where the equivalent `ignore_player_ap`
values already are — CharGen's `_cgResolveDmApStatus()` (→ `window._cgEnforceApBudget`, alongside
`window._ignorePlayerAp`) and Live Sheet's `refreshCloudCampaignRules()`/`loadCloudChar()` (→
`window._cloudCampaignRules.enforceApBudget`, alongside `window._ignorePlayerAp`) — resolved on
boot/handoff/cloud-load, **not** re-fetched on every autosave tick. This means a DM flipping the toggle
mid-session doesn't apply to an already-open tab until its next resolve event. Accepted deliberately:
this is a client-side UX guard, not a security boundary (stated explicitly in the task's own risk
rating — damage scale low, no data loss, no trust boundary), and it's the exact same staleness
characteristic `ignore_player_ap` has already lived with in this codebase since before this change —
not a new risk this change introduces.

**DM Console UI**: the new "Block cloud save when over AP budget" checkbox copies the existing
`ignorePlayerAp` lock-guarded pattern verbatim — disabled by default, a separate lock/unlock button,
`confirm()` on change, always re-locks (success or error). Unlike `ignorePlayerAp`, flipping it doesn't
re-fetch/re-price the roster (DM Console displays no number this setting affects — it only gates a
*future* save attempt the two other tools make), so its change handler is simpler: persist via
`setCampaignRules()`'s read-modify-write-the-whole-blob path (same as `houseRules`/`levelBudgetCurve`/
`dmNotes` already do), no `loadRoster()` call. Also threaded into the big "Save rules" button's own
`rules` object literal — same treatment `dmNotes` already gets — so a regular rules save doesn't
silently revert this setting to its default.

## Why

**Client-side-only was the deliberate, load-bearing choice**, not a shortcut: this project's hard rule
(`AGENTS.md`) is that `js/engine.js` is the *only* place rules logic lives, and AP-budget math is rules
logic. A Postgres-side re-implementation would be a second, independently-drifting copy of pricing math
— exactly the class of bug this project has already been bitten by in other contexts. The trade-off
(a technically-savvy player could bypass this client-side check by calling the save RPC directly) is
accepted explicitly: this is a UX guard for honest play, not a security boundary, and the task's own
risk rating already prices that in (damage scale low, fully revertible).

**Reusing the `ignore_player_ap` lock-guarded UI pattern and its caching lifecycle**, rather than
inventing a new one, keeps two settings that DMs will mentally group together ("what a character's
budget context is") behaving identically — same lock affordance, same staleness characteristics, same
confirm-before-write ritual. A DM who already understands one understands the other for free.

## Verification

New gate assertions in `testing/scripts/tool-pricing-ci.mjs` (both tools) isolate the gating helper
(`_cgOverApBudget()`/`_lsOverApBudget()`) from real AP-pricing arithmetic by stubbing `compute()` to a
fixed `{remaining}` — the pricing math itself is already exhaustively covered by `engine-parity-ci.mjs`
(unaffected, 29/0, `compute()` untouched). Proves: not-campaign-bound never blocks regardless of
`remaining`; enforcement explicitly off never blocks even when over budget; bound+enforced+over blocks;
bound+enforced+under doesn't; autosave skips silently with exactly one warning across repeated calls
while over budget, never zero and never more than one. Confirmed red first: reverting only the two
tool-file changes (keeping the new tests) threw `ReferenceError: _lsOverApBudget is not defined` and
failed the gate, before the fix was restored.

**Not verified in this session**: `onSaveClick()`'s manual-save path end-to-end (its "☁ Save to cloud"
button only exists once the Cloud menu renders, which requires a signed-in `_session` this
unauthenticated CDP harness can never set — the separate "Cloud (signed-in) e2e" CI check's job, not
`tool-pricing-ci.mjs`'s dependency-free one) and DM Console's new toggle UI (no local harness touches
`tools/DM-Console.html` at all — its own "DM Console UI" CI check is Playwright-based and can't run in
this CLI session per `tool-pricing-ci.mjs`'s own header comment on why it exists). Both were sanity-checked
short of full behavioral coverage: `onSaveClick()`'s block is a single `if (_cgOverApBudget()) {
alert(...); return; }` at its very top, reusing the gate already proven correct; DM-Console.html's script
blocks were confirmed to parse with no syntax errors (`node -e "new Function(...)"` per block).
