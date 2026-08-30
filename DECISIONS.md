# PACT — Decisions (why it's built this way)

> Authoritative record of decisions **still in force**. One entry per decision:
> **Context → Options → Decision → Why → Status.** Newest at the TOP.
> `CHANGELOG.md` records *what* changed; this records *why*.

> **Format note (2026-07-28):** this file is now a thin index over `decisions/2026/D-*.md` records —
> see `D-GH-2026-07-28-decisions-changelog-task-board-split` below. Each bullet below ends with a
> "Full record:" pointer to that decision's own `Context → Options → Decision → Why → Status` writeup.

## Index

## D-GH-2026-08-30-archive-hd-gate-cold-reviews — cold reviews never left `z-cold/`, because the close-session check looks in the wrong place
- Ten files sat in `z-cold/` on the auto-sync `zcold` branch. Sorted by content hash rather than
  filename: five were byte-identical duplicates of already-filed reviews, one a stale plan snapshot, and
  **four were genuinely unfiled and existed nowhere else** (the `feature-hd-gate` reviews, read by the
  2026-08-27 session but never relocated). Three compounding faults: the close-session step checks only
  `z-cold/processed/` and never the root; relocation ran as a copy rather than a move; and in this repo
  `z-cold/` is gitignored and lives on a separate branch, so the guard can never fire at all. Four
  reviews filed to `docs/sessions/cold-reviews/`, all ten cleared. Full record:
  `decisions/2026/D-GH-2026-08-30-archive-hd-gate-cold-reviews.md`

