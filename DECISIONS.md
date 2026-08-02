# PACT — Decisions (why it's built this way)

> Authoritative record of decisions **still in force**. One entry per decision:
> **Context → Options → Decision → Why → Status.** Newest at the TOP.
> `CHANGELOG.md` records *what* changed; this records *why*.

> **Format note (2026-07-28):** this file is now a thin index over `decisions/2026/D-*.md` records —
> see `D-GH-2026-07-28-decisions-changelog-task-board-split` below. Each bullet below ends with a
> "Full record:" pointer to that decision's own `Context → Options → Decision → Why → Status` writeup.

## Index

> One line per decision, in document order (newest on top). Follow each entry's "Full record:" pointer
> to the full **Context → Options → Decision → Why → Status** writeup under `decisions/2026/`.

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
  Changed to `v<N>` where `N` is the GitHub PR number that promotes `preview` → `main`, set once as
  part of that promotion PR (never inside a regular feature PR) and tagged onto the resulting `main`
  commit with the same number. Removes a manual "what's the next number" guess (the same shared-
  mutable-counter hazard already documented for the old `D-GH<N>` decision numbering) and makes every
  build directly traceable to the exact PR diff it shipped. `DATA.version` (rules axis) unaffected.
  Full record: `decisions/2026/D-GH-2026-08-02-build-version-pr-linked.md`.
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