## D-GH-2026-08-30-invite-note-grant-drift — `campaign_invites`'s column-scoped grant was missing its own documented revoke
- `sql/rls-policies.sql`'s `campaign_invites` section claimed in a comment (since
  D-GH-2026-08-03-invite-note-dm-only) that a table-level grant is dropped before the column-scoped
  `grant select (...)` — but no `revoke` ever actually ran; the same gap exists in
  `sql/migrations/2026-08-09-harden-invitation-system.sql`. `cloud-e2e`'s "invite note is DM-only" check
  (caught on PR #472, unrelated to that PR's own diff; re-ran once, failed identically) proved it
  reproducibly leaks `note` on a fresh Supabase stack. **Verified NOT a live production vulnerability** —
  queried production directly: `note`/`token_hash` carry no `SELECT` for `authenticated`, and
  `pg_default_acl` shows why (the role that built production's schema inherited a narrower default than
  whatever role `cloud-e2e`'s throwaway local stack uses). Fixed by adding the explicit
  `revoke select on public.campaign_invites from authenticated, anon;` to both `sql/rls-policies.sql` and
  a new no-op-on-production migration, so the restriction holds regardless of ambient default privileges
  instead of by accident of which role happened to run the migrations. Graduates the concurrently-filed
  NEXT task that found the same gap independently (see the record's Addendum). Full record:
  `decisions/2026/D-GH-2026-08-30-invite-note-grant-drift.md`.
## D-GH-2026-08-27-feature-hd-gate — class abilities are Hit-Dice gated in the engine, via one shared `requiredHD()`
- The Players Guide states the Hit-Dice requirement as absolute and `DATA.tierHD` always held the mapping,
  but `js/engine.js` never enforced it — while the Live Sheet carried five inline copies (already drifted
  from each other over the `lvl` floor) and CharGen carried none. Chose a hard block (0 AP, not owned) driven
  by a single exported `requiredHD()` that both class-ability pickers call (CharGen and the Live Sheet;
  DM Console has no picker), rather than a sixth inline copy; gated both the feature and mirrored-subclass purchase paths; rejected stepped-tier escalation after
  measuring it changes nothing and contradicts the Guide's "no level gate" note on the only `rep` entry.
  `DATA.version` v0.359 → v0.360. Full record: `decisions/2026/D-GH-2026-08-27-feature-hd-gate.md`.

## D-GH-2026-08-25-dm-console-warnings-race-flake — a "flake" verdict on dm-console-ui-e2e.mjs was wrong; root-caused and fixed the real race
- `dm-console-ui` failed once in CI on PR #469 (the promotion PR); local repro + one CI re-run both
  passed, so it was called a flake and PR #469 was merged. That conclusion needed re-checking:
  `CHANGELOG.md` already documented a directly analogous 2026-08-22 incident (PR #447) in the *same test
  file* that was NOT a flake — a genuine stale-response race. Traced the actual code path this time
  rather than re-running again: `selectCampaign()` fire-and-forgets `loadInvites()`, which calls the
  real, unstubbed `listCampaignInvites()` against live Supabase (the source of the 400/401s in the
  failing log); `loadInvites()` unconditionally calls `renderCampWarnings()` on both its success and
  error path, so a slow real network round-trip landing after the test's own synthetic `seedInvites()`
  calls silently clobbers the test's data. Fixed by stubbing `listCampaignInvites` for that one check
  block instead of guessing a longer timeout — removes the non-determinism rather than out-waiting it.
  96/96 on 3 consecutive local runs. Test-only change (no `tools/`/`js/`/`sql/` touched), so `main` isn't
  carrying a live defect — rides the next normal promotion. Full record:
  `decisions/2026/D-GH-2026-08-25-dm-console-warnings-race-flake.md`.

## D-GH-2026-08-25-password-reset-flow — password reset was broken end-to-end; fixed the redirect target and built the missing recovery page
- Two defects, not one: `forgotPassword()` redirected to the app homepage (no recovery handling at all),
  and even a correct redirect would have landed nowhere — `updatePassword()` existed in `js/auth.js` but
  nothing called it. Fixed with a new `RESET_REDIRECT` constant (`login.html`, separate from
  `REDIRECT_BASE`, which `signUp()` still correctly uses) and a new recovery view in `login.html`.
  Detection logic (`type=recovery` vs `error=` in the URL fragment) verified directly against the
  vendored Supabase client source rather than assumed from memory; a synchronous pre-import hint script
  avoids a real race between the client's own async hash-clearing and the page's boot logic. The
  existing "already signed in → bounce to index.html" check had to move behind the new recovery/error
  branches — Supabase's recovery redirect establishes a real session, so it would otherwise have kicked
  a genuine recovery visit away before they ever saw the new-password form. **Needs a Supabase dashboard
  step this session's tools can't perform:** `https://chompy78.github.io/PACT/login.html` must be added
  to Auth → URL Configuration → Redirect URLs before this works in production. No automated e2e coverage
  added (`cloud-e2e.mjs` needs Docker, unavailable in this environment) — verified instead via syntax
  checks, a DOM-id cross-reference, and a manual trace of all four boot-state branches. Full record:
  `decisions/2026/D-GH-2026-08-25-password-reset-flow.md`.

## D-GH-2026-08-22-archived-campaign-rpc-enforcement — server-side enforcement that an archived campaign is write-locked
- "Archived = read-only" was enforced only in `tools/DM-Console.html`'s client JS — no RLS policy or RPC
  rejected a write against an archived campaign. Cold-reviewed by 5 independent reviewers before
  implementation per `AGENTS.md`'s high-risk-change rule. Scope: seven write paths (five
  `SECURITY DEFINER` RPCs — `award_ap`, `award_gold`, `declare_downtime`, `dm_edit_character_log`,
  `dm_unbind_character` — plus the `campaigns_update` and `characters_delete` RLS policies), narrower
  than the task board's original unscoped wording; two of the board's five presumed RPC names
  (`set_ignore_player_ap`/`set_campaign_rules`) turned out to be a column-grant, not functions;
  `characters_delete`'s missing archive check (a DM could otherwise hard-delete a bound character with
  no check at all) was found during this work's own broader write-surface audit, not named by the
  original finding. One fail-closed `is_campaign_active()` primitive, two call-site helpers derived from
  it. Verified with a full fixture-based role/state matrix run directly against production via
  authenticated-role SQL simulation (this environment has no Docker/Supabase-CLI for a local stack) —
  all seven paths confirmed to reject while archived and restore after `unarchive_campaign()`;
  negative-authority-ordering, positive-still-readable, and cross-campaign-isolation controls all
  confirmed. Full record: `decisions/2026/D-GH-2026-08-22-archived-campaign-rpc-enforcement.md`.

## D-GH-2026-08-24-missing-data-ref-warning-classification — fix 3 confirmed findings from a post-merge /code-review ultra
- CharGen's `isAdvisory()` and Live Sheet's `_lsIsAdvisory()` were never updated when
  `feat/warn-missing-data-refs` added 8 new "is no longer in the rules data" warnings, so the notice
  rendered as an urgent hard issue with a dead click target and inflated issue counts — contradicting its
  own "no cost/effect applied" wording. Fixed both classifiers; added fixtures CG-039–CG-044 to close a
  6-of-8-sites coverage gap. Two more findings from the same review (latent subAbilities/subSpellBundles
  label edge cases, a `SOFT_WARN` gap) verified not reachable with live DATA or any UI path — deferred,
  recorded rather than fixed reflexively. Full record:
  `decisions/2026/D-GH-2026-08-24-missing-data-ref-warning-classification.md`.

## D-GH-2026-08-24-warn-missing-data-refs — warn (don't silently no-op) when compute() hits a DATA reference that's been retired
- 8 loops in `compute()` silently `continue`d past a saved racial trait/boon/drawback/art/feature/
  subAbility/subSpellBundle/racialSpell reference no longer in `DATA` — zero cost/effect, no warning, no
  trace. Fixed additively (existing pricing behavior unchanged, confirmed by 0 output drift across all 57
  pre-existing fixtures); `subSpellBundles` needed care to avoid a false positive (its lookup is
  overloaded between "genuinely missing" and "legitimately no bundle"); two categories are also iterated
  by a secondary loop for unrelated checks, deliberately not duplicated to avoid 2-3x warning noise for
  one stale label. `/code-review ultra` caught two real issues post-hoc: the 8th site (`racialSpells`)
  and a stored-XSS regression (the new warnings are the first to echo attacker-controlled free text
  rather than a curated `DATA` key) in both CharGen's and Live Sheet's warning renderers, fixed with
  `esc(w)`. Full record: `decisions/2026/D-GH-2026-08-24-warn-missing-data-refs.md`.
## D-GH-2026-08-24-livesheet-drawback-legalcheck — route Live Sheet drawback purchases through legalCheck()/buy()
- `takeDrawback()` called `emit()` directly, the only purchase category in the Live Sheet with no rules
  enforcement at all — a Fighter could tick a caster-only drawback, and a broken stat cap went unenforced.
  Routing through `buy()` required a new `_CTX_PRICERS.drawback` entry: the default whole-build-delta
  pricer returns 0 for drawbacks, since they're modeled as income (not negative spend) since v0.354 —
  verified directly against `js/engine.js`'s own "MODEL (b)" comment before wiring anything, not assumed.
  Full record: `decisions/2026/D-GH-2026-08-24-livesheet-drawback-legalcheck.md`.

## D-GH-2026-08-22-dm-console-codm-revoke-ui — a "Current co-DMs" list with a Remove action
- The console could withdraw an unredeemed co-DM invite but had no way to see or remove someone who had
  already redeemed one and become a co-DM — a real gap given this project's history with the invite/join
  privilege-escalation bug. `removeDm()`/`getCampaignDms()` already existed in `js/campaign.js`, unused;
  verified server-side authorization directly (the RPC is `SECURITY DEFINER` and independently re-checks
  `is_campaign_owner()`, plus blocks removing the owner) before wiring any UI to it. New owner-only panel
  tile, gated the same way "Archive campaign" already is; Remove confirms first. 4 new synthetic-data
  tests (no live backend needed) cover rendering/escaping and the confirm+RPC wiring — 167/0. Full
  record: `decisions/2026/D-GH-2026-08-22-dm-console-codm-revoke-ui.md`.

## D-GH-2026-08-22-engine-pricing-edge-cases — four js/engine.js pricing edge cases, DATA.version v0.358 → v0.359
- Attunement/Ki/Sorcery points could go free or refund AP once bought past their price tables' last
  entry (live-reachable via Live Sheet's ordinary buy buttons, no gate stops long play from reaching
  25/21-rung ladders); an out-of-range ability score priced below a legitimately-bought 20; a duplicate
  `unlockclass` LOG event double-charged AP for a class already unlocked; `activeEvents()`'s FIFO
  buyoff/dmRemoveBoon matching could cross-match two unrelated malformed events on the same `undefined`
  key. All four clamp/dedupe/guard against the existing pattern already used elsewhere in the file
  (`unlockCum`'s own comment: "a clamp under-charges at worst; `|| 0` paid the player"). `arts`/`boons`/
  `subAbilities` deliberately NOT added to the dedupe list alongside `unlockedClasses` — whether
  duplicates there should be legal is an unanswered rules question, not assumed either way. 5 new
  parity fixtures; `engine-parity-ci.mjs` 57/0, `tool-pricing-ci.mjs` 163/0, `log-fuzz.mjs` 500/500 clean.
  Not a Players Guide change — see the record's "Why" section for why this is a bug fix restoring
  already-intended behavior, not a mechanics change. Full record:
  `decisions/2026/D-GH-2026-08-22-engine-pricing-edge-cases.md`.

## D-GH-2026-08-22-audit-batch-mechanical-fixes — 10 low-risk playability/usability fixes from the 2026-08-22 audit, batched
- The audit's non-security findings (14 remaining after the esc()/XSS batch), triaged into what's safe to
  fix directly in one batch vs. what needs its own dedicated pass: 10 mechanical, single-file, no-design-
  decision fixes shipped here (Live Sheet's frozen-ledger budget gate + import confirm + HP-sync hint;
  DM Console's roster staleness + downtime confirm + dead-code removal + touch target; CharGen's ledger
  escaping + budget clamp + name maxlength). The three engine-pricing findings (uncapped ladders, ability-
  score bound, duplicate-unlock dedupe) are sequenced into their own branch since they share a
  `DATA.version` bump. Two findings are explicitly NOT fixed here: the co-DM revoke UI (real feature work,
  its own branch) and archived-campaign RPC enforcement (a production RLS/RPC change — deferred pending
  `/make-code-cold-plan-review`, per this project's own standing rule for that class of change). The HP-
  sync finding's deeper fix (moving `curHP`/`tempHP`/`hdLeft` into the LOG-backed path) is likewise not
  filed as a task — it's a real schema decision only the owner can make; the shallow visibility fix ships
  now, the deep option is a live open question, not a queued task. Full record:
  `decisions/2026/D-GH-2026-08-22-audit-batch-mechanical-fixes.md`.

## D-GH-2026-08-22-esc-gap-chargen-livesheet — closing five stored-XSS/attribute-injection gaps in CharGen and Live Sheet
- A full tool audit found five places (eight counting the CharGen↔Live Sheet `renderCharSheet()`
  duplication plus one same-shape mirror found while fixing) where a player-controlled value reached
  `innerHTML`/an HTML attribute without `esc()`/`_csEsc()` — three reachable through completely ordinary
  UI use (naming a language, importing a JSON save, buying off a drawback), cross-user reachable via
  cloud sync, share links, and DM Console's roster/`?viewChar=` view. Fixed by wrapping the affected
  array joins in `esc()`/`_csEsc()` matching every sibling field in the same functions, escaping
  `validate()`'s three `payload.v` interpolations at the point they're built (not blanket over the whole
  issues array, which intentionally embeds real HTML elsewhere), and moving the buy-off button's value
  out of an inline `onclick` string into an escaped `data-v` attribute plus `dataset.v` read, closing a
  second independent attribute-injection vector on the same field. Verified with a new throwaway CDP
  script (`testing/scripts/esc-gap-verify.mjs`) driving the actual fixed code with the audit's exact
  payloads — 9/0 — plus `engine-parity-ci.mjs` 52/0 and `tool-pricing-ci.mjs` 163/0 confirming no
  regression. Full record: `decisions/2026/D-GH-2026-08-22-esc-gap-chargen-livesheet.md`.

## D-GH-2026-08-22-dm-console-stale-campaign-switch-race — a stale campaign-switch response could clobber the newly-selected campaign's data
- Found while investigating a `dm-console-ui-e2e.mjs` CI failure on the `preview`→`main` promotion PR
  (#446) that reproduced identically twice in CI but passed locally: `loadInvites()`/`loadRoster()`/
  `_refreshDowntimeWindows()` are triggered fire-and-forget by focus/visibilitychange auto-refresh
  listeners with no guard against the DM switching (or deselecting) campaigns while a fetch is still in
  flight — a slow response for the OLD campaign could overwrite `_invites`, the roster, and the party
  downtime globals with stale data after the NEW campaign already rendered correctly. Fixed with a
  shared `_isCurrentCamp(id)` guard re-checked after every await boundary before any DOM/global write.
  A code-review pass caught a real near-miss mid-fix: the first draft's assignment happened *inside* the
  awaited expression, before its own staleness check ever ran. Landed as its own PR into `preview`
  (not bundled into the promotion PR) per `docs/VERSION-SYNC.md`. Full record:
  `decisions/2026/D-GH-2026-08-22-dm-console-stale-campaign-switch-race.md`.

## D-GH-2026-08-22-dm-screen-generic-award-ap — generic Award AP tile, banned-drawback grid staleness fix, disabled-item contrast fix
- New tick-list "Award AP" sub card on DM Console's master card (under the campaign selector, above
  Owner settings) — tick any number of roster characters, one amount + note, one Award action, awarded
  independently per character. Hardened `renderRuleGrids()` (Banned species/boons/drawbacks/arts) so a
  mid-session `DATA` addition is no longer permanently invisible once a grid has rendered once — a
  measured audit found `js/engine-data.js` itself already fully in sync (90/90 drawbacks), so the report
  of "missing" drawbacks pointed at a staleness class of bug rather than a data gap. Raised disabled/
  banned/owned boon-drawback opacity 0.5–0.55 → 0.7 in CharGen and the Live Sheet (measured: the shipped
  values failed WCAG AA contrast in all five themes; 0.7 clears it in all five). Full record:
  `decisions/2026/D-GH-2026-08-22-dm-screen-generic-award-ap.md`.

## D-GH-2026-08-20-tag-only-meaningful-promotions — don't tag every `preview`→`main` promotion, and fix a mispointed tag along the way
- `docs/VERSION-SYNC.md` step 6 said, unconditionally, to tag every promotion's resulting `main` commit.
  Only 13 tags exist across far more than 13 real promotions, so that was never the actual practice —
  just an unstated literal reading nobody followed, repeated as a checklist item on every promotion PR
  regardless of whether it carried anything tag-worthy. Now says explicitly: tag only a meaningful
  promotion (real feature/rules landing, relaunch, milestone), skip housekeeping-only ones. Separately,
  a tag literally named `v1.442` was found already pointing at the wrong commit (the v1.439 merge, not
  any real v1.442 content) — confirmed the platform-403 restriction on tag pushes from a cloud session
  covers deletion too, not just creation (no GitHub-API mutation tool exists for it either); the bad tag
  itself still needs manual removal (local terminal or GitHub web UI), not fixable from this session.
  Full record: `decisions/2026/D-GH-2026-08-20-tag-only-meaningful-promotions.md`.

## D-GH-2026-08-20-premium-autogrowth-to-stepped — Rage/Wild Shape/Bardic Inspiration die become stepped-Premium; hard prerequisite blocking; three more features retrofitted
- Implements `pact-guide`'s `D-2026-08-19-premium-autogrowth-to-stepped`: Rage, Wild Shape, and Bardic
  Inspiration die convert from flat-once Premium to a Premium unlock + half-price named upgrade steps,
  chained by prerequisite, split into independent tracks that never gate each other. `DATA.version`
  **v0.358**. Owner direction made in this repo, beyond the source decision: the prerequisite check
  becomes an actual hard block (was advisory-only), scoped per track; Wild Shape's Capability track and
  Unarmored Movement's steps changed band (Passive and Situational respectively); and three more already-
  shipped Stepped features — Sneak Attack, Martial Arts die, Unarmored Movement — retrofitted to the same
  half-price-after-unlock shape, using real 5e breakpoints already documented in the guide (found
  mid-session after an initial pass used invented placeholder tiers — see the record's "Course
  correction"). New "Blocked purchases" ledger line wired into CharGen/DM Console. Guide rewritten
  throughout on what Premium means and how the discount works; `guide-price-check.mjs` → 0 mismatches.
  `/code-review ultra` caught and fixed two real bugs (blocked invocations still counting toward the
  breadth surcharge; two guide callouts self-contradicting the guide's own price tables) before merge.
  **Not yet done by this repo's own rule:** the `pact-guide` project's canonical guide master still needs
  the identical transfer (served copy here ≠ master).
  Full record: `decisions/2026/D-GH-2026-08-20-premium-autogrowth-to-stepped.md`.

## D-GH-2026-08-19-tool-coin-time-costs — gold and downtime reach the tools, soft-gated, DM-owned
- PACT is named for three currencies and the Players Guide has specified all three for months (§2, §16,
  §17's "☐ Gold-and-Time economy: Off, Standard, or Fast?"), but two of them had **no implementation at
  all**. The inverse of the usual failure this repo guards against: the guide was complete and the engine
  carried nothing, so this task read the guide as its spec and needed **no guide edit**. Both band tables
  now live in `js/economy-bands.js`, surfaced on `DATA`; the engine gains `purchaseCost`/`wealthLedger`/
  `chargesGoldAndTime` and six more exports; `compute()` is untouched, so **no `DATA.version` bump**.
  Three decisions carry it: **soft warning, never a hard block** — §17 lets a DM waive any cost, so a
  refusing tool would be *wrong about the rules*, and for the same reason an overdraft is never clamped;
  **three presets only** — §16 says pick one band and hold to it, and `off` is a first-class setting
  (`rows: null`, so a campaign playing Off shows *no prices*, not zeroed ones); and **reuse the existing
  creation lock** as the definition of "in play", which is why `_replay()`'s lock ratchet was *extracted*
  into `_lockStates()` rather than copied. Costs **freeze onto their own event** (`gp`/`days`, exactly as
  `cost` freezes AP), which both stops a mid-campaign band switch re-pricing history and makes waivers,
  mentor discounts and the coin-for-time trade one mechanism instead of three. Gold is DM-owned in a
  campaign, mirroring `characters.ap` (`characters.gold`, `gold_awards`, `award_gold()`); a solo
  character's own gold rides its own LOG. The band setting needed **no migration** — campaign-side it
  lands in the existing `campaigns.rules` jsonb, solo-side as an `econSetting` LOG event. New gate: 120
  checks, verified to go red. Also fixed a real PWA bug the repo's own audit caught —
  `economy-bands.js` would have been cached cache-first behind a network-first `engine.js`;
  `CACHE_NAME` → `pact-v9`.

  **Addendum, same day:** downtime turned out NOT to share gold's shape at all, corrected before any
  real character had a balance. Gold banks per character and accumulates; downtime is a single window
  the DM declares for the **whole party at once**, which **replaces** the last declaration rather than
  adding to it (owner: "the time should not keep adding up... spend it now or wait till another
  opportunity") — modelling it as a per-character accumulating column (as first shipped) would have
  marked every character permanently overdrawn the moment the economy switched on, and made the DM
  re-type the same figure once per player, every session, forever. `characters.downtime_days` dropped;
  `wealth_awards`→`gold_awards` (gold-only); new `campaign_downtime_declarations` (nullable
  `character_id`: null = party base, set = a per-character bonus that resets with the base) +
  `declare_downtime()`/`get_downtime_window()` RPCs. Gold still lives on the Award AP form ("same area
  as AP awards"); downtime gets a separate party-wide control, with an optional per-character bonus
  folded into the same AP/gold form. Also found and fixed a real, unrelated bug on the way: the DM
  Console's campaign-rules cache never carried the economy band at all, so the original grant form
  could never have shown regardless of the DM's chosen band. Gate → 151 checks; new migration
  `2026-08-19-downtime-window-revision.sql` (a follow-up file, not an edit to the applied one) —
  applied to the live project same day, `get_advisors` clean.

  **Addendum, 2026-08-20 (pre-merge review + merge):** `/code-review ultra`, required by this repo's
  own PR checklist for anything touching `js/engine.js`/`sql/`, caught two real bugs before merge —
  `buyoffDrawback()` never froze `gp`/`days` onto its emitted event (silently re-priced on a later band
  change), and the DM Console's "Downtime available" line showed the window's raw total instead of
  netting it against actual spend. Both fixed; gate → 155 checks, both verified red independently.
  Merged into `preview` as **PR #433**. Also recorded: GitHub's PR-merge computation does **not** honor
  this repo's `.gitattributes` `merge=union` on `CHANGELOG.md`/`DECISIONS.md`, so a clean local trial
  merge can still show `mergeable_state: dirty` on GitHub — resolved by merging `preview` into the
  branch locally (where the union strategy applies) and pushing that, rather than fighting it through
  GitHub's UI. Worth remembering for any future PR touching either file's top.
  Full record: `decisions/2026/D-GH-2026-08-19-tool-coin-time-costs.md`.
## D-GH-2026-08-19-drawbacks-phobias-expansion — drawbacks are income, so price them by pain ÷ pay
- 21 new drawbacks (69 → **90**), reprices `Sluggish` 2→1 / `Mana-Sick` 3→2 / `Haunted / Phobia` 3→2, and a
  new `DATA.drawbackReq` caster gate. `DATA.version` **v0.357**. The record exists mainly to fix an
  inverted reading: drawbacks are **income**, so the AP number is what the player *gains* — the harshest
  existing entries carry the biggest numbers (`Hexed Luck` 8, `Leaden Reflexes` 6). The test is therefore
  **compensation ÷ expected pain**, and only *over*-payment threatens balance; under-payment merely makes a
  dead option. `Light-Blind` (6) anchors a frequency ladder for the "disadvantage while X" shape
  (near-permanent 6 · scene-level 3–4 · occasional 2 · rare 1) — which is why `Fear of the Dark` triggers on
  "no light source within 30 feet" rather than plain darkness, that being near-permanent underground.
  `Claustrophobic`/`Agoraphobic` became a mirrored one-clause pair, dropping a DC 12 save that fired at every
  dungeon doorway. `Mana Leak` is **gated, not priced** — free AP for a Fighter, brutal for a Wizard, and one
  number cannot serve both. Four proposals dropped as dominated or toothless, plus `Light Sleeper`, whose
  name is already a 2 AP **boon**. Reprices verified safe: zero live characters held any of the three.
  Found on the way: `engine-data.js` key order is load-bearing (append, never prepend); the `pact-guide`
  master had **already** diverged on cap wording and this change deliberately did not paper over it; and
  `guide-price-check.mjs` still has no drawback coverage.
  Full record: `decisions/2026/D-GH-2026-08-19-drawbacks-phobias-expansion.md`.
## D-GH-2026-08-19-bar-blocked-features — one `DATA.features[lab].bar` flag, not a per-tool blocklist
- Owner needed `Barbarian: Rage`, `Druid: Wild Shape`, `Bard: Bardic Inspiration die` off the market
  immediately (real defects, fixes pending). The obvious shallow fix was extending v0.314's hardcoded
  `BARRED_FEATURES` array in CharGen — a gap audit first, before touching anything, found that array had
  only ever reached **one of five** purchase paths across both tools: CharGen's class picker was covered,
  but its Randomize action and free-typed search-all box weren't, and Live Sheet's three buy lists had
  **never** excluded even the original five features since v0.314 shipped. Generalized instead into a
  `DATA.features[lab].bar===true` flag every purchase-path filter reads directly — a property on data the
  call site already has in hand can't be forgotten the way a second array-to-import can, which is exactly
  the failure mode that left five of eight barred features unenforced for months. `bar` gates `emit()` for
  a new purchase only; `compute()` never reads it, so an existing owner (none currently exist — verified
  against the live `characters` table) still prices identically. No `DATA.version` bump — display-only.
  **Update 2026-08-20:** the three features barred for the stepped-Premium pricing defect are unbarred
  again now that the defect is fixed (`D-GH-2026-08-20-premium-autogrowth-to-stepped`); the five barred
  for an unrelated reason are untouched. Full record: `decisions/2026/D-GH-2026-08-19-bar-blocked-features.md`.

## D-GH-2026-08-19-drawback-statcap-enforcement — a stat cap is enforced in both directions
- The guide claimed *"the tool only warns, it does not block"* on stat caps. **Measured: true of CharGen,
  false of the Live Sheet**, which already blocked both directions — the claim was never accurate as written
  and had been copied into five more cells than the three first found. Owner's ruling: enforce **both**
  directions, since enforcing only "may not take it above the cap" leaves the drawback a loan (take `Frail`
  at CON 10, buy CON to 16, shed the penalty). CharGen now disables the checkbox and clamps a breaching
  score — **clamped, not reverted** (the cap is the highest legal value) and a held drawback is **never
  silently un-ticked**, which would delete a purchase and refund AP behind the player's back. Enforcing it
  made the docs load-bearing: **7 capped drawbacks documented their cap nowhere** and 5 more only in the
  guide; all 12 fixed on both sides, 63 rows now agree and all 23 caps documented. `verify-guide` gains a
  drawback-text check (9 → 10) — added **last**, once both sides agreed, since a gate red on arrival is not
  a gate. Two lessons in its construction: decode HTML entities before comparing (7 false positives), and
  compare whole values not substrings (5 cells with appended text slipped through `includes()`).
  Full record: `decisions/2026/D-GH-2026-08-19-drawback-statcap-enforcement.md`.

## D-GH-2026-08-19-amble-character-rebuild-costs — a stale `stats.rules` stamp may be corrected in place
- Owner asked whether Amble's six characters would cost differently rebuilt at `v0.356`. Replaying every
  `LOG` through `v0.341`/`v0.342`/`v0.356` showed four characters' `total` rising by **exactly their
  drawback refund** (+12/+9/+4/+3) with `spendable` rising the same amount — the `v0.354`/`v0.356` move of
  the grant from the cost side to the budget side (see `D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap`),
  not a repricing. Ledger lines byte-identical; **AP left unchanged for all four**. `v0.341` and `v0.342`
  are indistinguishable for these builds. `Moss Stormspud` is the only genuinely repriced build (2nd origin
  class 14 → 18, species traits 0 → 4, +8) — the only multiclass character — and had already been re-saved
  under `v0.356`, so it was already banked. Decision: a stale stamp **may be corrected in place by SQL**
  rather than needing a tool re-save, gated on three checks — the stamp is display-only (it drives only the
  Live Sheet drift banner, `compute()` never reads it), the cloud rows carry **no `sig`** (D-GH48 signing
  covers envelopes that leave the tool; a signed row would have been corrupted by the edit), and the
  rewrite was proven a substantive no-op *before* the banner was cleared. Verified by diffing each row
  against **its own** `character_backups` snapshot (`stats - 'rules'` and `stats->'LOG'` both md5-equal),
  which is also the rollback. Names the trap: **a bigger `total` is not evidence of a repricing** across
  `v0.354` — compare `remaining` or the ledger lines, never `total` alone. No code change, no
  `DATA.version` bump.
  Full record: `decisions/2026/D-GH-2026-08-19-amble-character-rebuild-costs.md`.
## D-GH-2026-08-19-award-drawback-double-subtract — a character lost 4 AP on every open
- Reported from real use. A character with drawbacks had its own award event rewritten LOWER on every
  CharGen open — 79 → 75 → 71 → 67 → 63, compounding without bound. Stored data, not display.
  `_cgSyncAward()` and `_buildEventBurst()` both subtracted the drawback total out of the award, which was
  correct under D-GH41 (when `b.budget` was the combined figure) and became a SECOND subtraction once
  v0.355 made `b.budget` awards-only. `applyBuild()` feeds `#budget` from `b.budget`, so each loss fed
  straight back in. Nothing caught it because **every gate opened a character exactly once** — the new
  idempotence gate runs the cycle five times (148 → 150). Live on `main` from PR #424 until this fix; the
  fix cannot restore AP already lost, and there is no safe automatic repair because the log cannot
  distinguish bug-loss from a legitimate DM adjustment.
  Full record: `decisions/2026/D-GH-2026-08-19-award-drawback-double-subtract.md`.

## D-GH-2026-08-19-heritage-pack-visibility — pack traits are derived, exported, and never stored
- Reported from real use: buying a species pack ticked nothing in CharGen and showed nothing on the Live
  Sheet. A pack is charged as ONE line and its members are owned **implicitly** — `compute()`'s `_ownsR`
  already treats them as held — but that ownership was derived and **never exported**, so no UI could
  render it. New pure-`DATA` export `packTraitsFor(species, species2)` (plus `compute().packTraits`);
  CharGen ticks the boxes for visibility and strips them again in `readBuild()`. **Not** written into
  `b.racialTraits`: in-pack traits price at 0 only while the pack is yours, so a stored one plus a species
  change re-prices at CROSS — measured, `Dwarf: Dwarven Resilience` is 0 AP on a Dwarf and silently 3 AP on
  an Elf. The fix's own first version had that bug (ticking without un-ticking left the old pack set) and
  **the gate caught it, not a human** — hence the `data-packTick` marker. tool-pricing-ci 143 → 146.
  Full record: `decisions/2026/D-GH-2026-08-19-heritage-pack-visibility.md`.

## D-GH-2026-08-19-version-labels-paint-after-engine-ready — a version label must be repainted, not just initialised
- On one page load with the engine on v0.356: CharGen's header said v0.356 but its info popup said
  **v0.339**, and the DM Console footer said **v0.176**. Same shape twice — painted at PARSE time from a
  hardcoded fallback, before the deferred module fires `engine-ready`, and never repainted. Both now paint
  again after the engine is up (`_cgPaintInfoVersions` on `engine-ready`; `_dmPaintRulesVer` in `_dmBoot`
  after `RULES` is set), keeping the parse-time call so the label is never blank mid-load. Nothing caught
  it because every existing check reads `DATA.version` directly and **none asserted what the page
  renders** — tool-pricing-ci now does, comparing rendered text rather than a fixed number so it survives
  version bumps. 146 → 148.
  Full record: `decisions/2026/D-GH-2026-08-19-version-labels-paint-after-engine-ready.md`.

## D-GH-2026-08-19-drawback-cap-player-tools — the campaign drawback cap reaches all three tools
- `feat/drawback-cap` (v0.351) wired `opts.drawbackCap` into `DM-Console.html` and **nowhere else** — 6
  occurrences there, 0 in either player tool — so a player in a capped campaign saw the FULL grant while
  their DM saw the capped figure, with nothing on either screen saying which was right. Survivable while a
  drawback was half of a cancelling pair; a straight difference in spendable AP once v0.355/v0.356 made the
  grant real income. Both player tools now pass it on the **same `'active'` gate** they already use for
  `dmAp`/`ignorePlayerAp`, and the shape-reading is extracted ONCE to `drawbackCapFromRules()` in
  `js/campaign.js` — which all three tools already import — rather than pasted into two more files.
  Two defaults both matter: an absent key is OFF, a present key with `enabled` unset is **ON** (campaigns
  saved before the flag existed), and `undefined` means advisory, not uncapped. The DISPLAYED figure moved
  with the applied one — showing the guide's 12 to a player whose DM set 8 would be the same bug in a hat.
  No `DATA.version` bump: `compute()`'s output per `(build, opts)` is unchanged; only which opts get passed.
  `tool-pricing-ci` 134 → **141**, asserted through each tool's own opts builder because the helper was
  never the broken part — the wiring was.
  Full record: `decisions/2026/D-GH-2026-08-19-drawback-cap-player-tools.md`.

## D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap — a drawback survives `ignore_player_ap`
- Once v0.355 made a drawback **income**, a question appeared that the older double-count had hidden: is
  drawback AP part of "your award history"? v0.355 answered it by accident — the grant sat inside the
  `ignorePlayerAp` bracket and was dropped with everything else, so a character in such a campaign stayed
  permanently Hexed and Leaden-Reflexed and got **nothing** for it, while every surface still listed both
  drawbacks as active. Owner's ruling: *"they just get the AP, it's not considered a grant but a trade for a
  drawback."* The grant is now composed **outside** the bracket; `playerAp` (awards) is what the toggle
  governs. Not an uncapped side door — `drawbackCap` still applies, so the two controls do one thing each.
  `earnedWithDm()` had to carve the same exception or the frozen ledger and the recompute would disagree by
  exactly the grant (the D-GH30 divergence class), and `log-fuzz` gained a `ceilingDrift` invariant to say so.
  Real effect: Amble's `Anders` (awards 0, drawbacks +6) goes 12 → 18 AP left. `DATA.version` v0.356;
  `CG-019`/`CG-020` pin both toggle states; parity 38 → 40; dm-console-ui 94 → 96.
  Full record: `decisions/2026/D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap.md`.

## D-GH-2026-08-19-drawback-single-count — a drawback is income, not negative spending (model b)
- Drawbacks were worth **double**: `foldBuild()` put the grant in `b.budget` and `compute()` also netted it
  out of `total`. A level-1 character taking four drawbacks built on **131 AP against everyone else's 79**.
  Two corrections were possible and both give the right `remaining`; **(b)** chosen — `total` counts positive
  purchases only, the budget carries the grant — because it is what the guide already promises ("Each drawback
  grants AP up front"), because (a) would print "spent −11" for any level-1 character who takes one before
  buying anything, and because `economy()` already reported it that way, so (b) ends a disagreement rather
  than adding a third view. Turned up two things the plan had not named: the `b.budget` contract had to be
  stated (the grant now arrives on that side and nowhere else), and legacy characters whose drawbacks came
  through a **patch** event would have silently lost the AP — the third near-miss of that kind in this repo.
  `DATA.version` v0.354; `EV-019` pins it; parity 37 → 38.
  Full record: `decisions/2026/D-GH-2026-08-19-drawback-single-count.md`.

## D-GH-2026-08-18-remove-subclass-access-gate — the §11 access gate is removed one version after it shipped
- v0.347 warned *"⛔ \<class\>: you cannot build from this class"* on a subclass ability or bundle from a class
  that was neither origin nor unlocked. Removed in **v0.353**. Its premise was wrong (§11 endorses the
  cross-class route explicitly), three of four cold reviewers said do not gate, it contradicted the §1 line that
  settled the flat unlock a day later — and it **did not work**: the identical ability bought through the feature
  picker cost the same 23 AP and raised no warning, because all 192 subclass abilities are mirrored into
  `DATA.features`. Its only effect was to scold one of two identical paths. Removing it moved **no price** —
  `CG-012`/`CG-013` keep their totals and just lose a warning. If a gate is ever wanted again, close the mirror
  first. Recorded in the superseded original: `decisions/2026/D-GH-2026-08-17-subclass-class-access-gate.md`.

## D-GH-2026-08-18-flat-class-unlock — class unlock becomes a flat 8 AP, and the ladder table is read with a clamp
- The old **7 × classes-you-already-own** ladder contradicted the guide twice. §11 says the class unlock
  *"mirrors how subclasses are bought"*, and the actual subclass rule is *"a flat 15 AP to open, however many
  you already have"* — flat, explicitly non-escalating. §1 sells cross-class as *"just a shopping list, not a
  multiclass puzzle"*, and a price depending on what you already own is a puzzle. Its table also had **five
  rungs for twelve classes** read with `|| 0`, so a fifth unlock **refunded** the 70 AP paid for the first four
  (negative with a 2nd origin class). Now flat 8, with `DATA.unlockCum` at 13 rungs read through a **clamp** —
  `|| 0` turns "indexed past the table" into "free"; a clamp under-charges at worst. `7 + tier` measured as the
  most restrictive option and was rejected on fit, not numbers: "commit early or pay more" is what §1's *"grows
  in the direction you steer it"* rejects. `DATA.version` v0.352. **Exposed a gate gap:** three worked examples
  silently stopped adding up and `guide-price-check` passed throughout.
  Full record: `decisions/2026/D-GH-2026-08-18-flat-class-unlock.md`.

## D-GH-2026-08-18-drawback-cap-and-second-origin — the drawback cap becomes real in a campaign and advisory outside one; the 2nd origin class goes 14 → 18
- The engine claimed in a comment that drawbacks were capped at 14 AP and enforced nothing: all 69 together
  granted **217 AP**, more than a level-11 character's whole feature budget. The guide meanwhile said **12**.
  Three answers at once — guide 12, engine text 14, engine behaviour unlimited. Now clamped when a campaign
  passes `opts.drawbackCap` and advisory otherwise, because a campaign has a DM to adjudicate and a solo build
  does not. Default **12** in `DATA.drawbackCap`, matching the guide: nothing depended on 14, so the cheaper
  correction was to fix the comment rather than edit a published rule. The 2nd origin class goes 14 → 18 —
  at 14 it paid for itself after six features AND matched the drawback allowance exactly, so two drawbacks
  funded it for free with no warning. `DATA.version` v0.351.
  Full record: `decisions/2026/D-GH-2026-08-18-drawback-cap-and-second-origin.md`.

## D-GH-2026-08-17-unlock-checkbox-dead-control — the class-unlock checkbox was a dead control, so the unlocked price tier was unreachable; the fix is capture-phase delegation, not ordering luck
- Ticking "unlock \<class\>" in CharGen did **nothing**: no `unlockclass` event reached the LOG and the box
  sprang back. Two layered causes — an inline `onchange="render()"` (target phase, runs before any bubble
  listener) and `#form`'s own `input -> render()` (a checkbox click fires `input` first). Either way `render()`
  re-derived `checked` from a LOG with no entry yet, un-ticked the box, and the delegated handler read
  `checked === false` and **retracted**. So the whole middle price tier — the entire point of
  `bundle-three-tier-pricing` — was unreachable from the UI. Fixed by binding the checklist delegation in the
  **capture** phase for both `input` and `change`, which beats every bubble listener by construction rather
  than by registration order. Invisible to synthetic events: `dispatchEvent(new Event('change'))` skips
  `input` and passes. No `DATA.version` change.
  Full record: `decisions/2026/D-GH-2026-08-17-unlock-checkbox-dead-control.md`.

## D-GH-2026-08-17-renamed-feature-aliases — a renamed `DATA.features` key silently deletes the purchase from every saved character, so renames need an alias map
- `compute()`'s `if(!f) continue;` means a removed feature key is dropped from a saved character **with its AP**,
  silently. This branch removed two (`Druid: Elemental Fury / Improved circle` split by v0.346;
  `Paladin: Aura expansions` renamed by v0.345) with no migration. A backfill can't reach a JSON file on
  someone's disk, so the fix is read-time: `DATA.featureAliases` + `FEAT_ALIAS()`, applied at `MUT.feature`
  (replay normalises the build) and at `compute()`'s lookup (a directly-supplied build still prices).
  **Add an entry whenever a `DATA.features` key is renamed or removed.** Fixture `CG-015` asserts it.
  Full record: `decisions/2026/D-GH-2026-08-17-renamed-feature-aliases.md`.

## D-GH-2026-08-17-bundle-three-tier-pricing — §13's spell-access exemption covers the spell *economy*, not spell-*granting* features, so subclass bundles carry the ordinary cross-class surcharge
- Bundles had two prices, not three: unlocking a class bought a **0 AP** reduction on a bundle while saving
  real AP on that class's abilities. §13 reads as though anything spell-shaped is exempt from +Tier, and
  **three of four cold reviewers** concluded exactly that — but the engine has always priced spell-*granting*
  features with the full surcharge (`Bard: Magical Secrets` 13/17/22, `Warlock: Pact of the Tome` 18/18/19,
  `Wizard: Signature Spells` 14/20/27). Pact of the Tome is a bundle's structural twin. §13 protects the spell
  *economy* — Foundations, Ranks, slots, spells known — where +Tier **compounds**. Bundles now price
  origin / unlocked / cross-class; Life Domain 6 / 8 / 11. No origin or unlocked price moved: storing the
  **undiscounted** sum as the basis makes double-discounting impossible by construction. `DATA.version` v0.350.
  Full record: `decisions/2026/D-GH-2026-08-17-bundle-three-tier-pricing.md`.

## D-GH-2026-08-17-subclass-class-access-gate — ⛔ SUPERSEDED (removed v0.353): subclass purchases warned when the class was neither origin nor unlocked; the framing that motivated it was wrong
- `compute()` now raises a ⛔ warning (not a refusal) when a subclass ability or bundle is bought from a class
  that is neither origin nor unlocked — the guide's *"each class you can build from"* was never enforced, and
  three foreign spell lists cost 35 AP with no unlock and no warning. **Recorded with its own correction:** the
  motivating analysis called the per-feature cross-class route a "ladder dodge", but §11 blesses it explicitly
  (*"the per-feature surcharge is cheaper for a single dip"*). What survives is narrower — the unlock **ladder
  does not accrue**, so a permanent dabbler never pays for breadth. Reviewers split 3–1 against gating bundles,
  2–2 on abilities. **Contested; do not treat as settled.** `DATA.version` v0.347.
  Full record: `decisions/2026/D-GH-2026-08-17-subclass-class-access-gate.md`.

## D-GH-2026-08-17-stars-starmap-split — Circle of the Stars' spells belong to the bundle; Star Map is repriced to cover only the free-cast
- The 5 AP Stars bundle (Guidance + Guiding Bolt) and the `Star Map` ability were the same content sold twice —
  the guide's own row read *"Star Map (Guiding Bolt prepared + free-cast + Guidance cantrip)"* — so a player
  could buy both for 11 AP. The bundle keeps the spells; Star Map repriced **T3 Situational 6 (4) → T2 Per-Rest
  5 (4)**, covering only the free-cast. Anchored on two 1st-level slots costing an origin caster 6 AP, verified
  through `compute()`; 5 sits under it because the free-cast only ever casts one spell. Stars is now 9 AP
  all-in at origin. `DATA.version` v0.349.
  Full record: `decisions/2026/D-GH-2026-08-17-stars-starmap-split.md`.

## D-GH-2026-08-17-subclass-features-mirror — Every subclass ability has two purchase routes with separate dedup domains; removing the mirror is deferred rather than rushed
- All 192 subclass abilities are mirrored into `DATA.features` (188 in `featureList`, so CharGen's *feature*
  picker offers them alongside its *subclass* picker). The two routes have separate dedup domains, so the same
  ability bought in both pickers charges **twice with no warning**, skips subclass-unlock accounting, and
  bypasses the v0.347 gate. **Identified and measured, not fixed** — unifying needs a LOG-migration decision
  (`b.subSpellBundles` is in saved characters) and a fix for Circle of the Land's terrain variants, which don't
  fit `subAbilMap`'s key shape. Filed as `refactor/subclass-purchase-unify`. No `DATA.version` change.
  Full record: `decisions/2026/D-GH-2026-08-17-subclass-features-mirror.md`.

## D-GH-2026-08-16-heritage-pack-pricing — In-pack species traits carry their real MASTER price; the pack, not a zeroed field, is what makes them free
- Every in-pack trait was stored `origin: 0`, coupling *price* to *pack membership* — so a trait leaving a
  pack silently became **free**. That had already happened (`Goliath: Long Stride`, free and unnoticed) and
  was about to happen to three more traits being unpacked in the same change. The guide had it right all
  along: Appendix B printed real `MASTER[tier][band]` prices with a separate `In pack` column. Engine now
  matches, with a `r.pack && isO → 0` guard in `compute()`. Output-neutral (parity 30/0, no
  `testing/expected/` change). `DATA.version` v0.343 → v0.344.
  Full record: `decisions/2026/D-GH-2026-08-16-heritage-pack-pricing.md`.

- **D-GH-2026-08-12-guide-engine-version-pointer** — Players Guide (separate `pact-guide` project) now
  declares a machine-generated `documents-rules:` pointer (version/branch/commit, sourced from
  `pact-guide`'s existing vendoring pipeline, stamped only on deliberate reconciliation — never
  auto-advanced by a vendor refresh), kept distinct from its own independent `content-version` doc
  revision. Mirrored branch is `main`. This repo's served `docs/PACT-Players-Guide.html` gets a
  documented (manual) update procedure in `docs/VERSION-SYNC.md`; content itself not yet updated — that
  lands with the next transfer. Docs/tooling only, no `DATA.version`/`compute()` change. Cold-reviewed
  (4 reviewers, `z-cold/` on branch `zcold`).
  Full record: `decisions/2026/D-GH-2026-08-12-guide-engine-version-pointer.md`.
- **D-GH-2026-08-12-grit-steep-ladder** — Grit now costs **2N for the Nth purchase** (the Steep ladder),
  replacing the `2/4/6/9/12/15/18` table and its `m*(m+1)` tail. Owner's balance call, but also removes an
  outlier: every other track in `DATA` escalates linearly per purchase, and the old Grit tail was the only
  cubic-cumulative one. "Steep" is the project's own existing name for this shape
  (`pact-guide/py/pricing.py`). Level-independence and the flat +1-past-CON-mod surcharge are unchanged.
  Zero saved characters had any Grit purchase, so no migration. `DATA.version` v0.342 → v0.343;
  CG-010 165→135, CG-011 197→167; parity 30/0. Supersedes the pricing half of
  `D-GH-2026-08-05-grit-ladder-correction`.
  Full record: `decisions/2026/D-GH-2026-08-12-grit-steep-ladder.md`.
- **D-GH-2026-08-11-character-claim-link-copy-not-transfer** — re-scoped the not-yet-started
  `feat/character-ownership-claim-link` task from an ownership-*transfer* RPC (reassigning `owner_id` on
  the DM's existing character row) to a *copy* (a new row seeded from the DM's character, owned by the
  redeeming player from creation). Needs no RLS/ownership-model change — a player inserting their own row
  is already what the existing insert grant allows — which drops the task's risk from high to medium and
  removes the recommended cold-plan-review step, since the trust-boundary risk it existed to catch no
  longer exists.
  Full record: `decisions/2026/D-GH-2026-08-11-character-claim-link-copy-not-transfer.md`.
- **D-GH-2026-08-10-supabase-keep-alive** — the PACT Supabase project auto-paused from inactivity on
  2026-07-25, silently breaking login/register app-wide until manually restored. Fixed with a scheduled
  GitHub Actions workflow (`.github/workflows/supabase-keepalive.yml`, every 3 days) pinging Supabase's
  `/auth/v1/health` endpoint with the already-committed anon key — chosen over a direct table read
  because every RLS-protected table correctly 401s an anonymous request, which would make a genuine
  outage indistinguishable from expected RLS behaviour in the workflow's own pass/fail check. Paid-tier
  upgrade (removes auto-pause entirely) considered and deferred — a recurring cost only the project
  owner can approve, not decided unilaterally.
  Full record: `decisions/2026/D-GH-2026-08-10-supabase-keep-alive.md`.
- **D-GH-2026-08-10-dm-custom-character-fields** — owner request: campaign-level custom character fields
  (2 numeric, 2 text) with a per-field "visible to players" toggle (default OFF), plus a new
  "Customisable" roster card view. Definitions ride `campaigns.rules.customFields` (no new table); values
  ride a new `character_dm_notes.custom_fields` jsonb column (reuses that table's existing DM-only RLS);
  visibility is enforced server-side by a new `get_character_visible_fields()` SECURITY DEFINER RPC, not
  a wider table grant (RLS is row-level, not per-JSON-key — a grant wide enough for a visible field would
  leak every hidden one in the same row). Box layout is per-device (`localStorage`), matching Table view's
  hidden-columns precedent. **Addendum, same day:** the player-facing consumer
  (`feat/custom-fields-player-display`) shipped too — the Live Sheet now shows a `From your DM:` segment
  on a signed-in player's own campaign-bound character, sourced from the same RPC, escaped, and gated off
  for a DM's own read-only `?viewChar=` peek.
  Full record: `decisions/2026/D-GH-2026-08-10-dm-custom-character-fields.md`.
- **D-GH-2026-08-10-expand-random-names** — owner report: "i keep getting the same name." Each of the six
  `NAMEDATA` naming styles held only ~12-16 first / ~8-10 last names; expanded every style ~3-4x (≥40
  first / ≥25 last, gated), additively (originals kept, new names appended, no reshuffle), matching each
  style's existing theme. `genName()` itself unchanged — same shape, more data. `tool-pricing-ci.mjs`
  134/0; `engine-parity-ci.mjs` unaffected, 30/0 (pure flavour data, not the rules dataset).
  Full record: `decisions/2026/D-GH-2026-08-10-expand-random-names.md`.
- **D-GH-2026-08-10-custom-appearance-fields** — owner request: two free-form, player-labeled detail
  fields on CharGen's Appearance panel (own label, own sentence, no fixed prompt, no random table — so no
  🎲/🔒 unlike every other field). `ap_`-prefixed ids ride the existing generic patch delegation
  (`_cgPatchSlotForId`'s prefix match) with zero new commit wiring; only the DOM↔build translation needed
  the two new keys added, including the build→DOM reload direction (a real gap, caught by hand-reading
  `applyBuild`'s field list and locked in with a regression test that fails without that one line).
  `tool-pricing-ci.mjs` 132/0 at that point in the session; `engine-parity-ci.mjs` unaffected, 30/0.
  Full record: `decisions/2026/D-GH-2026-08-10-custom-appearance-fields.md`.
- **D-GH-2026-08-10-randomise-appearance-not-persisted** — found live on a real Amble character: CharGen's
  "🎲 Randomise all" appearance control (and "🪶 Auto-write" description) set DOM field values directly
  with no LOG write, so the randomised text rendered convincingly on screen but vanished on the next
  reload/save/tool-switch. A second, adjacent code path to `fix/sheet-tab-appearance-not-persisted`
  (Setup-tab `apField()` inputs, not the Sheet tab's manually-typed fields, which that fix already
  covers) that never got the same treatment. Fixed by routing both through the existing
  `_shCommitAppearanceField()` — the same primitive manual typing already uses, so it also coalesces
  correctly into one patch event. New regression tests confirmed to fail without the fix (DOM populated,
  LOG empty) and pass with it. `tool-pricing-ci.mjs` 128/0; `engine-parity-ci.mjs` unaffected, 30/0.
  Full record: `decisions/2026/D-GH-2026-08-10-randomise-appearance-not-persisted.md`.
- **D-GH-2026-08-10-dm-ap-lost-on-handoff** — found live on a real Amble character: DM AP read as "🛡 0
  AP — DM only" in CharGen after switching from the Live Sheet, despite showing correctly in both the
  Live Sheet and DM Console. Root cause: `_cgAdoptEnvelopeBinding()` gated its DM-AP refresh on
  `window._cloudSignedIn`, a flag the `'campaign-ready'` listener itself resets to `false` the instant it
  fires and only asynchronously re-sets afterward — a race that could skip the refresh for a genuinely
  signed-in user while `_dmApStatus` (resolved separately, from the campaign fetch alone) still reported
  `'active'`. Fixed by asking the auth bridge directly (`currentSession()`) instead of trusting the flag,
  matching `_cgConsumeViewChar()`'s existing pattern. New regression test confirmed to fail without the
  fix and pass with it (hand-verified by reverting just the fix). `tool-pricing-ci.mjs` 126/0;
  `engine-parity-ci.mjs` unaffected, 30/0 — display/timing only.
  Full record: `decisions/2026/D-GH-2026-08-10-dm-ap-lost-on-handoff.md`.
- **D-GH-2026-08-10-ledger-show-lost-purchases** — the AP ledger showed NOTHING for a bought-off drawback
  or a DM-removed boon: `compute()` is pure over the build, and both drop out of `_replay()`'s fold
  entirely, so their AP (still real, permanent spend) was invisible to `compute().total` while
  `economy().spent` still counted it. New "Lost purchases" ledger line (owner's chosen shape, adds to
  total) itemises `"Bought off — X"`/`"Removed by DM — X"` rows, sourced from a new `lost` key on
  `activeEvents()`'s existing FIFO-match pass and stamped onto the build as `b._lostPurchases` by
  `_replay()` (same pattern as `_raceTraitLocked`/`_vigorRankTier`) — `compute()` still never reads the log
  directly. A repurchase (bought, bought off, bought again) shows both the active retake AND the lost
  buyoff simultaneously, by construction. `DATA.version` bumped (three existing fixtures' totals moved).
  Full record: `decisions/2026/D-GH-2026-08-10-ledger-show-lost-purchases.md`.
- **D-GH-2026-08-10-ap-model-reconcile** — Earned Lv/apLevel used `trackLevel(eco.earned)`, log-only, so
  a fully DM-funded character read "Earned Lv 0" even with real AP granted. New pure `earnedWithDm(eco,
  opts)` engine export (display-time composition, `economy()` itself untouched) mirrors `compute()`'s own
  spendable formula; both tools now read Earned Lv/next-level/apLevel from it via the shared
  `window._engineFold` bridge. Card-vs-AP-Ledger disagreement stays allowed (G1, unchanged) but is now
  labelled on both surfaces in both tools. Low-tier campaigns reading below-curve Track-Level confirmed
  intended, no clamping. Fenwick Copperkettle's exact real numbers were not reproducible as a fixture (no
  access to the real campaign data in this environment) — recorded explicitly rather than assumed pinned.
  Full record: `decisions/2026/D-GH-2026-08-10-ap-model-reconcile.md`.
- **D-GH-2026-08-10-dm-edit-events** — a DM adds/removes boons and imposes drawbacks on a campaign
  character, recorded in the character's own LOG as a server-attributed `dmEdit` event that never moves
  their spendable AP. New `dm_edit_character_log` SECURITY DEFINER RPC (the only DM write path onto
  `characters.stats`), server-stamped `seq`/`ts`/`dmEdit`/`dmId` so the marker can't be forged for a
  different account, allowlisted to boon/drawback events only. Boon removal is the one engine change
  (`activeEvents()`'s new `boonRemoved` FIFO map, mirroring the buyoff fix); everything else achieves
  neutrality through existing mechanics with no `DATA.version` bump. DM Console gained grant/remove/impose
  controls; the Live Sheet renders DM-marked events distinctly and enforces its own undo barrier + a
  DM-imposed drawback's locked/removal-cost flags; CharGen gets the undo barrier only (no per-event
  history view to mark, a documented scope boundary). **Addendum, same day (`/sweep-code-tasks`):**
  `dm_edit_character_log` now cross-validates a boon grant's paired `buy`/`award` amounts (FIFO-by-value),
  closing a correctness gap the pre-merge review flagged and deliberately deferred — see the file's own
  addendum for why a standalone `award` stays permitted (not a new privilege; `award_ap()` already grants
  arbitrary AP unconditionally).
  Full record: `decisions/2026/D-GH-2026-08-10-dm-edit-events.md`.
- **D-GH-2026-08-10-chargen-dm-view** — a DM opens a campaign character in CharGen via a safe, freely
  editable COPY (owner's chosen approach) rather than a locked read-only view — safe by construction
  (a copy with its own id cannot touch the original) rather than by a twelve-entry-point guard list.
  Copy id is `SHA-256(source id, viewing DM's id)`, formatted as a UUID: deterministic per (source, DM)
  pair for overwrite-per-source, structurally asserted to never equal the source id. Cloud-saved, not
  campaign-bound. "📋 Copy to CharGen" added beside DM Console's existing read-only "👁 View" button.
  **Addendum (2026-08-22):** the copy's budget math ignored the DM AP its own display line showed —
  fixed by feeding the already-captured frozen snapshot into the budget instead of 0; rejected a
  live-syncing shadow-campaign alternative as disproportionate.
  Full record: `decisions/2026/D-GH-2026-08-10-chargen-dm-view.md`.
- **D-GH-2026-08-10-invite-peek-auth-scope** — new `peek_player_invite(token)` RPC resolves a player
  invite to its campaign name without redeeming it, closing the "CharGen's accept confirm() can't name
  the campaign" gap. Scoped `authenticated`-only (not anon-callable) since `feat/invite-rate-limiting`
  hasn't landed yet — the signed-out "dead link looks live" gap stays open as an accepted tradeoff.
  Advisor confirms no new finding class; grants verified directly.
  Full record: `decisions/2026/D-GH-2026-08-10-invite-peek-auth-scope.md`.
- **D-GH-2026-08-10-unnamed-character-default** — CharGen/`js/sync.js` already stamped a real stored
  default name (`'New Character'`, matching `sql/schema.sql`'s column default), but DM Console converted
  it back to blank and substituted a different literal (`'Unnamed character'`) at display time, and each
  tool separately carried its own placeholder for the live pre-save state (`'Unnamed Hero'`/`'Unnamed
  hero'`/`'Unnamed'`). All unified on `'New Character'` everywhere — one convention, no second literal
  left in the codebase. Display-only, no `DATA.version` change, existing characters unaffected.
  Full record: `decisions/2026/D-GH-2026-08-10-unnamed-character-default.md`.
- **D-GH-2026-08-10-add-player-hierarchy** — DM Console's three add-player routes (Players code,
  invite link, local-file import) had equal visual weight and no guidance. Invite link (new character)
  is now the default, badged "✓ Usual choice" and shown first; Players code follows, captioned for the
  "already has a character" case; local import gained its own caption distinguishing it as a read-only
  viewer, not a campaign-roster join. Copy/ordering-only, no `DATA.version` change.
  Full record: `decisions/2026/D-GH-2026-08-10-add-player-hierarchy.md`.
- **D-GH-2026-08-10-campaign-ap-log-integrity** — server-side backstop for the AP-overspend trust
  boundary, following a 7-AI external review batch (`z-cold/`). Two BEFORE UPDATE triggers on
  `characters`, campaign-bound only: `pact_enforce_ap_budget_consistency` (frozen-cost-sum, non-regression
  guarded — a genuinely different, complementary check to the client gate's repriced `compute().remaining`,
  not a mirror of it) and `pact_enforce_locked_history` (makes Live Sheet's own `undo()` boundary — the
  last non-discretionary `award` event — server-authoritative append-only protection, with `cat:'patch'`
  events exempt so CharGen's `replacePatchSlot()`/Live Sheet's `_shCommitAppearanceField` keep working).
  Pure ledger arithmetic, no `DATA`/pricing reference, so neither duplicates `js/engine.js`. The Edge
  Function idea (N3) was deferred to the task board — confirmed `compute()`/`economy()` only sum frozen
  costs rather than re-deriving them, so it wouldn't give a stronger guarantee than the SQL trigger for
  locked characters.
  Full record: `decisions/2026/D-GH-2026-08-10-campaign-ap-log-integrity.md`.
- **D-GH-2026-08-09-zcold-autosync-setup** — `z-cold`/`z-uploads` are drop-zone folders: anything placed
  in them locally gets auto-committed and pushed within seconds by an external background script (not
  part of this repo). They live on a dedicated `zcold` branch via a **git worktree + Windows
  junction**, not on `preview` — a plain tracked folder was tried first but broke the moment a sibling
  repo's working copy switched branches, since git can't check the same branch out twice. Also folds in
  the pre-existing `z-cold-reviews/` content, moved in during setup.
  Full record: `decisions/2026/D-GH-2026-08-09-zcold-autosync-setup.md`.
- **D-GH-2026-08-09-campaign-ap-budget-enforce** — new campaign setting `rules.enforceApBudget`
  (default true) blocks a campaign-bound character's CLOUD save (manual + autosave, both tools) once
  `compute()`'s `remaining < 0`; local file Save and DM Console (no save path of its own) are never
  touched. Client-side only, deliberately — mirrors `validate()`'s existing enforcement style, since
  true DB-level enforcement would mean reimplementing `compute()`'s pricing math in SQL, violating the
  hard rule that `js/engine.js` is the only place rules logic lives. DM Console's new toggle copies the
  existing `ignorePlayerAp` lock-guarded UI pattern verbatim. Grandfathered — turning it on never
  retroactively touches an already-over-budget character, only blocks the next save attempt. Manual save
  alerts with a clear reason; autosave skips silently after one warning per session, mirroring
  `_cgConflictWarned`/`_lsConflictWarned` exactly.
  Full record: `decisions/2026/D-GH-2026-08-09-campaign-ap-budget-enforce.md`.

- **D-GH-2026-08-09-sheet-tab-appearance-not-persisted** — the fillable "📋 Sheet" tab's Appearance grid
  and Background & Personality block (gender/age/height/build/hair/eyes/skin/marks/voice/hometown/faith/
  ambition/fear/prized/companion/Description) are real `b.appearance` data, but were rendered through the
  same local-`localStorage`-scratchpad mechanism as genuinely scratch fields (Player Name, Notes, spell
  trackers) — so an edit made there never reached the LOG, never synced to the cloud, and looked like it
  "disappeared" the moment the character was reopened in the other tool (a different, empty scratchpad
  namespace per tool). Fixed by routing those 16 fields into the real LOG: CharGen reuses its existing
  `PATCH_SLOTS.APPEARANCE`/`replacePatchSlot()` coalescing mechanism; Live Sheet (which has no
  Setup-panel equivalent — the Sheet tab is its only editor for these fields) gained a new
  position-stable replace-in-place helper mirroring the same "don't move the ledger line, don't let
  undo() eat it" rule. Both merge into the FULL current appearance object so fields the Sheet doesn't
  show (nose, demeanour, quirk, likes, dislikes, father, mother, profession, familyfor, famevent, secret,
  drink) survive untouched.
  Full record: `decisions/2026/D-GH-2026-08-09-sheet-tab-appearance-not-persisted.md`.

- **D-GH-2026-08-09-harden-invitation-system** — `campaigns.dm_invite_code` was readable by any campaign
  member (row-level RLS, no column exclusion) and redeemable by any authenticated account system-wide via
  `join_as_dm()` with no membership check — a confirmed live privilege-escalation bug. Fixed by dropping
  `dm_invite_code`/`join_as_dm()`/`regenerate_dm_invite_code()` outright and unifying DM invites onto the
  existing hardened player-invite model (`campaign_invites`, extended with `type`/`mode` columns,
  `create_dm_invite()`/`redeem_dm_invite()`). Went through a 6-reviewer cross-vendor cold review before
  implementation; four resulting product/security decisions (redemption scope, single-use-vs-reusable
  default, no emergency hotfix, rate limiting split off) resolved with the project owner. Player-invite
  tokens deliberately stay plaintext (DM Console's invite list re-displays them, unlike DM invites, which
  have no such legacy behavior); no auto-generated replacement DM invite for existing campaigns (a
  migration-time token would be unretrievable under hash-only storage). A self-caught grant-drift
  regression (a `DROP FUNCTION` needed for a signature change wiped a `REVOKE EXECUTE FROM PUBLIC`) was
  found and fixed via the Supabase advisor in the same session.
  Full record: `decisions/2026/D-GH-2026-08-09-harden-invitation-system.md`.
> One line per decision, in document order (newest on top). Follow each entry's "Full record:" pointer
> to the full **Context → Options → Decision → Why → Status** writeup under `decisions/2026/`.

- **D-GH-2026-08-08-chargen-header-followup-2** — Continued mobile review found two more gaps: no
  consolidated 📁 Local menu on mobile (New/Save/Load stayed scattered across two bars while ☁ Cloud
  got its own mobile trigger in the prior fix), and no way to see the app/rules version numbers on
  mobile at all (both header labels are hidden below 1150px, `.hd-row2` itself below 768px). Fixed by
  extending the Cloud menu's reparenting technique to Local, and by making the Info panel copy the
  header version spans' live text rather than hand-duplicating the strings a third time. Verified with
  DOM-state assertions only (rects/classList/textContent) — no screenshots this round, per explicit
  instruction to stop taking them without asking first. **Addendum, same branch:** the Info panel's own
  guide text was separately found stale — it still described the pre-D-GH40 Live Sheet export/converter
  flow (removed months ago), never mentioned Cloud/Local/autosave at all, and listed only 1 of 4 "Other
  outputs" buttons. Rewritten to match the current header.
  Full record: `decisions/2026/D-GH-2026-08-08-chargen-header-followup-2.md`.
- **D-GH-2026-08-08-chargen-header-followup** — Owner review of the Local/Cloud split (real-browser
  screenshots, not assumed) found three gaps: `.hd-row2` wrapped the theme selector onto its own line
  below ~1150px (a common laptop width), mobile had zero cloud access at all (a pre-existing gap that
  became conspicuous once desktop's cloud access got a clean label), and the ☁ Cloud menu was missing
  the New Character option the 📁 Local menu had. Fixed via a narrower-width media query hiding the two
  least-critical version labels, a mobile "☁ Cloud" trigger that reparents the single existing
  `#cgCloudMenu` element (avoiding ID-collision risk from duplicating the whole rich menu), an
  `overflow-y:visible` fix for a CSS overflow-axis coupling that was clipping the reparented dropdown,
  and adding New Character to the Cloud menu too. A same-session mobile→desktop resize edge case in the
  reparenting logic was caught by an actual round-trip headless test, not assumed safe.
  Full record: `decisions/2026/D-GH-2026-08-08-chargen-header-followup.md`.
- **D-GH-2026-08-08-chargen-local-cloud-split-new-character** — CharGen's header cluster still read
  as two disconnected pieces (cloud actions behind a lone unlabeled "⋯," local Save/Load as loose
  buttons in the row below) even after the general header declutter, so local and cloud actions were
  split into two clearly-labeled dropdown menus ("📁 Local" / "☁ Cloud") on the same header row. Also
  fixed the "no New Character button" gap by discovering Reset already silently minted a fresh
  character id on every use (never overwriting the previous character, just detaching from it with no
  explanation) — relabeled it "🆕 New Character" rather than building new in-place-wipe behavior, and
  fixed a real bug found while tracing this: a still-pending cloud autosave for the outgoing character
  could get silently redirected to the new blank character's id when its debounce timer fired.
  Full record: `decisions/2026/D-GH-2026-08-08-chargen-local-cloud-split-new-character.md`.
- **D-GH-2026-08-08-header-declutter** — CharGen/Live Sheet's cloud-status header cluster (badge +
  sign-in link + campaign select + sync chip + Autosave toggle + ⋯/☁ menu, ~5-6 always-visible elements)
  simplified per the owner's chosen "moderate consolidation" option: the campaign badge now shows only
  the one thing nothing else already says (campaign name/rules state) instead of also duplicating
  signed-in/out text; the Autosave toggle moved into the existing cloud menu as a settings item; the
  header's file-build "Last edited" timestamp moved into each tool's Info panel (or DM Console's
  footnote, which has no info modal). A DOM-order bug in the timestamp relocation (script ran before its
  target element existed) was caught and fixed before shipping.
  Full record: `decisions/2026/D-GH-2026-08-08-header-declutter.md`.
- **D-GH-2026-08-08-universal-autosave-toggle** — Part B3's autosave-eligibility design (a one-way
  consent-timestamp model, with campaign-bound characters kept on a separate always-on no-toggle path)
  was replaced, at the owner's direct request, with one universal, freely-reversible per-character
  toggle covering every character including campaign-bound ones. Accepted consequence: a player can
  switch off autosave on a DM's campaign character, and the DM's roster can go stale until they save
  again manually — the exact problem campaign-bound autosave was built in 2026-08-03 to prevent — taken
  on knowingly rather than overlooked, with DM-facing visibility into the toggle state left as an open
  follow-up for whoever builds the UI. `characters.autosave_enabled boolean default true`, a plain
  column grant mirroring `archived_at`'s precedent (not the RPC originally planned — see the full
  record's "Consequence for the data model" for why). SHIPPED 2026-08-08.
  Full record: `decisions/2026/D-GH-2026-08-08-universal-autosave-toggle.md`.
- **D-GH-2026-08-08-chargen-cloud-autosave-flush** — CharGen's debounced cloud autosave only ever
  *scheduled* a push, and nothing flushed a pending one on navigation — CharGen's own "Open in Live Sheet"
  button re-armed the timer and navigated away in the same breath, guaranteeing that push never fired.
  Found while cold-reviewing a larger header/autosave plan (4 models, 2 vendor families, converged
  independently on this as blocking). Split into two honest guarantees: in-app navigation now `await`s a
  bounded flush of the real (or already-in-flight) push; uncontrolled exit (tab close) gets a best-effort
  `pagehide` flush via `fetch(...,{keepalive:true})` — `sendBeacon` can't carry the auth headers an
  authenticated write needs, and a plain non-keepalive fetch isn't guaranteed to survive page teardown.
  Uncontrolled exit is documented as best-effort, not guaranteed, on any browser — the durable fallback
  stays the local autosave plus the dirty-record retry on next boot. Split from the larger plan (Part A of
  2), which is otherwise deferred pending the sync-state-machine and autosave-consent design work the
  review surfaced. **Addendum, 2026-08-10 (`fix/autosave-flush-latest-push`):** the busy branch's
  promise-tracking claim above was incomplete — it returned a stale in-flight push, not the retry that
  actually carried the latest edit; fixed with a recursive `*CloudPushSettled()` waiter. Reopens, without
  fully resolving, this record's own "narrow window" assumption for `withKeepalive()`'s shared toggle —
  see `feat/keepalive-scope-narrowing` on `docs/TASK_BOARD_NEXT.md`.
  **Addendum, 2026-08-11 (`feat/keepalive-scope-narrowing`):** resolved as A2 — narrowed the window back
  down (each push attempt opens its own `withKeepalive()` span via a new `_cg/_lsKeepaliveWrap()` helper,
  instead of one span held open for the whole settle-wait) rather than formalizing the widened window as
  an accepted trade-off. **Addendum, 2026-08-11 (`fix/manual-save-queue-bypass`):** the manual "☁ Save to
  cloud" button in both tools (and CharGen's campaign-join flow) called `saveCharacter()` directly,
  racing the autosave queue's own push for the same character — fixed with a shared
  `_cg/_lsQueuedSaveCharacter()` helper that waits for any in-flight push to settle and shares the same
  busy-flag coordination, while still surfacing its own success/failure UI (unlike the silent autosave
  path).
  Full record: `decisions/2026/D-GH-2026-08-08-chargen-cloud-autosave-flush.md`.
- **D-GH-2026-08-07-optimistic-character-save** — cloud saves were last-write-wins, so two devices on one
  character silently destroyed each other's **entire** history (the whole event log lives in `stats`).
  Guarded on the server's `updated_at`, carried client-side as a separate `base_updated_at`. Took four
  rounds, and the last two are the point: the base was being read from **localStorage**, which a
  background `reconcile()` refreshes, while the content came from the page's **in-memory build** — so a
  background sync handed a stale page a fresh base and the guard waved the overwrite through (seen in
  production: 43 AP spent → 47 → back to 43). The base now travels with the copy the page holds. And a
  refused save had no exit: `Cloud → Load` returned your own stale copy forever, which is what the
  conflict message told you to use. It now asks before discarding. Also corrects the task's own premise
  that "no automated gate can reach this" — it could; `testing/scripts/sync-concurrency-ci.mjs` is
  differential and catches both late defects. See `decisions/2026/D-GH-2026-08-07-optimistic-character-save.md`.
- **D-GH-2026-08-07-character-backups** — cloud characters now get an **automatic pre-change
  snapshot**. A real character was lost: the owner believed they'd unbound it (`dm_unbind_character`
  only nulls `campaign_id`), but `js/sync.js` `deleteCharacter()` is a literal hard `delete` and
  nothing captured the row. Overwrites were equally unrecoverable. A `BEFORE UPDATE OR DELETE`
  trigger writes the OLD row to a new `character_backups`; newest 50 `update` snapshots per
  character, `delete` snapshots kept forever. Deliberately **no foreign keys** (they'd cascade the
  backups away with the row), **`SECURITY DEFINER`** (the trigger fires as the player, who has no
  grant on the table), **`clock_timestamp()`** not `now()` (transaction time ties, and the prune
  would fall back to random-uuid order). RLS on with zero policies — dashboard/service_role is the
  only reader, no new admin role, same posture as `feedback`. Sized first: ~2.6 KB per snapshot, so
  50 × the whole roster ≈ 2 MB. **Not retroactive.**
  Full record: `decisions/2026/D-GH-2026-08-07-character-backups.md`.
- **D-GH-2026-08-06-creation-lock-survives-reload** — creation ends by being **recorded**, not re-derived.
  Both of the engine's lock paths were dead in CharGen: the automatic one is suppressed by the burst's
  blanket `noLock` (which fixes D-GH34 and must stay), and no tool had ever emitted the explicit
  `creationLocked` the engine calls *"the primary intended trigger"*. Since `_locked` is derived state
  rebuilt on every replay, nothing survived a reload. `_cgRepriceDraft()` now appends `creationLocked`
  once spend passes the threshold, mirroring `_replay()`'s own resolution — armed-only, strictly-over,
  and never against an explicit unlock. Chosen over removing `noLock` (owner, H2): the burst's order is
  synthetic, so that would put the lock at an arbitrary point in it. Measured on an imported over-budget
  character — lock is the **last** event, 12 buys before it, 0 after, racial traits still pre-lock. Does
  **not** deliver per-portion pricing inside an import; that half stays open. No `DATA.version` change.
  Full record: `decisions/2026/D-GH-2026-08-06-creation-lock-survives-reload.md`.

- **D-GH-2026-08-06-buyoff-keyed-by-event** — a `buyoff` cancels the specific purchase it targets, not
  every purchase of that drawback value ever. `activeEvents()`'s `boughtOff` map was keyed by value, so
  any buyoff for a drawback suppressed every buy of that value forever — a bought-off drawback could
  never be taken again, silently dropped from the build with no AP and no warning, and the buy panel
  made retaking it structurally unreachable (a permanently disabled tile whose `onclick` never calls
  `takeDrawback()`). Resolved by matching each buyoff to the oldest not-yet-cancelled purchase in one
  forward pass (FIFO by array position) — no `seq` field, no schema change, unlike the task's own
  suggested fix; existing single-buy/single-buyoff characters are unaffected. `DATA.version` v0.340 →
  v0.341. **This session's environment had no browser** (no Chromium, `snap install` needs an interactive
  terminal), so the two Live Sheet UI gate assertions were pushed unexecuted, flagged as such — and CI's
  first real run caught a genuine bug **in the test**, not the fix: `buyoffDrawback()`'s own
  affordability gate silently refused every buy-off because the test never funded an `award` event.
  Fixed and re-verified against the real CI browser.
  Full record: `decisions/2026/D-GH-2026-08-06-buyoff-keyed-by-event.md`.

- **D-GH-2026-08-06-reprice-preserves-uncharged-costs** — **`compute()` now prices `maneuverBuys`**, and the
  Live Sheet's pricing escape is **deleted rather than kept**. `repriceDraft()` re-derives each frozen cost
  as a `compute()` delta, and `compute()` never read `maneuverBuys`, so three maneuvers bought for 4+5+6
  were rewritten to 0/0/0 while the maneuvers were kept — 15 AP handed back on a CharGen round-trip, and
  every pre-lock character is a draft. Pricing it in the engine fixes that *and* makes `priceOf()`'s
  ordinary build diff return the right rung by itself (verified: deltas 4, 5, 6, 7), so the fourth escape
  D-GH-2026-08-05-pricing-model **D1** warned against is gone rather than relocated — which is what D1
  meant by "retired into that rule". `DATA.version` v0.339 → **v0.340**; cheap only because the app is
  pre-launch (D-GH37). Supersedes the pricing half of D-GH-2026-08-06-maneuver-afford-gate.
  Full record: `decisions/2026/D-GH-2026-08-06-reprice-preserves-uncharged-costs.md`.

- **D-GH-2026-08-06-maneuver-afford-gate** — a purchase `compute()` never charges for gets its **own**
  pricing escape, kept separate from `_CTX_PRICERS`, and its price moves into `DATA`. Routing
  `buyManeuver()` through `buy()` was not enough on its own: `compute()` doesn't read `maneuverBuys`, so
  the build diff is 0 and the affordability gate would have been a silent no-op. Adding a fourth
  `_CTX_PRICERS` entry was rejected — it contradicts D-GH-2026-08-05-pricing-model **D1** ("retired into
  that rule rather than joined by a fourth") and miscategorises the reason: those entries exist because
  the diff over-charges via context contamination, this one because nothing is charged at all. The
  distinction is load-bearing, since D1 plans to retire `_CTX_PRICERS` and the task board already tells
  the next agent to port it into CharGen — folding `mvbuy` in would silently restore free maneuvers.
  `DATA.maneuverBuy = {base:4, step:1}` is new; `DATA.version` deliberately **not** bumped (value
  unchanged, `compute()` never reads it, parity 27/0) — recorded as a judgement call, not an obvious one.
  Full record: `decisions/2026/D-GH-2026-08-06-maneuver-afford-gate.md`.

- **D-GH-2026-08-05-creation-vs-awarded-ap** — starting AP splits into **creation AP** (the track's level-1
  figure, which is what the creation lock measures) and **awarded AP** (everything above it, priced as
  post-creation). CharGen now derives both from a building-level + budget-track pair, replacing a
  751-option AP dropdown. A level-5 Standard character starts with 175 AP: 79 creation, 96 awarded — a
  character who begins at level 5 has already advanced and should not get creation prices for all of it.
  This also removes the reason `_buildEventBurst` tags every event `noLock:true`, which is what will
  finally fix the reload-unlock bug; that half is **not built yet** and needs an owner call on burst
  ordering.
  Full record: `decisions/2026/D-GH-2026-08-05-creation-vs-awarded-ap.md`.

- **D-GH-2026-08-05-grit-ladder-correction** — Grit is priced by **which purchase it is** (2/4/6/9/12/15/18,
  then steps of 2/4/6/8/10), not by the character's tier, and is level-independent: three Grit cost 12 whether
  you buy them at level 1 or level 9 (it was 6 / 27 / 36 at levels 1 / 5 / 9). Past-CON-mod surcharge is a flat
  +1 per purchase. **Vigor deliberately stays tier-locked** — buying early really is cheaper there. A rules
  *correction*: guide and code agreed with each other and were both wrong, so the guide needs rewording.
  Previously **untested entirely** — every fixture had `tough: 0`; CG-010/CG-011 now pin it. `DATA.version`
  v0.339, parity 26/0.
  Full record: `decisions/2026/D-GH-2026-08-05-grit-ladder-correction.md`.

- **D-GH-2026-08-05-pricing-model** — prices freeze at purchase; the **creation lock**, not the tool, decides
  how a purchase is quoted. **Supersedes H2 below** — making recorded cost equal `compute()`'s delta is the
  defect restated as a goal, since that delta is exactly what `priceOf()` already returns. The real defect is
  that `priceOf()` quotes a *whole-build delta*, so any purchase that changes pricing context bills the player
  for re-pricing everything they already own — already patched by hand three times (`abil`, `mbound`, `dbound`)
  and still live for Level Up, class unlock and species. Before the lock a character is a draft (whole-build
  re-pricing is *correct*); after it, prices freeze and context changes take listed prices. Lock trigger =
  first spend past a threshold, stored as a `creationLockConfig` **event** (so it persists offline and online
  with no schema change) defaulting to `DATA.level1AP` = 79; engine-side already built and fixture-covered,
  emit-side missing entirely. Undo reverses the lock by design; frozen prices do not reverse with it.
  Full record: `decisions/2026/D-GH-2026-08-05-pricing-model.md`.

- **D-GH-2026-08-04-species-pack-ledger-drift** — the frozen ledger drifts permanently from `compute()`:
  for Anders Tealeaf, 15 vs 33 like-for-like. `compute()` derives pack cost from `b.species` **by design**,
  so "the packs are never charged" is the symptom, not the mechanism — the four species traits were
  committed to the LOG *before* the identity event, so `priceOf()`'s `compute(before)` saw traits with no
  species, priced them as cross-race, and the identity delta **refunded a phantom 21 AP the log never
  charged**. The durable finding: `priceOf()` computes deltas against `compute(build)` while recorded costs
  are never held equal to it, so any divergence *compounds* rather than corrects. Decision **H2** (owner):
  fix it by making recorded cost equal `compute()`'s delta by construction, not by the narrower
  event-ordering fix. Also records **two confidently wrong diagnoses** made on the way and the rule that
  prevents them — `compute()` on a truncated event log is not evidence, because intermediate folds are
  states that never existed. Not built; scoped as `fix/species-pack-not-charged`.
  Full record: `decisions/2026/D-GH-2026-08-04-species-pack-ledger-drift.md`.

- **D-GH-2026-08-04-dm-console-dm-ap-budget** — DM Console priced every roster AP figure against player
  AP only: `dmAnalyze()` called `compute(b)` with no opts and reported `economy()`'s totals, but DM AP
  lives only on `characters.ap` and never in the log, so `economy()` structurally cannot see it. On a
  campaign running `ignore_player_ap` the whole budget was invisible and every character read as
  overspent. Records why the shallow "add `dm.ap` to the AP-left cell" fix is wrong three ways (leaves
  the OVER BUDGET warning, the AP Ledger and the table column disagreeing, and over-counts when the
  campaign counts both pools), why `available` uses the **frozen ledger** (`spendable − economy().spent`,
  matching the Live Sheet's `_apRemaining()`) rather than `compute().remaining` — they disagree by 12 for
  a real character — and why `apLevel` was deliberately left wrong, because it is wrong identically in
  the Live Sheet and fixing it here alone would create a new divergence. Also records that the first
  mechanism I reached for was wrong: the reported "27" is not the AP-left cell at all.
  Full record: `decisions/2026/D-GH-2026-08-04-dm-console-dm-ap-budget.md`.

- **D-GH-2026-08-04-archived-campaign-peek** — an archived campaign is now openable read-only by clicking
  its name, reusing `selectCampaign()`'s render path rather than a second renderer that would drift. The
  read-only state is enforced **twice on purpose**: `_peekBlocks()` gates all eight write call sites, and
  `_applyPeekLock()` disables the controls. Disabling is the half that can be defeated — the roster
  replaces its own `innerHTML` on every refresh, so cards routinely come back enabled — which is why the
  write paths are guarded and not merely hidden. Records the deliberate deviation (disclosure toggles stay
  usable, or the content would be unreadable), why `+ Create`/`Unarchive`/ⓘ stay live, and why exiting
  *restores* prior disabled state instead of blanket-enabling. 21 new checks, 10 mutants killed — and the
  fact that three of them were vacuous until `window.confirm` was stubbed, because **Playwright
  auto-dismisses dialogs and silently routes every confirm-gated write down its cancel branch**.
  Full record: `decisions/2026/D-GH-2026-08-04-archived-campaign-peek.md`.

- **D-GH-2026-08-03-sw-cache-e2e** — added a returning-visitor gate: it installs the real service worker,
  changes a module so a network-first one imports a symbol only the fresh copy exports, and reloads
  without a hard refresh. Demonstrated red on the exact 2026-08-03 bug and green once fixed. Building it
  uncovered that **CharGen's own service-worker registration has been dead since PR #210** — line 3905 was
  the truncated fragment `<li><sp`, and an unterminated tag swallowed the registration script so it never
  reached the DOM; masked only because index.html registers the worker for the whole `/PACT/` scope, so a
  deep link to CharGen got no service worker at all. Also records why the test first reported vacuous
  passes (`controller !== undefined` is true before activation). Full record:
  `decisions/2026/D-GH-2026-08-03-sw-cache-e2e.md`.

- **D-GH-2026-08-03-vendor-supabase-js** — the Supabase client was imported from esm.sh, making every
  cloud feature depend on a third-party CDN at page load; an ES module import failure aborts the whole
  script, so an outage or a block took the cloud half of every tool down. Now vendored as
  `js/vendor/supabase-js-2.110.2.js`. Chose the official UMD build (1 file, 206KB, zero imports) over
  esm.sh's ESM form (6 files, 268KB, including injected node polyfills), adapted with a two-line export
  footer and no transform — the UMD's top-level `var` is module-scoped inside an ES module, so exporting
  it is the entire change. The version in the filename is load-bearing: an update is a new URL, so the
  service worker can never serve it stale, which is what lets it stay cache-first. Verified with every
  third-party host blocked: all three tools now fire their cloud event, which previously never fired at
  all. Full record: `decisions/2026/D-GH-2026-08-03-vendor-supabase-js.md`.

- **D-GH-2026-08-04-campaign-starting-ap** — the two routes into a campaign behaved differently: an
  invite created a character with its AP grant, while joining by the shared code only set `campaign_id`,
  so those players landed on 0 AP silently (what happened to Cedric Brightblade). `bind_character_to_
  campaign` now grants the campaign's own `rules.startingTier.ap` — deliberately reusing the figure that
  already pre-fills the invite, so one number governs both routes and they cannot drift apart again.
  Grants only on a genuine first bind, guarded against an unbind/rebind double-pay, additive so existing
  AP is topped up not clobbered, credited to the campaign's DM rather than the joining player, and a
  malformed rules blob grants nothing rather than blocking the join. Full record:
  `decisions/2026/D-GH-2026-08-04-campaign-starting-ap.md`. **Corrected by
  D-GH-2026-08-04-join-grant-followups below — read both.**

- **D-GH-2026-08-04-handoff-identity-and-invite-decline** — triage of three usability-review findings,
  two real and one not. The CharGen⇄Live Sheet duplicate was real but NOT in the handoff (the id
  round-trips cleanly): the Live Sheet's cloud save omitted `campaignId`, which is the input to
  `saveCharacter`'s anti-fork guard, so a drifted id minted a new row instead of adopting the campaign's
  existing one. Declining an invite was a genuine one-way door — token cleared, banner hidden, no
  recovery. The third ("invites never show as redeemed") is NOT a data bug: the whole chain from
  `redeem_player_invite` to `renderInvites()` was verified intact against live data; the real problem was
  two panels going stale independently. Also records why Playwright's default `confirm()` dismissal
  produced both a CRITICAL and a HIGH in that report, and why the fix belongs in the caller rather than
  in `saveCharacter`. Full record:
  `decisions/2026/D-GH-2026-08-04-handoff-identity-and-invite-decline.md`.

- **D-GH-2026-08-04-starting-tier-level-band** — starting tier was one ratio doing two jobs; off a
  Standard L1 of 79 the presets were literally levels (55 = L0, 79 = L1, 103 = L2), so a DM picking
  "Veteran" was picking "level 2" without being told. Split into level 0–20 (priced off the campaign's
  own curve, same formula as `js/ap-by-level.js`) plus a narrow ±15% band named for campaign tone.
  Records why bands are narrow, why old presets map across *exactly* rather than approximately, and why
  `ap` stays the authoritative field. Also **reverses the `absent → 79` default** from
  D-GH-2026-08-04-join-grant-followups: that 79 is a hardcoded input placeholder inside a collapsed
  `<details>`, not a setting a DM chose, so "the UI already shows this number" was never an argument.
  Absent now grants 0, made safe to ship by stating the grant on the code row itself. Full record:
  `decisions/2026/D-GH-2026-08-04-starting-tier-level-band.md`.

- **D-GH-2026-08-04-review-stack-seed** — a usability review had no way to reach the signed-in half of
  the app (`cloud-e2e` tears its stack down immediately), so added a seeded stack that stays up. Default
  is a local throwaway stack; `--live` targets a hosted project when Docker isn't available. Records why
  live mode gives up its destructive paths rather than discouraging them (`schema.sql` never applied,
  `--reset` refused outright), why it takes three independent gates instead of one flag, and why purge
  works off tags plus the FK cascade graph — including the one cascade that isn't safe alone
  (`characters.campaign_id` is ON DELETE SET NULL, so a real character inside a review campaign would be
  silently unbound, not error). Also records that the seed path has NOT been run end to end, and why.
  Full record: `decisions/2026/D-GH-2026-08-04-review-stack-seed.md`.

- **D-GH-2026-08-04-join-grant-followups** — five defects an adversarial review found in the entry above,
  all one shape: a value the SERVER owns, read or written as if the client owned it. `absent` was read as
  `zero`, so 3 of 4 live campaigns granted nothing while the UI showed 79 (`rules` defaults to `'{}'` and
  `createCampaign` never writes a tier) — absent now means 79. `'^[0-9]+$'` is not a range check: it
  accepts `'2147483648'`, whose `::integer` cast overflows and aborts the join, the exact failure that
  defensive read existed to prevent — now bounded to 7 digits. The `ap_awards` double-pay guard was never
  executed by its own test (the rebind case hit the same-campaign early return), so deleting it would have
  left every check green. DM Console's `parseInt(x,10) || 79` rewrote a DM's deliberate 0. And two paths
  resolved DM AP through `peekCharacter()`, which prefers the LOCAL copy — right for stats, wrong for `ap`,
  which only ever changes server-side; both now use a new `refreshServerAp()`, a sibling rather than a
  change to peek because peek's local-first preference is correct for its own callers. Full record:
  `decisions/2026/D-GH-2026-08-04-join-grant-followups.md`.

- **D-GH-2026-08-03-invite-note-dm-only** — RLS is row-level, so the redeemer clause on
  `campaign_invites_select` let a player read the DM's `note` on their own invite. Withheld at the COLUMN
  level; the DM still reads it through the SECURITY DEFINER `list_campaign_invites()`. Turned on a
  Postgres subtlety worth remembering: a column-level REVOKE cannot subtract from a table-level GRANT —
  it reports success and does nothing — so the blanket grant must be dropped and the wanted columns
  granted explicitly. Consequence: `select *` on this table now fails loudly for `authenticated`, which
  is preferred to silently re-leaking the column. Full record:
  `decisions/2026/D-GH-2026-08-03-invite-note-dm-only.md`.

- **D-GH-2026-08-03-invite-grant-award-row** — `redeem_player_invite` set `characters.ap` directly and
  wrote no `ap_awards` row, so once the invite grant became a character's entire starting AP that number
  had no provenance (`ap_awards`: 0 rows campaign-wide). Not just an audit gap — Live Sheet's
  clone-to-standalone converts DM AP into log entries by reading that table, so cloning silently dropped
  the whole grant. Redemption now records the award, attributed to the invite's creator rather than the
  redeeming player. Separately: local file / handoff loads zeroed DM AP, which was harmless when it was a
  bonus and became total budget loss once it was the whole budget (verified: an exported campaign
  character opened at `remaining -14`). Fixed by carrying the campaign **binding** in the envelope and
  handoff — never the AP number, which `js/engine.js`'s ANTI-DOUBLE-COUNT INVARIANT forbids in an export
  — and resolving the authoritative `ap` from the server when signed in, `'unavailable'` when not. `#b=`
  share links deliberately unchanged. Full record:
  `decisions/2026/D-GH-2026-08-03-invite-grant-award-row.md`.

- **D-GH-2026-08-03-uuid-character-ids** — `genCharId()` minted `'c'+base36` ids (e.g.
  `cmscl7ilrr5muh`) while `characters.id` is a Postgres `uuid`, so a locally-born character could
  NEVER be saved to the cloud — and because `saveCharacter()` writes localStorage before pushing, each
  rejected attempt left an orphaned local copy, surfacing as the same character twice in My Characters.
  Only cloud-born characters (invite redemption) ever synced, which is why it went unnoticed. Ids are
  now UUIDs; `isCloudCharId()` shares the format predicate; legacy ids migrate lazily on first push and
  every save call site adopts the returned id. My Characters now tags rows ☁ Cloud / 📥 Device only.
  Full record: `decisions/2026/D-GH-2026-08-03-uuid-character-ids.md`.

- **D-GH-2026-08-03-invite-single-ap-grant** — A player invite carried two AP numbers; the second
  ("Creation budget") was seeded into the character's LOG as PLAYER AP, which any campaign with
  `ignore_player_ap` then discarded outright. Observed live: Amble issued 36 + 55, the player could
  spend 36, and the UI announced the 55. Collapsed to ONE grant paid into `characters.ap` — works
  regardless of the toggle, and the player can't edit their own grant. Both RPCs keep their signatures
  and fold `starting_ap + starting_budget` server-side so a Pages deploy and a DB migration need not be
  atomic and pre-migration invites still pay out fully; `starting_budget` is deprecated-but-kept, not
  dropped. Full record: `decisions/2026/D-GH-2026-08-03-invite-single-ap-grant.md`.

- **D-GH-2026-08-03-ap-budget-curve-standard** — The fixed AP ladder in `js/ap-by-level.js` was never
  a rules curve: `{1:50 … 20:491}` was the Players Guide appendix's twenty pregenerated Emberwatch
  characters, a cast list transcribed into a table and later mislabelled a "pace curve". The Guide has
  a *budget* curve (Standard L1 79/+24, Generous 83/+28, prelude L0 55) and an *award pace* (AP per
  session, ~7) — and no AP-earned-per-level schedule at all. The ladder is now **derived** from
  `LEVEL_BUDGET_CURVES.standard` via a new `budgetLadder({l1,inc})`, spanning levels 0–20, so the
  engine default and the DM-facing preset are the same two numbers by construction. `DATA.level1AP` /
  `DATA.defaultAp` 50 → 79; `DATA.version` v0.337 → v0.338; `LEVEL_BUDGET_CURVES.standard` becomes the
  one mechanics entry in an otherwise display-only file. Parity 24/0 with `testing/expected/`
  untouched — four threshold fixtures had their filler spend and matching award raised by the same
  delta, so no expected value moved. Full record:
  `decisions/2026/D-GH-2026-08-03-ap-budget-curve-standard.md`.

- **D-GH-2026-08-02-creation-lock-switch** — Engine half of the creation-lock feature. Adds
  `creationLockConfig{auto,threshold}` and `creationUnlocked` events (both last-write-wins; unlock is
  future-only and suppresses the auto-lock so it isn't a same-pass no-op), and documents the
  lock-precedence rule above `_replay()`. Deliberately deviates from the cold-reviewed plan's
  "defaults off": three existing fixtures assert `campaignBound` alone arms the lock at
  `DATA.level1AP`, so defaults-off would have broken them — `auto` instead falls back to campaign
  membership when unconfigured, keeping full backward compatibility. Also records a production
  finding: the Amble campaign grants a 70 AP creation budget while the default threshold is 50, so a
  player would auto-lock mid-creation — the threshold should default to the campaign's creation
  budget, which needs deciding before this is enabled. Full record:
  `decisions/2026/D-GH-2026-08-02-creation-lock-switch.md`.
- **D-GH-2026-08-02-syncall-owner-scope** — Follow-up to the `syncAll()` finding flagged in
  `D-GH-2026-08-02-dm-readonly-livesheet-view`: the background auto-sync job (runs on every signed-in
  page load, no user action needed) queried `characters` with no owner filter, so for a DM it relied
  entirely on RLS's `is_campaign_dm()` clause and ended up caching every one of their players'
  characters locally as routine behavior. Previously harmless only because `listMyCharacters()`'s
  `dirty` check happened to filter these out downstream — not because the fetch itself was scoped
  correctly. Added `.eq('owner_id', user.id)`, the same pattern `listMyCharacters()` already uses, so
  the job is correct by construction rather than relying on an unrelated downstream check. Full record:
  `decisions/2026/D-GH-2026-08-02-syncall-owner-scope.md`.
- **D-GH-2026-08-02-dm-readonly-livesheet-view** — DM Console gets a "👁 View in Live Sheet ↗" button
  per cloud roster card, opening a genuine read-only view in a new tab. Rejected reusing the existing
  `?cloudChar=` deep link — it makes the loaded character active/editable and calls `save()`
  immediately, risking cross-tab corruption of the shared local-autosave slot and, if "☁ Save to cloud"
  were clicked, a new trigger for the `listMyCharacters()` local-cache leak. Instead: a new `?viewChar=`
  link uses `peekCharacter()` (never touches localStorage) and a `VIEW_ONLY` flag that guards `emit()`/
  `save()`/`undo()`/`redo()` — the two/four choke points every mutation already routes through — so
  future Live Sheet features inherit the same protection without needing this code revisited. Separately
  flagged (not fixed here): `syncAll()` caches every RLS-visible character with no owner filter at all,
  currently safe only because of the `dirty` check the sibling leak fix added. Full record:
  `decisions/2026/D-GH-2026-08-02-dm-readonly-livesheet-view.md`.
- **D-GH-2026-08-02-invite-already-joined-message** — A DM sent a player two invites to the same
  campaign; the second showed "Could not join campaign: You have already joined this campaign" —
  reads as a failure. Traced to the correct, deliberate one-character-per-player-per-campaign rule
  (DB-enforced) doing exactly what it should; no data lost. Invites are anonymous single-use tokens
  (no player identity at generation time), so this can't be caught before redemption. Fixed the
  message only: `tryRedeem()` now shows "You're already in this campaign — this invite wasn't needed"
  instead of an error-styled string. Full record:
  `decisions/2026/D-GH-2026-08-02-invite-already-joined-message.md`.
- **D-GH-2026-08-02-listmycharacters-local-cache-leak** — Follow-up to the `listCharacters()` server-
  side leak fix: a DM still saw 4 other accounts' characters on "My Characters" after that fix shipped.
  Root cause was client-side, not server-side: `listMyCharacters()`'s local-storage merge (for
  not-yet-synced drafts) trusted *any* cached-by-id local record as "mine," with no ownership check —
  and `loadCharacter()`/`reconcile()` caches any character it can fetch (by design, for DM/campaign-
  role reads) with no ownership check either. Once the DM had loaded one of the originally-leaked rows
  (e.g. clicking it to investigate), it stuck in their local cache forever, surviving the server fix.
  Fixed by requiring `dirty === true` (set only by this device's own unsynced saves, cleared on
  successful push) for a local-only entry to count as "mine." Full record:
  `decisions/2026/D-GH-2026-08-02-listmycharacters-local-cache-leak.md`.
- **D-GH-2026-08-02-build-version-pr-linked** — `BUILD` (`js/engine.js`) was an independently-
  incremented `v0.10x` counter, bumped on an ad hoc schedule with no fixed rule for when/who bumps it.
  Changed to `v<major>.<PR#>` (e.g. `v1.293`) — `PR#` is the GitHub PR that promotes `preview` →
  `main`, set once as part of that promotion PR (never inside a regular feature PR) and tagged onto
  the resulting `main` commit with the same value; `major` is a plain manual number (starts at `1`),
  carried forward unchanged unless a human explicitly bumps it for a relaunch/milestone. Removes a
  manual "what's the next number" guess for the PR half (the same shared-mutable-counter hazard
  already documented for the old `D-GH<N>` decision numbering) while keeping a human-legible
  generation marker. `DATA.version` (rules axis) unaffected. Full record:
  `decisions/2026/D-GH-2026-08-02-build-version-pr-linked.md` (see same-day addendum for the
  two-part-format refinement).
- **D-GH-2026-08-01-dm-console-listcharacters-leak** — CharGen's/Live Sheet's ☁ Cloud → "Load saved
  character" menu called `js/sync.js`'s `listCharacters()`, which had no `owner_id` filter and relied
  entirely on RLS — whose `characters_select` policy deliberately also grants a DM read access to
  every character in campaigns they run (needed for DM Console's roster). A DM opening their own
  personal cloud menu therefore saw every player's blank invite-seeded characters, confirmed live
  against the production DB (four rows, four different Google accounts). Deleted `listCharacters()`
  entirely (zero other callers) and pointed both cloud-menu call sites at the already-existing,
  explicitly owner-scoped `listMyCharacters()`. Full record:
  `decisions/2026/D-GH-2026-08-01-dm-console-listcharacters-leak.md`.
- **D-GH-2026-08-01-dm-console-cloud-roster** — Cloud (campaign) characters showed in a bare
  Player/Character/DM-AP table instead of the rich cards local imports get, had no "remove from
  campaign" path at all (`characters.campaign_id` had a setter but no unsetter), and had nowhere for a
  DM to leave a player-name label or private notes. Asked the user directly on two real decisions:
  remove = unbind (character/data survive) not delete, and new fields = DM-only/private not
  player-visible. Shipped: `#campRoster` now renders through the same `cardHTML()`/`analyzeAug()`
  pipeline as local imports; a new `dm_unbind_character()` RPC (mirrors `award_ap()`'s
  `SECURITY DEFINER` shape); a new `character_dm_notes` table (not new `characters` columns — RLS
  can't hide a column within an otherwise-visible row) with access via a live join to the character's
  *current* campaign, not a cached one. Migration applied to the live project + advisor-clean. Full
  record: `decisions/2026/D-GH-2026-08-01-dm-console-cloud-roster.md`.
- **D-GH-2026-08-01-dm-console-ui-improvements-2** — A Tradition left with every discipline slot at
  "(none)" was silently skipped by `compute()` — no Foundation cost, no line items, no warning. Added an
  engine-level warning (`js/engine.js`, shared by all three tools' Issues/warnings trays) plus a
  CharGen-only inline "⚠ No discipline chosen" marker (the one tool where this state is reachable through
  normal editing). Bumped `DATA.version` v0.336 → v0.337 since this changes `compute()`'s possible
  `warnings` output; none of the 20 parity fixtures exercise the state, so `testing/expected/` needed no
  changes. Full record: `decisions/2026/D-GH-2026-08-01-dm-console-ui-improvements-2.md`.
- **D-GH-2026-08-01-dm-console-ui-improvements** — CharGen's `.disc-cant` cantrip picker had no guard for
  `DATA.noCantrip` half-caster disciplines (Paladin/Ranger): `js/engine.js` already silently zeroes their
  cantrips on every fold (correct rules enforcement, and Live Sheet already hides the buy control for
  them), but CharGen showed a priced, clickable dropdown whose selection was discarded with zero feedback
  — no ledger line, no AP deducted, no warning. Fixed by disabling the control and forcing its displayed
  value to 0 whenever the current discipline can't take cantrips, re-evaluated every render (also
  self-corrects switching an existing discipline into a half-caster mid-edit). No engine change. Full
  record: `decisions/2026/D-GH-2026-08-01-dm-console-ui-improvements.md`.
- **D-GH-2026-07-29-file-review-4plpe3** — Acted on an external (Copilot) perf review of `js/engine.js`
  by *measuring* every claim instead of trusting its stated priority order. Took the Set-based dedupe in
  `_replay()` (O(n²)→O(n); `foldBuild()` on a 2000-event log ~14.6× faster and now linear), Set-based
  membership tests, and the duplicate-`activeEvents()` consolidation — the last via a **private**
  `_economyFrom()` rather than a new public `economy()` parameter, keeping the bridged API unchanged.
  **Rejected the review's own #1 item** (`structuredClone`) on measurement: JSON round-trip is 1.9–3.1×
  faster for every shape this engine clones, and the swap cost ~20% on `rebuildStateFromEvents()`; also
  rejected cached `DATA.*` locals (unmeasurable) and async Web Crypto signing (breaks a documented
  `file://`/sync constraint). Verified behaviour-identical by a 20,021-check differential test against
  the pre-change engine. Full record:
  [`decisions/2026/D-GH-2026-07-29-file-review-4plpe3.md`](decisions/2026/D-GH-2026-07-29-file-review-4plpe3.md)

- **D-GH-2026-07-29-custom-skills-commands** — Strengthened `/make-code-cold-plan-review` with
  cross-vendor reviewer guidance, an adversarial reframe of the reviewer instructions plus
  per-finding severity/confidence tags, a structured agree/disagree matrix in the "Review outcome"
  stub, and a fresh context-free `Agent` call to adjudicate `blocking`/disputed findings instead
  of the drafting session self-triaging. Full record:
  `decisions/2026/D-GH-2026-07-29-custom-skills-commands.md`.
- **D-GH-2026-07-28-decisions-changelog-task-board-split** — Migrated DECISIONS.md (112 full
  records + 1 orphaned index-only entry) to this thin index over decisions/2026/D-*.md, split
  docs/TASK_BOARD.md into _NOW/_NEXT/_LATER, and archived CHANGELOG.md entries older than
  2026-07-17 to docs/history/CHANGELOG-2026-06-29-to-2026-07-16.md.
  Full record: `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`.
- **D-GH-2026-07-28-technical-access-not-scope** — Added a "Technical Access ≠ Scope" section
  to `AGENTS.md`, after direct testing on Home AI Server confirmed a session with broad,
  non-enforced access would cross into a different project's files if asked.
  Full record: `decisions/2026/D-GH-2026-07-28-technical-access-not-scope.md`.
- **D-GH-2026-07-28-command-format-agnostic** — Hardened all 7 `.claude/commands/*.md` files to
  check for a split-file task-board/decisions shape before assuming today's single-file layout,
  so PACT's eventual own migration (and anything ported from PACT, like PetDetective) won't
  need the command files touched when it happens. No content migration in this change.
  Full record: `decisions/2026/D-GH-2026-07-28-command-format-agnostic.md`.
- **D-GH-2026-07-25-add-task-drop-approval-gate** — `/add-code-task` no longer pauses for a
  "yes/looks good" before committing a drafted task to `docs/TASK_BOARD.md` — shows the block,
  then commits in the same turn, at explicit user request. If the user dislikes what landed,
  the fix is a follow-up edit/revert commit, not a pre-commit pause. Scoped to this one skill's
  task-drafting gate only. Full record: `decisions/2026/D-GH-2026-07-25-add-task-drop-approval-gate.md`.
- **D-GH-2026-07-25-character-archive** — Added `characters.archived_at` for the new "My
  Characters" page. Unlike `campaigns.archived_at` (D-GH-2026-07-25-campaign-archive), no RPC
  is needed: `characters_update`'s RLS policy is already owner-only, so a plain column-level
  UPDATE grant is correctly scoped as-is. Full record: `decisions/2026/D-GH-2026-07-25-character-archive.md`.
- **D-GH-2026-07-25-cloud-load-empty-characters** — "No character data found" on every
  cloud-load attempt traced to 4 pre-launch stub rows in the live `characters` table (deleted).
  Hardened both tools' cloud-load menus to show a `hasData:false` character as a visible, inert
  "empty" row instead of a clickable button that fails after the fact — shown, not hidden, so a
  player isn't left wondering where a character they know exists went.
  Full record: `decisions/2026/D-GH-2026-07-25-cloud-load-empty-characters.md`.
- **D-GH-2026-07-25-dm-console-themes** — Added a theme selector to DM Console (previously the
  only one of the three tools with no theme UI at all) and 3 new themes
  (`dnd`/`royal`/`forest`) matching Live Sheet/CharGen's set, mapped onto DM Console's own
  distinct CSS variable names rather than copying those tools' variables verbatim, since it's a
  structurally different, newer token system.
  Full record: `decisions/2026/D-GH-2026-07-25-dm-console-themes.md`.
- **D-GH-2026-07-25-campaign-archive** — Wired up campaign create (a plain `createCampaign()`
  insert that already existed but had no UI calling it) and campaign delete-as-archive (new,
  reversible — hard delete was deliberately left unwired) in DM Console. Added a genuinely
  owner-only `archived_at` column, reachable only via new
  `archive_campaign()`/`unarchive_campaign()` RPCs, enforced by a column-level UPDATE grant
  lockdown (the same class of fix `characters.ap` already had) rather than relying on the RPC
  alone — the pre-existing blanket `campaigns` UPDATE grant would otherwise have let any co-DM
  bypass the owner check via a direct REST call. Also fixed `.btn.ghost` (Copy/Unarchive
  buttons), found unreadable in light theme while screenshot-testing the new UI — same root
  cause as the two dark-theme fixes below (styled for the navy header, actually rendered on the
  light main-content panels). Full record: `decisions/2026/D-GH-2026-07-25-campaign-archive.md`.
- **D-GH-2026-07-20-close-code-session-run-commit** — `/close-code-session` can now stage,
  commit, and push once the human names that letter, instead of only ever printing the command
  for manual hand-off. Removes the human-reviews-the-diff-before-commit gate
  `D-GH-2026-07-16-close-session-auto-log` established, at explicit user request; keeps that
  entry's other mitigation (never `git add -A`/`.`).
  Full record: `decisions/2026/D-GH-2026-07-20-close-code-session-run-commit.md`.
- **D-GH-2026-07-19-pwa-vs-capacitor-migration** — Evaluated migrating PACT off its vanilla-JS
  PWA architecture to React+TypeScript+Vite+Capacitor Android (and separately, Bubblewrap/TWA),
  prompted by a migration-assessment template originally written for a different, children's
  Family-Link-constrained app; ran it against PACT's real files as a worked example. Decision:
  stay on the current architecture — see full entry for why.
  Full record: `decisions/2026/D-GH-2026-07-19-pwa-vs-capacitor-migration.md`.
- **D-GH-2026-07-19-pwa-manifest-icon-coverage** — Closed the two items
  `D-GH-2026-07-19-pwa-cache-bump` explicitly left flagged-not-fixed: `login.html` and
  `docs/PACT-Players-Guide.html` gained `<link rel="manifest">`; every non-`index.html` entry
  point (those two plus all three tools, including DM Console) gained `<link
  rel="apple-touch-icon">`. DM Console's inclusion is a deliberate departure from the earlier
  favicon change (`2026-07-18`, "DM Console deliberately left unchanged") — that exclusion was
  never reasoned in the CHANGELOG beyond the bare statement, and it concerned the
  browser-**tab** icon (`<link rel="icon">`), a distinct concern from the **home-screen** icon
  governed by `apple-touch-icon`; DM Console is one of the three tools in this installable PWA
  suite, and nothing supports excluding it from "Add to Home Screen" getting a proper icon. All
  new links use the absolute `/PACT/...` path (matching `manifest.json`'s own convention), even
  though the tools' existing favicon links use a relative path — a pre-existing inconsistency,
  deliberately left alone rather than fixed as a drive-by. HTML well-formedness verified on all
  5 files; `js/engine.js` untouched, parity 20/0.
  Full record: `decisions/2026/D-GH-2026-07-19-pwa-manifest-icon-coverage.md`.
- **D-GH-2026-07-19-pwa-cache-bump** — Bumped `service-worker.js`'s `CACHE_NAME`
  `pact-v6`→`pact-v7` because `js/character-store.js` (cache-first) had just gained
  `recordAutosave`/`readRecent` for the Continue feature, and without a bump,
  already-installed/returning users would silently keep the old file indefinitely — the same
  class of gap `D-GH-2026-07-16-sw-network-first-security-modules` fixed for the
  auth/sync/campaign/dm modules. Also widened `NETWORK_FIRST_RE` to cover `js/ui-helpers.js`
  (the shared `esc()` XSS-escaping helper), `js/ap-by-level.js`, and `js/advancement.js` —
  three files added since that prior decision and never brought under its policy — applying the
  exact same "costs nothing offline, only speeds up fix propagation" reasoning rather than
  re-litigating it; added all three to `PRE_CACHE` too, for consistency with every other
  network-first entry. Separately, wired a `<link rel="apple-touch-icon">` into `index.html` —
  the correctly-sized asset and its `manifest.json` entry already existed, but no page actually
  referenced it via the tag iOS Safari's "Add to Home Screen" relies on most reliably; found
  while auditing PWA completeness, not something this session broke. `js/engine.js` untouched,
  parity 20/0 Full record: `decisions/2026/D-GH-2026-07-19-pwa-cache-bump.md`.
- **D-GH-2026-07-18-continue-recent-chars** — Added the landing page's "Continue where you left
  off" section, backed by a new shared versioned-autosave store (`recordAutosave`/`readRecent`
  in `js/character-store.js`, key `pactRecentV1`). Expanded scope past the roadmap's
  "index.html-only, reads existing storage" framing because the only universally-populated
  local source is each tool's *single* overwrite autosave slot (≈1 character/tool); the real
  multi-character store (`js/sync.js`) only fills on a signed-in "☁ Save to cloud". So both
  tools now *additionally* feed a shared store keeping **two lists** — the last 3 *distinct*
  characters (resume cards) and a rolling ring of the last 10 autosave *snapshots* (a recovery
  timeline) — chosen over the user's first "5 versions per character name" idea. The ring's
  capture policy uses **both time and difference** (skip-if-identical; coalesce rapid
  same-character edits inside a 2-min window into the newest slot; cut a new slot only on
  ≥2-min gap, a character/tool switch, or a ≥5-event jump) so a keystroke burst can't fill it
  with near-duplicates. Navigation reuses the existing one-shot `?handoff=` baton (staged at
  pointer/keyboard interaction time so it's fresh and middle-click-safe), so **no tool code
  changed** beyond the one additive autosave call each; the writer is fully guarded so it can
  never break a real autosave, and all names render via `textContent` (XSS-safe). BUILD bumped
  v0.201→v0.202; engine untouched (parity 20/0)
  Full record: `decisions/2026/D-GH-2026-07-18-continue-recent-chars.md`.
- **D-GH-2026-07-17-engine-data-extract** — REV-14a extracted the `DATA` rules dataset from
  `js/engine.js` into a new `js/engine-data.js` **`.js` module** (not `.json`), re-exported
  unchanged; chose `.js` over the task's originally-specified `.json` because a JSON module is
  frozen in some engines and the three tools' bridges mutate
  `DATA.racialFx`/`masteryFx`/`drawbackFx` onto it (a frozen import would throw `TypeError`),
  because `.js` avoids the iOS-Safari import-attributes question entirely, and because it
  matches the repo's existing `ap-by-level.js`/`advancement.js` precedent; also made
  `engine-data.js` network-first + precached in the service worker so a rules edit (which used
  to live in the network-first `engine.js`) still reaches returning users immediately rather
  than sticking on a stale cache-first copy — a decision informed by a 4-model cold-review
  round on `docs/plans/2026-07-17-engine-breakup-rev14.md`
  Full record: `decisions/2026/D-GH-2026-07-17-engine-data-extract.md`.
- **D-GH-2026-07-17-worktree-base-check-exact-equality** — `run-task.md`'s
  worktree-base-verification check switched from an ancestry check to an exact-equality check,
  because *any* ancestry-based check (the documented `--is-ancestor`, and an undocumented
  "sharper" `merge-base`-equals-target variant used ad hoc this session) gives a false positive
  for one worktree-turn right after every `preview`→`main` promotion — caught when a
  `docs/SKILLS.md` sync PR's rebase tried to replay 196 ancient commits back to PR #95,
  revealing the worktree was silently based on `origin/main`, not `origin/preview`, despite the
  ad hoc check passing Full record: `decisions/2026/D-GH-2026-07-17-worktree-base-check-exact-equality.md`.
- **D-GH-2026-07-17-shared-auth-change-helper** — Added `onSessionChange(cb)` to `js/auth.js`,
  a one-argument wrapper around `onAuthChange(event, session)` that structurally rules out the
  argument-order bug fixed 3 separate times at different call sites; migrated CharGen's 3 call
  sites and DM Console's 1 to it, but kept Live Sheet's single call site on the raw
  `onAuthChange` since it genuinely needs the event string for its `SIGNED_OUT` branch — the
  task's own step 1 explicitly permitted this, even though the "Done when" line's "all 5 call
  sites use it" reads more strictly; judged wrap-don't-replace correct because forcing Live
  Sheet through the session-only wrapper would mean either threading `event` back in as an
  optional 2nd argument (defeating the whole point of a can't-get-it-wrong single-argument
  signature) or subscribing twice, and the argument-order bug this task exists to prevent has
  only ever hit session-only call sites in practice, not the one site that legitimately needs
  the event Full record: `decisions/2026/D-GH-2026-07-17-shared-auth-change-helper.md`.
- **D-GH-2026-07-17-sweep-tasks-review-fixes** — Fixed 15 findings from a `/code-review ultra`
  pass on the merged `/sweep-tasks`/`/add-task` skill files: worktrees now stay
  (`ExitWorktree(action:"keep")`) on park paths instead of leaking, dropped/parked queue slots
  get backfilled from the eligible list to hold the requested batch size, `TaskList` entries
  always reach an explicit terminal state (never left stuck `in_progress`), `$ARGUMENTS`
  batch-size parsing requires a bare integer (not any digit substring in free text), Step 5's
  newly-discovered tasks now route through Step 3's pre-flight branch check and get the same
  fetch/rebase-before-push care as feature branches, the diff-size-bumped-to-high case now maps
  to the `ultra` review tier instead of being undefined, the diff-size check no longer
  penalizes the exact "mechanical batch across many call sites" pattern `/add-task`'s own
  Effort:medium examples endorse, Ambiguity's High tier now names cross-tool/architectural
  migrations explicitly (closing the gap left when Effort stopped gating eligibility), and both
  `docs/TASK_BOARD.md`'s stale "Step 4.5" reference and `AGENTS.md`'s undocumented
  single-writer carve-out were corrected
  Full record: `decisions/2026/D-GH-2026-07-17-sweep-tasks-review-fixes.md`.
- **D-GH-2026-07-16-sweep-tasks-risk-model-v2** — Reworked `/sweep-tasks`' safety gate: Risk is
  now three named factors (ambiguity, damage scale, damage likelihood) worst-of combined,
  `Risk: high` is an absolute veto but `Risk: medium` is now eligible (previously only `low`
  was), and Effort no longer gates eligibility at all — it's ordering/sizing information only,
  since a genuinely risky task was always going to score high via the Ambiguity factor anyway,
  making Effort a redundant, less-precise proxy for the same thing. Added a consecutive-failure
  circuit breaker, a diff-size sanity check, Risk-scaled (not just file-path-scaled) review
  tiers with mandatory live verification above `Risk: low`, and a `docs/sweep-log.md` recording
  every attempted run Full record: `decisions/2026/D-GH-2026-07-16-sweep-tasks-risk-model-v2.md`.
- **D-GH-2026-07-16-sweep-tasks-skill** — Added `/sweep-tasks`, the unattended-loop version of
  pick→run→review→merge over roadmap tasks tagged `Effort: low|medium` + `Risk: low`;
  classification is structured metadata set by `/add-task` (not re-derived per sweep run),
  batch size is asked once per invocation rather than fixed or uncapped, mid-run task
  discoveries execute immediately if they qualify rather than deferring, and merge-as-you-go is
  a fixed default with no per-run prompt — four explicit human calls made when the skill was
  designed, not defaults I picked unilaterally
  Full record: `decisions/2026/D-GH-2026-07-16-sweep-tasks-skill.md`.
- **D-GH-2026-07-16-lighthouse-ci** — Added `.github/workflows/lighthouse-ci.yml` (Lighthouse
  CI, `treosh/lighthouse-ci-action`) against `index.html`, serving it locally via
  `actions/checkout`'s default path (already ending in a dir named after the repo) rather than
  needing a symlink; thresholds in `lighthouserc.json` set from a real measured baseline
  (2026-07-16: perf 100, a11y 98-100, best-practices 96, seo 100) with an 0.85 floor for
  headroom against Lighthouse's normal run-to-run variance, not an arbitrary target;
  performance/accessibility error (block), best-practices/seo warn (advisory) — the harder
  "85→90" score-improvement work (engine splitting/lazy-loading) stays deferred, this is just
  the regression-catching mechanism Full record: `decisions/2026/D-GH-2026-07-16-lighthouse-ci.md`.
- **D-GH-2026-07-16-ios-install-hint** — Added a dismissible `.ios-hint` bar to `index.html`
  for iOS Safari (which never fires `beforeinstallprompt`, so the existing install button never
  appears there); gated on `'standalone' in navigator` (a genuine feature-detect, not
  UA-sniffing) and hidden when already installed; dismissal remembered in `localStorage` so it
  doesn't nag every visit; verified in a real spoofed-UA browser across all three states
  (not-installed, already-installed, non-iOS)
  Full record: `decisions/2026/D-GH-2026-07-16-ios-install-hint.md`.
- **D-GH-2026-07-16-audit-search-path-pg-temp-check** — Added a `testing/scripts/audit.py`
  check enforcing `pg_temp` in every SECURITY DEFINER function's search_path, making
  D-GH-2026-07-16-harden-search-path-pg-temp's retroactive fix durable against future
  regressions; also fixed `static-audit.yml`'s trigger `paths:` to include
  `sql/schema.sql`/`sql/rls-policies.sql`, which it never had — the whole audit workflow, not
  just this new check, would otherwise never run on a PR touching either SQL file
  Full record: `decisions/2026/D-GH-2026-07-16-audit-search-path-pg-temp-check.md`.
- **D-GH-2026-07-16-harden-search-path-pg-temp** — Hardened all 16 `SECURITY DEFINER` functions
  in `sql/schema.sql`/`sql/rls-policies.sql` from `search_path = public` to `search_path =
  public, pg_temp`, closing the classic temp-table-shadowing gap repo-wide via `ALTER FUNCTION`
  (not a body redeclaration, avoiding schema.sql-vs-migration drift); low real-world
  exploitability today (no raw-SQL/DDL path for PostgREST clients) but closing it consistently
  is cheap and was flagged as worth doing rather than leaving piecemeal
  Full record: `decisions/2026/D-GH-2026-07-16-harden-search-path-pg-temp.md`.
- **D-GH-2026-07-16-sw-network-first-security-modules** — Widened `service-worker.js`'s
  `NETWORK_FIRST_RE` to cover
  `js/auth.js`/`js/supabase-client.js`/`js/sync.js`/`js/campaign.js`/`js/dm.js` (previously
  cache-first, same as `js/engine.js` used to be pre-REV-03) — the fetch handler's
  network-first path already falls back to cache offline, so this costs zero offline capability
  and only speeds up client-fix propagation; `CACHE_NAME` bumped `pact-v4`→`pact-v5`
  Full record: `decisions/2026/D-GH-2026-07-16-sw-network-first-security-modules.md`.
- **D-GH-2026-07-16-campaign-invite-search-path** — Fixed the `gen_random_bytes` search-path
  bug filed by the advancement-tracks e2e task: schema-qualified the calls
  (`extensions.gen_random_bytes(...)`) rather than widening
  `gen_invite_code()`/`create_player_invite()`'s `search_path` to include `extensions`, so
  these `SECURITY DEFINER` functions don't implicitly resolve anything beyond `public`;
  verified live via a real `INSERT INTO campaigns` and a direct call to the exact
  `extensions.gen_random_bytes(16)` expression `create_player_invite()` uses
  Full record: `decisions/2026/D-GH-2026-07-16-campaign-invite-search-path.md`.
- **D-GH-2026-07-16-advancement-tracks-e2e** — Real-browser e2e verification of PR #206's
  advancement dials against the live (pre-launch) Supabase project; fixed DM Console's
  `onAuthChange` argument-order bug found along the way; filed (not fixed) a `gen_random_bytes`
  search-path bug that blocks campaign creation entirely, since fixing it is a bigger
  blast-radius call than this task's scope
  Full record: `decisions/2026/D-GH-2026-07-16-advancement-tracks-e2e.md`.
- **D-GH-2026-07-16-dev-status-page** — Added `docs/dev-status.html`, a lightweight glance
  dashboard (open Now/Next tasks + last 7 decisions + last 7 changelog entries) distinct from
  the fuller `roadmap.html`. Chose **runtime fetch** of
  `TASK_BOARD.md`/`CHANGELOG.md`/`DECISIONS.md` (never stale, zero regeneration) over
  `roadmap.html`'s baked-in snapshot — a glance page's whole value is being current, and light
  line-parsing needs no MD library; graceful fallback message when opened via `file://` (fetch
  blocked). All fetched text renders via `textContent`, never `innerHTML`, honouring the repo's
  escaping invariant. **Gated to signed-in users** (players or DMs — the app has no distinct
  account role, so "has a session" is the check): the index.html card is hidden until sign-in,
  and the page itself fails closed to a sign-in prompt without a session — but this is a
  **UX/visibility gate, not a security boundary**, since the three docs are public files on
  GitHub Pages. Verified headless (Playwright): correct counts (Now 0/Next 1/Later 3),
  signed-out gate hides the dashboard, parsers regression-free
  Full record: `decisions/2026/D-GH-2026-07-16-dev-status-page.md`.
- **D-GH-2026-07-16-close-session-auto-log** — Expanded `/close-session` from report-only to a
  skill that *writes* the session's `CHANGELOG`/`DECISIONS`/session-note and graduates finished
  tasks, then *proposes* a ready commit (still never stages, commits, pushes, or deletes). Two
  deliberate design calls: (a) the repo's single-writer rule beats the reconciliation doc's
  "log new open tasks onto the board" — the skill only *removes* finished items from
  `TASK_BOARD.md`; newly-discovered tasks are output in house format for the human; (b)
  propose-don't-stage — in a shared checkout, running `git add` risks sweeping in another
  session's changes, so the skill prints a ready `git add <named files>` + `git commit` block
  and keeps `git add`/`commit`/`push` disallowed
  Full record: `decisions/2026/D-GH-2026-07-16-close-session-auto-log.md`.
- **D-GH-2026-07-16-agents-workflow-reconcile** — Reconciled this repo's agent-workflow files
  against the cross-project AI-workflow standard: renamed `PACT_ROADMAP.md`→`TASK_BOARD.md`
  (file+pointers only, not a "roadmap" rebrand), and added three tool-agnostic discipline rules
  + a Microsoft 365 Copilot section to `AGENTS.md`. Most of the standard was already met here
  (canonical `AGENTS.md`, `DECISIONS.md` Context→Options→Decision→Why→Status, `docs/sessions/`,
  NOW/NEXT/LATER bands, a git-aware close-session) — only the genuinely-missing pieces were
  adopted; the standard's Dropbox-specific archive/retention rules were deliberately excluded
  (git already solves that) Full record: `decisions/2026/D-GH-2026-07-16-agents-workflow-reconcile.md`.
- **D-GH-2026-07-16-unify-level-lookup-helper** — Extracted the triplicated "highest level
  whose threshold ≤ value" scan into one `levelForThreshold(value, thresholdAt)` in
  `js/ui-helpers.js` (the settled shared-helpers home per D-GH-2026-07-14, **not**
  `js/engine.js` — keeps the engine API untouched and the scan is display-only, not rules);
  each tool keeps its thin `apLevel`/`trackLevel` wrapper passing its own threshold source, so
  CharGen's fixed-ladder concept stays distinct from the tools' tuned advancement curve (only
  the loop is shared, not the threshold) and `_levelCurve()` curve-resolution stays tool-local
  (out of scope); verified behaviour-identical (147/147 old-vs-new + browser-confirmed)
  Full record: `decisions/2026/D-GH-2026-07-16-unify-level-lookup-helper.md`.
- **D-GH-2026-07-15-tools-home-nav-cleanup** — Added a consistent "← Home" header link to all
  three tools and `aria-label`s to the icon-only buttons, but removed **zero** toolbar buttons
  despite the roadmap task asking to "consolidate/reduce" — the audit found the desktop vs.
  mobile toolbars are responsive-exclusive (swapped by a media query, never both visible), not
  duplicated, so any removal would drop reachable functionality on one form factor
  Full record: `decisions/2026/D-GH-2026-07-15-tools-home-nav-cleanup.md`.
- **D-GH-2026-07-15-dm-console-roster-tuned-curve** — DM Console's roster level now resolves
  the DM-tuned `levelBudgetCurve` from each character's own offline LOG `rulesSnapshot` (a
  DM-Console-local `_levelCurve()`/`trackLevel()` mirroring Live Sheet's, not a shared engine
  helper), retiring the fixed `DATA.levelAP` ladder for level *display*; chose full Live-Sheet
  parity (fall back to the Standard preset when untuned, so unbound characters' displayed level
  can shift vs the old ladder) over only-when-a-curve-is-configured, because the latter would
  still disagree with Live Sheet for untuned characters — the exact bug this fixes
  Full record: `decisions/2026/D-GH-2026-07-15-dm-console-roster-tuned-curve.md`.
- **D-GH-2026-07-15-feedback-widget** — In-app feedback widget backed by a new insert-only
  `feedback` Supabase table, the first table to grant the `anon` role a write; anonymous
  submission is allowed (PACT is sign-in-optional), made safe by insert-only/no-read grants,
  DB-level constraints, and a policy using only `auth.uid()` (not the lockdown-revoked campaign
  helpers); the widget is a self-contained module so the wiring-less Player's Guide integrates
  with one script tag Full record: `decisions/2026/D-GH-2026-07-15-feedback-widget.md`.
- **D-GH-2026-07-15-wire-audit-py-into-ci** — `audit.py`'s default (non-`--rls`) checks now run
  automatically in a new `.github/workflows/static-audit.yml` on every PR touching the files
  they cover; the `--rls` live-proof mode stays intentionally manual-only, no dedicated test
  Supabase project exists to hold its credentials
  Full record: `decisions/2026/D-GH-2026-07-15-wire-audit-py-into-ci.md`.
- **D-GH-2026-07-15-parity-warning-text-assertions** — Engine-parity gate now asserts each
  fixture's exact warning-text array via a new `testing/expected/expected-warnings.json`
  sidecar (not a new `expected-results.csv` column) — a real warning message contains a literal
  comma, which the harnesses' unquoted `line.split(',')` CSV parser can't handle safely; the
  5-of-54-`W.push`-sites fixture-coverage gap this surfaced was left open, flagged as a roadmap
  follow-up Full record: `decisions/2026/D-GH-2026-07-15-parity-warning-text-assertions.md`.
- **D-GH-2026-07-14-shared-ui-helpers** — `esc()`/`flash()`/`_csCopy()` consolidated into a new
  plain-script `js/ui-helpers.js` shared by all three tools (fixing three inconsistent `esc()`
  copies in Live Sheet alone, none of which escaped single quotes); `setTheme()`'s one-line
  `localStorage` call was deliberately left tool-local since the surrounding DOM-sync logic
  isn't actually shared Full record: `decisions/2026/D-GH-2026-07-14-shared-ui-helpers.md`.
- **D-GH-2026-07-14-livesheet-eco-track-level-review-followups** — Fixed 4
  correctness/efficiency issues an independent multi-angle review found in the same-day
  eco-line/Track-Level unification (curve resolved 3x per render, explicit-`0` and
  negative-`inc` DM curve values mishandled, a truthy-check mislabel); deferred 2
  cross-tool/architectural findings (DM Console's untuned roster, 3x duplicated level-lookup
  loop) to the roadmap instead of fixing inline
  Full record: `decisions/2026/D-GH-2026-07-14-livesheet-eco-track-level-review-followups.md`.
- **D-GH-2026-07-14-livesheet-eco-track-level** — Live Sheet's `#eco` line "Lv" chip (earned AP
  vs the fixed `DATA.levelAP` ladder) unified onto the same tuned `levelBudgetCurve` as the
  header's `≈ Track-Level` chip, called with `eco.earned` instead of `eco.spent`, relabelled
  "Earned Lv" — the two readouts can now only differ by spent-vs-earned, never by which curve
  is in effect Full record: `decisions/2026/D-GH-2026-07-14-livesheet-eco-track-level.md`.
- **D-GH-2026-07-13-campaign-join-race-friendly-error** —
  `join_campaign`/`redeem_player_invite`'s character-insert now converts a `unique_violation`
  race into the same friendly "already joined" message `bind_character_to_campaign` already
  uses, instead of a raw Postgres error
  Full record: `decisions/2026/D-GH-2026-07-13-campaign-join-race-friendly-error.md`.
- **D-GH-2026-07-14-advancement-tracks** — Campaign advancement as three display-only
  per-campaign dials (level budget curve / award pace / starting tier) stored in
  `campaigns.rules`; dropped the D&D-equivalent chip as redundant with the existing `Level N`;
  replaced (not added to) Live Sheet's earned-AP `apLevel` chip with a spent-AP tuned-curve
  `trackLevel`; left `js/ap-by-level.js` untouched (pace curve ≠ budget curve)
  Full record: `decisions/2026/D-GH-2026-07-14-advancement-tracks.md`.
  > Correction (2026-08-24, see D-GH-2026-08-03-ap-budget-curve-standard): the term
  > "pace curve" here is a mislabel. PACT has no AP-earned-per-level curve — the
  > rules define a *budget* curve (Standard L1 79/+24, Generous 83/+28, prelude L0
  > 55) and a separate *award pace* (~7 AP/session). The decision this line
  > records — leaving `js/ap-by-level.js` untouched — was still correct at the time;
  > only the parenthetical naming is wrong.
- **D-GH-2026-07-13-campaign-membership-helpers** — De-duplicate campaign-membership SQL
  checks: one new ungranted helper for the invite_code lookup, reuse the pre-existing
  `is_campaign_member()` for the membership check rather than adding a second near-duplicate
  function (a self-review catch) Full record: `decisions/2026/D-GH-2026-07-13-campaign-membership-helpers.md`.
- **D-GH-2026-07-13-campaign-bind-character** — Campaign join/invite UI Deliverable 2 (Path B):
  bind an existing character via the shared `invite_code`; non-blocking `validate()` warnings
  on join, placed in the ☁ Cloud menu rather than the header's rules-preview picker
  Full record: `decisions/2026/D-GH-2026-07-13-campaign-bind-character.md`.
- **D-GH-2026-07-13-campaign-invite-tokens** — Campaign join/invite UI Deliverable 1 (Path A):
  a single-use, per-player CSPRNG token distinct from the shared `invite_code`, redemption
  reuses CharGen's own cloud-save helpers rather than re-deriving envelope construction
  Full record: `decisions/2026/D-GH-2026-07-13-campaign-invite-tokens.md`.
- **D-GH-2026-07-13-log-fuzz-phase2** — LOG-direct pure-Node fuzzer as Phase 2 of the
  real-oracle plan; found a real `NaN` bug on its first run, held CI wiring back rather than
  bundling the engine fix into a test-only change
  Full record: `decisions/2026/D-GH-2026-07-13-log-fuzz-phase2.md`.
- **D-GH-2026-07-13-chargen-charsize-clobber** — `applyBuild()`'s render()-before-LOG-resync
  ordering silently clobbers any DOM field the "re-assert primary selects" block omits (fixed
  `charsize` + `lineage`) Full record: `decisions/2026/D-GH-2026-07-13-chargen-charsize-clobber.md`.
- **D-GH-2026-07-13-random-e2e-real-oracle** — Give the random e2e harness a genuinely
  independent oracle (fresh Node-side engine import), not just a DOM self-check
  Full record: `decisions/2026/D-GH-2026-07-13-random-e2e-real-oracle.md`.
- **D-GH-2026-07-13-campaign-rules-snapshot** — Carry campaign rules offline as an engine-inert
  LOG event, resolved live-first Full record: `decisions/2026/D-GH-2026-07-13-campaign-rules-snapshot.md`.
- **D-GH-2026-07-13-retire-pactrules-code** — Retire the local PACTRULES "#3" code path; cloud
  rules are the single restriction source
  Full record: `decisions/2026/D-GH-2026-07-13-retire-pactrules-code.md`.
- **D-GH-2026-07-12-campaign-ap-model** — Build CharGen's cloud character-load now, rather than
  defer it Full record: `decisions/2026/D-GH-2026-07-12-campaign-ap-model.md`.
- **D-GH-2026-07-12-campaign-rules-snapshot** — Ship drawback/art bans as enforcement-only;
  defer live-picker hiding Full record: `decisions/2026/D-GH-2026-07-12-campaign-rules-snapshot.md`.
- **D-GH-2026-07-11-clone-campaign-character-standalone** — Clone-to-standalone: don't forfeit
  verified DM AP, and don't touch the original as a read side effect
  Full record: `decisions/2026/D-GH-2026-07-11-clone-campaign-character-standalone.md`.
- **D-GH-2026-07-11-dgh-numbering-scheme** — Retire sequential D-GH numbers; use
  D-GH-\<date\>-\<slug\> Full record: `decisions/2026/D-GH-2026-07-11-dgh-numbering-scheme.md`.
- **D-GH48** — Save-file integrity: tamper-EVIDENT signing, in the engine, verified at every
  read path (Feature B) Full record: `decisions/2026/D-GH48.md`.
- **D-GH49** — Externalize the AP-by-level ladder: file source + back-compat DATA aliases, no
  version bump Full record: `decisions/2026/D-GH49.md`.
- **D-GH46** — Communication conventions: recommend-with-reasoning, and a tool error is not an
  answer Full record: `decisions/2026/D-GH46.md`.
- **D-GH47** — AUD-1 health-check: MUT-drift check reshaped into an engine-symbol drift guard;
  asset-size is a warning; RL… Full record: `decisions/2026/D-GH47.md`.
- **D-GH44** — CharGen campaign-rules awareness: separate module script for the cloud bridge;
  no campaign_id carry-forward… Full record: `decisions/2026/D-GH44.md`.
- **D-GH45** — A stale roadmap bug-fix entry survived two independent "doesn't reproduce"
  findings before being removed Full record: `decisions/2026/D-GH45.md`.
- **D-GH41** — CharGen's budget/drawback conflation caused unbounded AP inflation on every
  save/load/switch cycle Full record: `decisions/2026/D-GH41.md`.
- **D-GH40** — One unified save/export file format for both tools (was three divergent shapes)
  Full record: `decisions/2026/D-GH40.md`.
- **D-GH39** — CharGen's ability-score steppers never reached the LOG (found via switch-tool
  manual testing) Full record: `decisions/2026/D-GH39.md`.
- **D-GH38** — One-click tool switch on a shared js/character-store.js module (not a file
  merge) Full record: `decisions/2026/D-GH38.md`.
- **D-GH37** — Live Sheet + DM Console's foldBuild/activeEvents/economy bridged to js/engine.js
  (D-GH36's pause lifted — p… Full record: `decisions/2026/D-GH37.md`.
- **D-GH36** — DM Console's `MUT` bridged to js/engine.js; the matching foldBuild/economy
  bridge is paused (conflicts with… Full record: `decisions/2026/D-GH36.md`.
- **D-GH35** — CharGen event-sourcing model: build-equality undo, authoritative file loads, and
  a non-locking budget award Full record: `decisions/2026/D-GH35.md`.
- **D-GH34** — compute() supports two racial-trait pricing formats: replay-derived
  (presence-based) and legacy (inPlay fal… Full record: `decisions/2026/D-GH34.md`.
- **D-GH33** — CharGen imports the real js/engine.js
  MUT/foldBuild/activeEvents/economy/baseBuild (Phase 2 step 2) Full record: `decisions/2026/D-GH33.md`.
- **D-GH32** — Automatic `creationLocked` requires a `campaignBound` event; the explicit
  trigger doesn't Full record: `decisions/2026/D-GH32.md`.
- **D-GH31** — A LOG-driven `creationLocked` event/threshold replaces the dead `b.inPlay` flag
  (engine Phase 1) Full record: `decisions/2026/D-GH31.md`.
- **D-GH30** — Live Sheet's "AP left" reads the frozen ledger (`economy()`), not `compute()`'s
  retroactive recompute Full record: `decisions/2026/D-GH30.md`.
- **D-GH42** — Cloud/campaign status badge reads existing sync-ready state — no new cloud/auth
  plumbing Full record: `decisions/2026/D-GH42.md`.
- **D-GH43** — D-GH numbering: verify against the live remote before claiming, and treat
  renumber-on-merge as the accepted… Full record: `decisions/2026/D-GH43.md`.
- **D-GH29** — M365 Copilot is used only as a cold reviewer of self-contained plans — never as
  a repo-aware assistant Full record: `decisions/2026/D-GH29.md`.
- **D-GH27** — `/pick-task` may bundle several quick tasks into one branch/PR — the one
  exception to "one task per branch" Full record: `decisions/2026/D-GH27.md`.
- **D-GH28** — Homepage theme artwork is hand-authored SVG, not photos/illustrations
  Full record: `decisions/2026/D-GH28.md`.
- **D-GH26** — Engine module-bridge migration shipped as a safe subset (DATA/compute/baseBuild
  + Live Sheet MUT), not the… Full record: `decisions/2026/D-GH26.md`.
- **D-GH24** — CharGen/Live Sheet theme-restore check stays at the bottom of `<body>`, not
  inline in `<head>` Full record: `decisions/2026/D-GH24.md`.
- **D-GH25** — Leaked-password-protection roadmap item retired, not enabled
  Full record: `decisions/2026/D-GH25.md`.
- **D-GH23** — `/pick-task` Step 1 delegates its four `git show` fetches to an Explore subagent
  Full record: `decisions/2026/D-GH23.md`.
- **D-GH22** — `/run-task` uses native Claude Code worktrees (`EnterWorktree`), superseding the
  "Option A" sibling `pact-w… Full record: `decisions/2026/D-GH22.md`.
- **D-GH21** — `/plan-for-review` output is a trust-boundary crossing artifact — secrets
  excluded by instruction, not by gate Full record: `decisions/2026/D-GH21.md`.
- **D-GH20** — `ai-lessons-learned` auto-load in remote sessions:
  nudge-and-let-the-agent-decide, not auto-clone Full record: `decisions/2026/D-GH20.md`.
- **D-GH19** — Live Sheet mobile CSS: `!important` to fix a silent cascade-order shadowing bug
  Full record: `decisions/2026/D-GH19.md`.
- **D-GH18** — CharGen's `liveBase()` field diff vs `baseBuild()`: fixed the missing array,
  left `inPlay` out on purpose Full record: `decisions/2026/D-GH18.md`.
- **D-GH17** — REV-07: invite codes from `gen_random_bytes`, code length/rate-limiting deferred
  Full record: `decisions/2026/D-GH17.md`.
- **D-GH9** — Feature A found Live Sheet does NOT bridge DATA/compute/MUT from js/engine.js —
  edited both copies Full record: `decisions/2026/D-GH9.md`.
- **D-GH15** — Function EXECUTE grants: explicit `authenticated`, not implicit `PUBLIC`
  Full record: `decisions/2026/D-GH15.md`.
- **D-GH16** — Campaign rules follow-up: live-filter pickers where a pick surface exists, not
  everywhere Full record: `decisions/2026/D-GH16.md`.
- **D-GH14** — Campaign rules enforcement: separate `validate()` export, blocked at cloud push
  Full record: `decisions/2026/D-GH14.md`.
- **D-GH13** — Regression gate design: CSV baseline + two-mode runner Full record: `decisions/2026/D-GH13.md`.
- **D-GH12** — Campaign RLS: `campaign_id` column locked to SECURITY DEFINER path
  Full record: `decisions/2026/D-GH12.md`.
- **D-GH11** — Service worker caching strategy: network-first for app shell + engine
  Full record: `decisions/2026/D-GH11.md`.
- **D-GH7** — Campaign play: dual-source AP, co-DMs, and an award ledger
  Full record: `decisions/2026/D-GH7.md`.
- **D-GH4** — Data model: per-campaign non-exclusive roles, no player cap, ap locked at the
  column level Full record: `decisions/2026/D-GH4.md`.
- **D-GH8** — PWA service-worker registration lives in every tool page (Task 1)
  Full record: `decisions/2026/D-GH8.md`.
- **D-GH6** — Versioning scheme — three independent numbers Full record: `decisions/2026/D-GH6.md`.
- **D-GH5** — Mobile header uses an "app-shell" layout, not `position:fixed/sticky`
  Full record: `decisions/2026/D-GH5.md`.
- **D-GH3** — CharGen exports now match the Live Sheet's native event format
  Full record: `decisions/2026/D-GH3.md`.
- **D-GH2** — Carry the changelog / decisions / narrative discipline into the GitHub repo
  Full record: `decisions/2026/D-GH2.md`.
- **D-GH1** — Repo layout: one shared `js/engine.js`, tools are UI-only, deploy via GitHub
  Pages Full record: `decisions/2026/D-GH1.md`.
- **D-014** — PHB pages + drawback text are display data — fill them, keep `DATA.version`
  v0.322, bump build to v0.106 Full record: `decisions/2026/D-014.md`.
- **D-013** — Outline labels never reset within a session (continue A→Z→AA, not restart at A1)
  Full record: `decisions/2026/D-013.md`.
- **D-012** — Character test fixtures — engine-verified generation (SPEC'D, not built)
  Full record: `decisions/2026/D-012.md`.
- **D-011** — GitHub hosting model — CLOSED (standalone single-file / offline)
  Full record: `decisions/2026/D-011.md`.
- **D-010** — DM consoles — merge into one "DM section" (DONE v0.105) Full record: `decisions/2026/D-010.md`.
- **D-009** — Option A — single-source engine via in-place byte-identical build (not templates,
  not file-merge) Full record: `decisions/2026/D-009.md`.
- **D-008** — Don't merge CharGen + Live-Sheet Full record: `decisions/2026/D-008.md`.
- **D-007** — Three-layer history docs + log-as-you-go Full record: `decisions/2026/D-007.md`.
- **D-006** — Addressable test codes (A–G), not renamed test files Full record: `decisions/2026/D-006.md`.
- **D-005** — Machine-checkable version marker + gates, because a doc can't watch itself
  Full record: `decisions/2026/D-005.md`.
- **D-004** — File types: prose = Markdown, flat tables = TSV, queried records = JSON
  Full record: `decisions/2026/D-004.md`.
- **D-003** — Keep history (archive), don't delete Full record: `decisions/2026/D-003.md`.
- **D-002** — Many small single-purpose files + archived history, NOT a merged megafile
  Full record: `decisions/2026/D-002.md`.
- **D-001** — Front-door `INDEX.md` as the single entry point --- Full record: `decisions/2026/D-001.md`.
