# PACT — Changelog

> One line per change, **newest first**. `DATA.version` is noted only when it changed.
> This is the scannable, going-forward log; the full pre-GitHub history is in
> `docs/history/CHANGELOG-full.md`. *Why* lives in `DECISIONS.md`; the messy middle in `docs/sessions/`.

> **Format note (2026-07-28):** entries older than 2026-07-17 were rotated out to `docs/CHANGELOG-archive-2026-06-29-to-2026-07-16.md` — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`.

- **2026-07-29 · docs: fix `/make-code-cold-plan-review` Step 7 triage gap + sync `docs/SKILLS.md`** —
  `/code-review` on PR #276 found two issues in the previous same-day change: (1) Step 7 had no defined
  action for a `blocking`-severity finding that reviewers agreed on and that hit none of the four explicit
  stop-and-ask triggers, and separately left it ambiguous whether "reviewers disagreeing" was an
  unconditional stop-trigger or only when the new disinterested-agent pass failed to resolve it. Fixed by
  making `blocking` findings always return to the user for the final call (even once the agent pass
  confirms them), and making unresolved disagreement an unconditional stop while a resolved
  minor/moderate disagreement may be applied directly. (2) `docs/SKILLS.md`'s "cold-review loop" section and
  skill-reference bullet, the human-readable authority on this skill, hadn't been updated alongside the
  prior change — now describes the cross-vendor guidance, adversarial/severity-confidence framing,
  disinterested-agent second opinion, and structured outcome table. See addendum in
  `decisions/2026/D-GH-2026-07-29-custom-skills-commands.md`.

- **2026-07-29 · docs: strengthen `/make-code-cold-plan-review` with cross-vendor, adversarial, and
  consensus-matrix guidance** — based on research into cross-model code/plan review practice (see
  `decisions/2026/D-GH-2026-07-29-custom-skills-commands.md`): (1) Step 4 now explicitly tells the user to
  prefer a reviewer from a different vendor family than the plan's author, since same-family review repeats
  its own blind spots; (2) the generated "Reviewer instructions" section now asks the reviewer to actively
  try to refute the plan (not just "check it over") and to tag each finding with a severity
  (blocking/moderate/minor) and confidence (high/low); (3) the "Review outcome" stub is now a structured
  table (finding, severity, confidence, raised-by, cross-family agreement, disposition) instead of a
  free-text summary; (4) Step 7's triage now sends any `blocking`-severity or reviewer-disputed finding to a
  fresh, context-free `Agent` call for a disinterested second opinion before the plan's own author decides,
  to avoid the same session grading its own homework. Added `Agent` to the command's `allowed-tools`.

- **2026-07-28 · docs: migrate DECISIONS.md/CHANGELOG.md/docs/TASK_BOARD.md to the split-file pattern** —
  `DECISIONS.md` (371,703 bytes, 112 full records + 1 orphaned index-only entry) is now a thin index over
  `decisions/2026/D-*.md` (41,077 bytes live). `docs/TASK_BOARD.md` (35,953 bytes) split into
  `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by its existing bands. `CHANGELOG.md` (271,870 bytes, 281
  entries) rotated everything older than 2026-07-17 into `docs/CHANGELOG-archive-2026-06-29-to-2026-07-16.md`
  (238 entries, ~233KB), keeping 43 entries live (~40KB) — extending this project's own pre-existing
  `docs/history/CHANGELOG-full.md` rotation precedent (D-002/D-003) rather than inventing a new pattern for
  changelog entries specifically. Also fixed `docs/dev-status.html`'s live client-side fetch/parse of the
  task board (it fetched a single `TASK_BOARD.md` at runtime; now fetches and merges all three band files)
  and updated every other file with a hardcoded `docs/TASK_BOARD.md` reference (`AGENTS.md`,
  `.github/copilot-instructions.md`, `.github/pull_request_template.md`, `docs/SKILLS.md`,
  `docs/HOW-TO-WORK.md`, `docs/roadmap.html`) — `.claude/commands/*.md` needed no changes, already
  hardened for either file shape by `D-GH-2026-07-28-command-format-agnostic`. Every-session-relevant read
  path (AGENTS.md + DECISIONS.md + TASK_BOARD_NOW.md + live CHANGELOG.md) dropped from ~705KB to ~109KB
  (~85%). See `DECISIONS.md` D-GH-2026-07-28-decisions-changelog-task-board-split for the full rationale.
- **2026-07-28 · docs: add 'technical access != scope' rule** — Added a "Technical Access ≠ Scope" section
  to `AGENTS.md`, after direct testing on Home AI Server confirmed a session with broad, non-enforced
  access would cross into a different project's files if asked. See `DECISIONS.md`
  D-GH-2026-07-28-technical-access-not-scope.
- **2026-07-28 · docs(commands): make task-board/decisions commands format-agnostic** — hardened all 7
  `.claude/commands/*.md` files that read or write `docs/TASK_BOARD.md`/`DECISIONS.md` to check for the
  split-file shape (`TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md`, a thin `DECISIONS.md` index over
  `decisions/<year>/D-*.md`) before assuming today's single-file layout. No content migration — this
  project's own `DECISIONS.md`/`CHANGELOG.md` are still the current single-file shape, tracked as their
  own future task. See D-GH-2026-07-28-command-format-agnostic.
- **2026-07-26 · fix(dm-console): sticky header down to one row, theme dropdown readable** — the sticky
  `header.topbar` stacked title/summary/last-edited/actions as separate block elements (~4-5 rows); moved
  the summary/last-edited line into a new non-sticky `.subbar` right below it, and made the header itself
  a single flex row (home link, title, actions) — sticky scroll now only ever pins that one ~53px row.
  Separately, `#dmThemeSel`'s native `<option>` popup inherited the closed box's white text with no
  explicit background, rendering white-on-the-browser's-default-white in every theme; added
  `#dmThemeSel option{color:#1F3864;background:#fff}` so the list is readable regardless of the header's
  current `--navy`/`--blue` (which only paint the closed box, never the native popup).

- **2026-07-25 · docs(add-code-task): drop the pre-commit approval gate** — `/add-code-task` now shows the
  drafted task block and proceeds straight to committing it to `docs/TASK_BOARD.md` in the same turn,
  instead of waiting for an explicit "yes"/"looks good" first (D-GH-2026-07-25-add-task-drop-approval-gate).
- **2026-07-25 · feat(characters): "My Characters" page — archive/delete, campaign grouping, open-in-tool
  deep links** — new `tools/characters.html`: every cloud-saved character (CharGen + Live Sheet) in one
  signed-in, online-only view, grouped by campaign name (via `listMyCampaigns()`) with a "No campaign"
  bucket, and a "Show archived" toggle (archived rows hidden by default). Each row: Open in CharGen/Live
  Sheet (disabled with an "empty" tag for `hasData:false` rows), Archive/Unarchive (reversible), and —
  only once archived — Delete permanently (uses the existing, previously UI-less `deleteCharacter()`).
  `js/sync.js` gained `listMyCharacters()` (owner-scoped, unlike `listCharacters()` which also returns a
  DM's-eye view via `is_campaign_dm`), `archiveCharacter()`/`unarchiveCharacter()`. DB: `characters` gained
  `archived_at timestamptz` + `grant update (archived_at) on characters to authenticated` — no RPC needed,
  unlike `campaigns.archived_at`, because `characters_update`'s RLS is already owner-only (see
  D-GH-2026-07-25-character-archive). CharGen and Live Sheet both gained a `?cloudChar=<id>` boot-time deep
  link (each tool's existing cloud-load logic extracted into a shared `loadCloudChar(id,label)`, called by
  both the menu click and the new boot handler) so the new page's "Open in ..." buttons can hand off to a
  specific saved character. Discoverability: a "📋 My Characters" link in each tool's ☁ Cloud menu, plus a
  card on `index.html`.
- **2026-07-25 · fix(sync, live-sheet, chargen): "No character data found" on cloud-load** — reported as
  every entry in Live Sheet's "Load saved character" list failing with this error. Root-caused against
  the **live database** (not just code): all 4 affected rows had `stats` = `{}` or `{"note":"hello"}` —
  pre-launch test/stub data with no `LOG` array, not corrupted real saves. Deleted the 4 stub rows
  (`piuprrrnaotrtxucrtsb`, table `characters`). Separately hardened both tools against this class of row
  recurring (e.g. a redeemed player invite a player never opened): `js/sync.js`'s `listCharacters()` now
  selects `stats->LOG` and returns a `hasData` flag per character; both CharGen's and Live Sheet's
  cloud-load menus render a `hasData:false` row as an inert, greyed "empty" entry (shown, not hidden — a
  player should still be able to see it exists) instead of a clickable button that resolves to the
  generic error after the user already committed to loading it. Verified end-to-end in a real browser
  (both tools) with a mocked signed-in session carrying one real and one stub character: the stub renders
  as a non-interactive `<div>` with no click handler attached, the real one still loads correctly.
  Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): "Award" button silently clipped off-screen on narrow viewports** —
  reported as "no button to push AP to players." Reproduced: the Campaign Roster's Award AP cell needs
  ~250px for its amount/note/button row, but `#campRoster table{width:100%}` forces the table to fit
  its container regardless, and `#campRoster{overflow:hidden}` (there for the rounded corners) silently
  clips whatever doesn't fit instead of wrapping or scrolling — confirmed via a real headless-browser
  render at 320-414px widths that the Award button's bounding box extended well past the visible
  container, while the amount input (visible) stayed in view, matching exactly what was reported. Fixed
  by wrapping the table in its own `.roster-scroll` (`overflow-x:auto`, table `min-width:560px`) so
  narrow viewports scroll horizontally to reach Award/History instead of losing them — verified the
  scroll region activates, the button becomes reachable and clickable after scrolling, and desktop
  widths are unaffected (button was already fully visible there). Display-only; no `DATA.version` bump.

- **2026-07-25 · fix: favicon on every remaining HTML page** — follow-up to the index/DM-Console
  favicon fix. Swept every `.html` file in the repo (`find . -iname "*.html"`, excluding
  `docs/history/` archives) and added the same `assets/icons/PACT_favicon.png` `<link rel="icon">` to
  the 9 that still had none: `login.html`, `404.html`, `docs/PACT-Players-Guide.html`,
  `docs/dev-status.html`, `docs/roadmap.html`, `testing/campaign-test.html`, `testing/sync-test.html`,
  `testing/tests/engine-parity.html`, `testing/tests/sync-timestamp.html` — relative path depth adjusted
  per file's location. `docs/PACT-Players-Guide.html` edited via a targeted `Edit` (not a full read) per
  its own "never read wholesale" note — confirmed the exact existing `<link>` text via a 1-line `Read`
  first. Verified every page+icon pair resolves 200 via both direct HTTP requests and a real browser
  (favicon request observed firing from each page's actual served location) — `404.html`'s favicon
  request couldn't be observed in the local test harness because the page's existing
  `window.location.replace()` redirect fires immediately (expected; it correctly returns to `/PACT/` on
  the real site), but the `<link>` tag itself and direct icon fetch both confirmed present/200.
  Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(index, dm-console): consistent browser-tab favicon across the whole app** —
  `index.html` had its own one-off inline SVG "P" emblem (a different icon than every other page); DM
  Console had **no** `<link rel="icon">` at all (a deliberate omission from an earlier favicon pass —
  D-GH-2026-07-19-pwa-manifest-icon-coverage — now reversed at explicit request). Both now use the same
  `assets/icons/PACT_favicon.png` CharGen/Live Sheet already use (relative path, matching those two
  tools' existing convention). Verified via real HTTP requests (not just file existence) that the
  favicon resolves with a 200 from both pages' actual served locations. `login.html` still has no
  favicon — out of scope of this ask, left alone. Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): Campaign panel on its own row; Import Roster dims when a cloud
  campaign is active** — `#campPanel` had no explicit flex-basis (`flex:1 1 300px`), so at wide enough
  viewports it could sit alongside Import Roster/AP Grant Code instead of getting its own row, despite
  being the longest of the three panels. Changed to `flex:1 1 100%` (matching the `#drop` drop-zone's
  existing "always its own full row" pattern) — Campaign now always renders below the other two,
  full-width. Separately: Import Roster (local `.json` drag-drop) and a loaded cloud campaign's live
  roster are two independent, coexisting features — confirmed neither UI state hides the other
  (`selectCampaign()` never touches `#grid`/`#empty`). Reported as confusing which one "is" the
  campaign; added a `dimmed` class (opacity .55, full opacity on hover) toggled on `#importPanel`
  whenever a campaign is selected, plus a small clarifying note — dims rather than disables, since
  local-file review alongside an active campaign remains a legitimate use. Verified in a real browser
  (both themes, wide viewport) with a full mocked Supabase session exercising the actual
  `selectCampaign()`/`updateAuth()` code paths. Display-only; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): boon/drawback tooltips in Campaign Rules banned-lists** — the
  "Banned boons"/"Banned drawbacks" checkbox grids showed only names, no description of what each
  actually does. Added an optional 3rd element to `RULE_GRIDS` entries (a per-name tooltip-text
  function) and a conditional `title=` attribute in `renderRuleGrids()`'s shared render template —
  reads `DATA.boons[name].fx` / `DATA.drawbackFx[name]` directly (the same data every other tool
  already reads for these descriptions; confirmed via research that CharGen/Live Sheet already
  normalize both maps to a common `.fx` shape and CharGen's racial-trait checkboxes already use the
  identical `title=`-from-DATA pattern), so there's exactly one source of truth and no new text to
  keep in sync. Also investigated adding a symmetric "banned as 2nd origin classes" list to mirror
  "2nd origin species" — found it would be a no-op: `validate()` already bans a class in both
  `originClass`/`originClass2` slots via the single existing `bannedOriginClasses` list; species has
  a *second*, asymmetric list only because it also supports an "okay as primary, not as bonus 2nd"
  case that classes never had modeled. Logging the asymmetric-class-ban feature as a separate task
  rather than building it here (a real engine design decision, not this task's scope). Verified
  end-to-end in a real browser with a full mocked Supabase session (not just CSS, this time — the
  actual `campaign-ready`-gated render path executed): 88/88 boons and 69/69 drawbacks carry correct
  tooltip text; the five unaffected grids (species, 2nd origin species, origin classes, masteries,
  arts) confirmed to have no `title=` regression. Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): campaign-panel polish — layout order, code tooltips, oversized fields**
  — Three follow-ups from live feedback on the campaign create/archive feature. (1) "New campaign" and
  "Archived campaigns" moved from the top of the Campaign panel (shown before any selected-campaign detail,
  confusing on every load) to the bottom, in that order — selected-campaign details now show first. (2)
  Added a small ⓘ button next to the Players/DMs invite codes (hover *or* click, matching existing
  `title`-attribute hint patterns like `.warnicon`/`.tamper` elsewhere in this file) explaining what each
  reusable code does — while wiring this up, confirmed `joinAsDm()` (the co-DM redemption RPC) has no
  consuming UI in *any* tool, same class of dead-code gap `createCampaign()` had before this session; not
  fixed here, flagged to the user as a possible follow-up task. (3) `body` never set an explicit
  `font-size`, so every `.field` input and non-`.sm` `.btn` (which both use `font:inherit`) fell back to
  the browser default (~16px) against the rest of the UI's deliberate 11–14px scale — reported as
  "Starting DM AP"/"Starting Budget AP" (invite-form placeholders) looking oversized, but affected every
  `.field`/plain `.btn` in the tool. Fixed at the root with one `body{font-size:14px}` rather than
  patching each selector. All three verified in a real browser — including, for the first time this
  session, with the `campaign-ready`-gated JS (create/archive/info-button click handlers) actually
  exercised via a stubbed `supabase-client.js` import (this sandbox has no network path to esm.sh, so
  earlier same-session screenshots only verified CSS/layout, not click wiring — noted for the record).
  Display-only; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): add theme selector (Default/Dark/D&D·Parchment/Royal/Forest)** — DM
  Console had zero UI to change theme (only ever picked up dark mode from OS `prefers-color-scheme`,
  no way to override it, and none of Live Sheet/CharGen's other 3 themes existed there at all). Added a
  `<select id="dmThemeSel">` in the top bar (matching Live Sheet/CharGen's existing `#themesel` pattern),
  a `dmSetTheme()` persisting to `localStorage['pact-dm-theme']`, and three new `[data-theme]` variable
  blocks (`dnd`/`royal`/`forest`) mapped onto DM Console's own token set (`--navy`/`--navy2`/`--blue`/
  `--blue-lt`/`--light`/`--paper`/`--card`/`--ink`/`--muted`/`--line`/status-color pairs) — colors chosen
  to match the other two tools' equivalent themes where a direct token existed, derived consistently
  from the existing `default`/`dark` blocks' pattern where DM Console has extra tokens the others don't.
  Verified all 5 themes in a real browser (init script, live switch, and page-reload persistence) —
  campaign panels/buttons from the two contrast fixes above render correctly in every theme, confirming
  those fixes were token-based rather than color-literal. Display-only CSS; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): create + archive/unarchive campaigns** — DM Console had no way to
  create or remove a campaign. Wired up the existing (previously dead-code) `createCampaign()` behind a
  new "+ New campaign" row, and added reversible archive (not hard delete — see D-GH-2026-07-25-
  campaign-archive for why) via new `archive_campaign()`/`unarchive_campaign()` RPCs, an "Archive
  campaign" button (owner-only, confirm-gated), and an "Archived campaigns" panel with per-row Unarchive.
  New `campaigns.archived_at` column, genuinely owner-only via a column-level UPDATE grant lockdown
  (mirrors `characters.ap`'s existing pattern) — closes a gap where the previous blanket grant would have
  let any co-DM write it directly. Applied live via Supabase MCP (`get_advisors` clean beyond the
  standard boilerplate every RPC here already has), persisted as
  `sql/migrations/2026-07-25-campaign-archive.sql` + `sql/schema.sql`/`sql/rls-policies.sql`. Also fixed
  `.btn.ghost` (Copy/Unarchive buttons), found unreadable in light theme while verifying the new UI —
  same root cause as the panel/dark-theme fixes below. Display-only CSS; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): dark-theme contrast — buttons, chips, table headers, and field
  values were unreadable** — follow-up to the panel/label fix below. Root cause: `[data-theme="dark"]`'s
  `--light` custom property was `#475569` (a medium slate), nearly the same luminance as `--navy`
  (`#0f1729`) and `--blue` (`#1a3a5c`) in dark mode — so every component pairing `--light`+`--navy`
  (`.btn`, `.chip`, `.card .csub .tier`, `#tableRoot table.awards th`/`.badge`, `#campRoster th`) and the
  header's own `.summary` subtitle text collapsed to ~1.5:1 contrast (WCAG AA needs 4.5:1). Fixed by
  changing dark theme's `--light` to an actually pale value (`#c9d6ec`) — one token, fixes every affected
  component at once (verified: Sign in/Generate code/Copy/Save rules buttons, roster table headers,
  tier/award badges). Separately, `.field`/`#campSel` had a hardcoded near-white background (both themes)
  but `color:var(--ink)` (theme-varying — light gray in dark mode), so typed/selected values were
  near-invisible; changed to `color:var(--navy)`, matching the already-correct convention its sibling
  `.field.ro` uses for the same fixed-light-background pattern. `#tableRoot`'s own locally-scoped
  variables (always light, by design, unaffected by `[data-theme]`) were left untouched. Display-only,
  no `DATA.version` bump; verified visually in both themes via headless screenshot.

- **2026-07-25 · fix(dm-console): panel/label text illegible against its own card background** —
  `#importPanel`/`#grantPanel`/`#campPanel`'s `.ptitle`, `label.lbl`, `.grantnote`, and ~15 similar
  Campaign-Rules labels/notes used `var(--light)` (a pale near-white blue) as text color, styled for the
  navy hero header they were copy-pasted from — but these panels actually sit in `<main>` on the light
  `--paper` background, making the text nearly invisible (reported: "AP grant code" / "Amount" / "Note
  (optional)" / the whole-party grant note unreadable). Fixed by giving `.panel` a proper card treatment
  (`--card` background, `--line` border, `--shadow`, matching `.card` elsewhere) and switching all
  panel-scoped label/note text to `--muted` (checkbox labels to `--ink`), the same variables already used
  for equivalent labels elsewhere in this tool (`.xtra .xlabel`, `.cglabel`). `.hrchip` house-rule chips
  got a real chip background (`--paper`/`--line`) for the same reason. Display-only CSS/JS-template
  change — no `DATA.version` bump. Verified visually in both light and dark theme via a headless
  screenshot. Left the header's own (correctly-placed) `--light` text and the pale-bg/navy-text chip
  components (`.chip`, table headers, badges) untouched — a separate, unreported low-contrast issue
  affecting those chips/buttons and `.field` input values specifically in dark theme was noticed but not
  fixed here (out of scope of the report); worth a follow-up task if it bothers users in practice.

- **2026-07-21 · docs(sessions): corrected the 2026-07-20/2026-07-21 date-labeling mistake** — fixed
  everywhere across `family-hub`, `wildlife-explorer`, and PACT's own two session notes about them:
  decision IDs, `CHANGELOG.md` entry dates, and session-note filenames. Left every reference to the
  *other*, genuinely-pre-existing `2026-07-20` dates untouched in both target repos (family-hub's
  original Copilot planning session, wildlife-explorer's Milestone-5 planning log) — those are real,
  not mislabeled. Also left the two decision IDs a separate, concurrent status-review session added to
  wildlife-explorer (`D-2026-07-20-web-session-branch-override`, `D-2026-07-20-branch-model-confirmed`)
  untouched — no basis to assume those are wrong too. Done as new commits in each repo, not history
  rewrites, since `family-hub`'s and `wildlife-explorer`'s originals were already pushed.

- **2026-07-21 · docs(sessions): light-ported the memory-layer scaffold to a fifth repo,
  PACT_Players**: a Quartz-based campaign-content site, not a software project — full scaffold skipped
  (no `AGENTS.md`, no Effort/Risk task board), only `CHANGELOG.md`/`DECISIONS.md`/`sessions/` (repo-root,
  not `docs/sessions/` — that's Quartz's own vendored docs) plus 4 of 8 skills. Mid-port, discovered a
  concurrent session had already authored a real `TASKS.md`; adopted it rather than overwriting with a
  placeholder. Also caught (not yet fully corrected) a session-wide date-labeling mistake — this and the
  prior two ports were mislabeled `2026-07-20` when the actual date was `2026-07-21`. See
  `docs/sessions/2026-07-21-port-agents-scaffold-to-pact-players.md`.

- **2026-07-21 · docs(sessions): ported the AGENTS.md/skills scaffold to a fourth repo,
  wildlife-explorer**: additive, not build-fresh — unlike family-hub (ported moments earlier the same
  session), this repo already had a real governance file (`AI.md`) and a genuinely working
  `npm run check` test/build/encoding-audit gate, so `AGENTS.md` was scoped as a thin process-layer
  supplement rather than a competing entry point; `AI.md` was left completely untouched. Confirms a
  "three independent axes" shape space (governance layer / product docs / real verification gate, each
  present or absent independently) rather than a simple blank-vs-mature spectrum. Nothing in PACT itself
  changed beyond this session note; see
  `docs/sessions/2026-07-21-port-agents-scaffold-to-wildlife-explorer.md` for the full detail
  (target-repo decisions logged in wildlife-explorer's own `DECISIONS.md`).

- **2026-07-21 · docs(sessions): ported the AGENTS.md/skills scaffold to a third repo, family-hub**:
  same manual copy-and-adapt pattern as the `petdetective`/`homelife` ports, done directly against the
  local clone at `C:/Users/user/dev/family-hub`. A genuinely third target-repo shape — not blank-slate,
  not mature-with-conflicting-conventions, but rich product-planning docs with zero AI-workflow
  governance layer. Nothing in PACT itself changed beyond this session note; see
  `docs/sessions/2026-07-21-port-agents-scaffold-to-family-hub.md` for the full detail (target-repo
  decisions logged in family-hub's own `DECISIONS.md`, not duplicated here).

- **2026-07-20 · feat(tooling): close-code-session stages/commits/pushes once you approve the letter**:
  removed the `git add`/`git commit`/`git push` tool restriction at the user's explicit request — Part 3
  now surfaces "stage, commit, and push" as one of its lettered follow-ups and runs it once approved,
  instead of only ever printing the command for manual hand-off. The shared-checkout mitigation (never
  `git add -A`/`.`, always name exact files, re-check `git status` right before staging) is unchanged and
  still applies regardless of who runs the add. Merging, rebasing, resetting, and deleting are still always
  disallowed. See `D-GH-2026-07-20-close-code-session-run-commit`.

- **2026-07-20 · chore(repo): swept 126 stale remote branches + 6 local worktree remnants**: local
  cleanup removed 1 merged local branch/worktree (`feat/clone-char-standalone`, its lock stale — the
  claimed PID wasn't running) and 5 orphaned `.git/worktrees/` admin dirs left over from past
  `ExitWorktree` runs that never fully cleaned up (these were also the cause of the "Permission
  denied" noise on every `git fetch` this session and prior sessions — resolved). Remote cleanup
  classified all 129 `origin/*` branches against their PR history (`main`/`preview` never touched):
  114 merged via PR, 2 closed without merging, 2 with no PR but fully absorbed into `preview`, and 8
  with no PR and genuine unique commits — all verified superseded/already-shipped duplicates from
  concurrent sessions except one (`claude/remote-control-149hqs`, held back pending its stored-XSS
  fix); confirmed that fix already shipped via an identical parallel-session commit already on `main`
  (`8660d42`, same message/timestamp as the held branch's `b3f7df3`), then deleted it too. Full
  methodology and the Windows/Git-Bash CRLF pitfall hit along the way: see
  `docs/sessions/2026-07-20-remote-branch-worktree-cleanup.md`.

- **2026-07-20 · docs(tooling): close-code-session's session-note step writes without pausing**:
  Part 1 item 3 (`docs/sessions/<date>-<topic>.md`) now says explicitly that once the write
  criteria are evaluated, the file is written (or skipped) immediately in the same turn — no
  presenting the evaluation as a question and waiting for a reply first. Closes the gap flagged
  in the `TASK_BOARD.md` entry this graduates; the user had been missing session-note writes
  because a prior run paused for confirmation that the skill never actually required.

- **2026-07-19 · docs(terminology): replaced "roadmap" with "task board" everywhere it referred to
  `docs/TASK_BOARD.md`**: `AGENTS.md`, `docs/SKILLS.md`, `docs/HOW-TO-WORK.md`, and all 6
  `.claude/commands/*.md` skill files (9 files, ~38 occurrences) — including `/add-code-task`'s own
  future-commit template (`docs(roadmap): ...` → `docs(task-board): ...`), so new task-board-addition
  commits use the new scope going forward. `CHANGELOG.md`/`DECISIONS.md`/`docs/sessions/*.md` left
  untouched, same as the earlier `-code-` command rename — dated historical record, not rewritten.
  "Roadmap" was never a stale filename reference (the file has always been `docs/TASK_BOARD.md`), just
  informal vocabulary for the same thing; the two terms coexisting caused real confusion, so picked one.
  Docs/skill-file text only — no code or rules touched, parity unaffected (still 20/0).

- **2026-07-19 · chore(release): bump BUILD to v0.203**: mirrored across all three tools per
  `docs/VERSION-SYNC.md` (CharGen's line-1 comment, `<title>`, header `.sub` label, and its
  JS-side title-template string; Live Sheet's line-1 comment; DM Console's `TOOL_VERSION`).
  Cosmetic build-number bump only — `DATA.version` unchanged, parity still 20/0. The earlier
  cloud-session restriction that blocked a plain `git tag`+`git push` and a `gh api .../releases`
  POST (see `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md`) was
  specific to that cloud-session proxy — a local session tagged `v0.203` and pushed it on
  2026-07-19 without issue, and GitHub auto-generated the matching Release from the tag push.
  Both now exist: https://github.com/Chompy78/PACT/releases/tag/v0.203.

- **2026-07-19 · fix(feedback) — fixed CSS specificity collision hiding the anon checkbox
  incorrectly**: `js/feedback.js`'s `.pact-fb-anon{display:flex}` rule had the same
  specificity/origin as the browser's built-in `[hidden]{display:none}` rule and won by source order,
  so `anonWrap.hidden = true` (the signed-out default) never actually hid the "submit anonymously"
  checkbox row. Scoped the selector to `.pact-fb-anon:not([hidden])` so the browser's own `[hidden]`
  rule applies again. Verified in a real browser (Playwright/Chromium, isolated harness with a stubbed
  Supabase client): signed-out now computes `display:none` (no checkbox/empty box); signed-in still
  computes `display:flex` with a working, checkable checkbox. Display-only, no `DATA.version`/engine
  impact; parity still 20/0.

- **2026-07-19 · fix(feedback) — inlined the "submit anonymously" checkbox with its contact note**:
  `js/feedback.js`'s checkbox (shown only to signed-in users) previously rendered as its own row below
  the "Optional — only if you'd like a reply..." note; both now share one flex row
  (`.pact-fb-note-row`), checkbox first. Verified in a real browser (Playwright/Chromium, isolated
  harness with a stubbed Supabase client) at both a normal width and the 420px mobile breakpoint, in
  both the signed-out (checkbox absent) and signed-in (checkbox inline) states. Display-only, no
  `DATA.version`/engine impact; parity still 20/0. While verifying, found a separate pre-existing bug
  (the signed-out checkbox isn't actually hidden due to a CSS specificity collision) — filed as its own
  roadmap task rather than folded into this fix, since it predates this change and isn't scoped to it.
- **2026-07-19 · chore(release) — graduated A6 (tag releases to build version)**: confirmed done —
  `v0.107` was tagged with a GitHub Release on 2026-07-17; no further action needed, so the task-board
  entry (which had flagged itself for human confirmation) is removed.

- **2026-07-19 · fix(pwa) — closed the last two PWA-completeness gaps: manifest + apple-touch-icon on
  every HTML entry point**: `login.html` and `docs/PACT-Players-Guide.html` gained `<link rel="manifest">`
  (previously only `index.html` and the three tools declared it); all five non-`index.html` entry points
  (`login.html`, the Player's Guide, and all three tools) gained `<link rel="apple-touch-icon"
  href="/PACT/icons/apple-touch-icon.png">`, matching the tag `index.html` got in the previous PWA fix —
  DM Console included, since the browser-tab-favicon exclusion it got in an earlier change was never
  reasoned to extend to the home-screen icon. Every new link uses the absolute `/PACT/...` path, matching
  `manifest.json`'s own convention (the existing tool favicon links use a relative path — a pre-existing
  inconsistency, left as-is). HTML well-formedness verified (all 5 files parse cleanly); no `js/engine.js`
  change, parity 20/0.

- **2026-07-19 · fix(pwa) — bumped service-worker cache + widened network-first coverage + wired the
  missing apple-touch-icon**: `CACHE_NAME` `pact-v6`→`pact-v7`, forcing already-installed/returning users
  to pick up `js/character-store.js` (cache-first; holds this session's Continue-feature `recordAutosave`,
  which was otherwise stuck stale for them indefinitely). Also widened `NETWORK_FIRST_RE` to cover
  `js/ui-helpers.js` (holds `esc()`, the shared XSS-escaping helper all three tools call), `js/ap-by-level.js`,
  and `js/advancement.js` — same "costs nothing, only speeds up fix propagation" reasoning as
  D-GH-2026-07-16-sw-network-first-security-modules, applied to three files that were added since and never
  covered; added all three to `PRE_CACHE` too, matching every other network-first file. Separately, added a
  `<link rel="apple-touch-icon">` to `index.html` — the correctly-sized asset (`/icons/apple-touch-icon.png`)
  already existed and was in `manifest.json`, but no page actually referenced it via the explicit tag iOS
  Safari's "Add to Home Screen" relies on most reliably. Engine untouched, parity 20/0.

- **2026-07-19 · chore(commands) — renamed all 8 Claude Code custom commands to carry `-code-`**: `add-task`→
  `add-code-task`, `cleanup-branches`→`cleanup-code-branches`, `close-session`→`close-code-session`,
  `log-ai-lessons`→`log-code-lesson`, `pick-task`→`pick-code-task`, `plan-for-review`→
  `make-code-cold-plan-review`, `run-task`→`run-code-task`, `sweep-tasks`→`sweep-code-tasks` — distinguishes
  them at a glance from the author's separate `-chat-` Claude.ai Skills. Updated every cross-reference in
  `.claude/commands/*.md`, `AGENTS.md`, `docs/SKILLS.md` (which also gained an old→new mapping table),
  `docs/HOW-TO-WORK.md`, `docs/TASK_BOARD.md`, and `.gitignore`. `CHANGELOG.md`/`DECISIONS.md`/
  `docs/sessions/` deliberately left using the old names — dated historical record, not rewritten.

- **2026-07-18 · feat(tools) — CharGen and Live Sheet now show the anvil/hammer PACT favicon**: moved
  `assets/PACT_favicon.png` → `assets/icons/PACT_favicon.png` and added `<link rel="icon"
  type="image/png" href="../assets/icons/PACT_favicon.png">` to the two non-DM tools' `<head>` (right after
  the manifest link). DM Console deliberately left unchanged. Verified in a real browser: both tabs load the
  favicon (200) and DM Console has no icon link. Asset/display-only — no `DATA.version` or `BUILD` change.
- **2026-07-18 · feat(landing) — "Continue where you left off" recent-characters section**: `index.html`
  now shows resume cards for your last 3 distinct characters plus a collapsible timeline of the last 10
  autosaves, each resuming into the right tool via the existing `?handoff=` baton. Backed by a new shared
  versioned-autosave store in `js/character-store.js` (`recordAutosave`/`readRecent`, key `pactRecentV1`):
  both tools now additively feed it from their autosave (never touching their own restore slot, fully
  guarded). Capture uses time **and** difference — identical snapshots are skipped, rapid same-character
  edits coalesce, and a new snapshot is cut only on a ≥2-min gap, a tool switch, or a ≥5-event jump — so a
  keystroke burst can't fill it with duplicates. Character names render via `textContent` (XSS-safe). BUILD
  v0.201→v0.202; engine untouched (parity 20/0). See `DECISIONS.md` D-GH-2026-07-18-continue-recent-chars.
- **2026-07-18 · fix(chargen) — made CharGen's rules-version display read live from `DATA.version`**: 
  CharGen's header shows "PACT rules · vX" in both a `.hd-pactver` span and the `<title>` tag, but both 
  were hardcoded to v0.336 instead of reading `window.DATA.version` at `engine-ready` like Live Sheet 
  and DM Console already do. Added `id="cgPactver"` to the span and an event listener that updates both 
  the span text and the page title with the live version. Display-only — no rules/`compute()` change, 
  `DATA.version` unchanged. Mirrors the now-documented follow-up to the prior v0.332→v0.336 display-drift fix.

- **2026-07-18 · docs(agents) — refreshed stale version parentheticals in AGENTS.md**: The Versioning 
  section's "currently" notes for BUILD and DATA.version had drifted since PR #251: listed v0.107 
  and v0.332. Updated both to match the live values at merge time (real: v0.202 per js/engine.js — 
  bumped again since this PR was first opened, caught during its pre-merge rebase — and v0.336 per 
  js/engine-data.js). Docs-only — no code or rules change.
- **2026-07-18 · feat(theming) — extended localStorage-based theme switching to guide and DM Console**: 
  PACT-Players-Guide.html now supports the same 4-theme system as index.html (parchment/midnight/dragonfire/contrast) 
  with localStorage persistence. DM Console gained dark-mode support with system preference fallback, maintaining 
  its modern design language. CharGen and Live Sheet already had theme switching. Theming pattern now consistent 
  across all public-facing UIs.

- **2026-07-17 · fix(chargen) — synced CharGen's hardcoded rules-version display to the real
  `DATA.version`**: CharGen showed "Rules v0.332" (title + `.hd-pactver` header label + two doc comments)
  while the engine's canonical `DATA.version` had advanced to **v0.336** — a pre-existing display drift.
  Updated all four spots to v0.336. CharGen is the only tool that hardcodes this (Live Sheet and DM Console
  already read `DATA.version` live at `engine-ready`, so they can't drift); the misleading comment claiming
  the label "tracks DATA.version" was corrected to say it's hardcoded, and a follow-up to make CharGen
  live-read it too was noted. Display-only — no rules/`compute()` change, `DATA.version` untouched.

- **2026-07-17 · refactor(engine) — REV-14a: extracted the `DATA` rules dataset out of `js/engine.js`
  into its own `js/engine-data.js` module**: `engine.js` shrinks from ~189 KB (dominated by one 189 KB
  `DATA` literal line) to ~65 KB and now imports + re-exports `DATA` unchanged, so every tool/importer
  sees the identical surface — matching the existing `ap-by-level.js`/`advancement.js` externalization
  pattern. Byte-identical output verified: the moved literal is character-identical **and** deep-equal to
  the original, `engine-parity` (incl. warnings) reports **20/0**, and all 14 named exports are unchanged.
  `service-worker.js` updated (cache `pact-v5`→`pact-v6`, `engine-data.js` precached + network-first) so
  the rules dataset keeps `engine.js`'s immediate-fix-propagation semantics instead of going stale on a
  cache-first copy (see `DECISIONS.md`). No rules change — `DATA.version` unchanged (still v0.336); `BUILD`
  bumped **v0.200 → v0.201** (non-trivial structural build) and mirrored across the three tools per
  `docs/VERSION-SYNC.md`. Real-browser boot check (Chromium, all three tools): `engine-ready` fires, the
  bridges' `DATA` mutation succeeds (confirming `.js` is not frozen), and `compute()` runs clean. Follow-up
  **REV-14b** (split `compute()` into named sub-pricers) stays open; a cold-reviewed plan for the whole of
  REV-14 lives at `docs/plans/2026-07-17-engine-breakup-rev14.md`.

- **2026-07-17 · docs(roadmap) — scored `docs/TASK_BOARD.md`'s remaining untagged items with
  Effort/Risk tags**: REV-14, real icons, both landing-page follow-ups, A1/A3/A7's remaining scope, and
  the `MUT.patch` rename/restriction idea now carry the three-factor Risk breakdown, so they're visible
  to `/sweep-tasks` (most land at `Risk: high` — architectural/engine-touching or new live-data-table
  work — with real icons the one `Risk: low` exception, blocked only on art). The vague "Supporting
  reference tasks" bullets were deliberately left untagged — not scoped enough to rate. Also flagged
  (not fixed): A6's release-tagging work already shipped (v0.107) but was never marked done here.

- **2026-07-17 · fix(tooling) — `run-task.md`'s worktree-base check replaced with exact-equality, not
  ancestry**: the documented `git merge-base --is-ancestor origin/preview HEAD` check (and an
  undocumented "sharper" ancestry variant used ad hoc this session) both give a false positive right
  after a `preview`→`main` promotion — a worktree wrongly based on `origin/main` still passes, since
  `origin/preview` is reachable from `main`'s tip via the promotion merge. Replaced with
  `[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/preview)" ]`, which can't be fooled the same way.
  See `DECISIONS.md` D-GH-2026-07-17-worktree-base-check-exact-equality.

- **2026-07-17 · docs(tooling) — synced `docs/SKILLS.md` with the sweep-tasks/add-task changes it had
  missed**: the Ambiguity-High cross-tool-migration rule, `/sweep-tasks`' cap-backfill and stricter
  `$ARGUMENTS` parsing, and a corrected `/code-review ultra` description (it can silently fall back to
  a local max-effort pass, not always a billed cloud review).

- **2026-07-17 · refactor(auth) — shared `onSessionChange(session)` helper for `js/auth.js`,
  migrated 4 of 5 call sites**: adds `onSessionChange`, a one-argument wrapper around
  `onAuthChange(event, session)` that structurally rules out the argument-order bug — CharGen's 3
  call sites and DM Console's 1 (both previously bitten by it) now use it. Live Sheet's single call
  site (also previously bitten) keeps the raw, order-dependent `onAuthChange` since it genuinely
  needs the event string for its `SIGNED_OUT` branch — that site is **not** structurally protected by
  this change, only documented against (see `DECISIONS.md`). Display/UI-only, no `js/engine.js`/
  `DATA` involvement, parity still 20/0.

- **2026-07-17 · fix(tooling) — 15 findings from a `/code-review ultra` pass on `/sweep-tasks`/
  `/add-task` fixed**: worktree-leak on park paths, TaskList entries left stuck `in_progress`, no
  cap-backfill on drop/park, undefined bumped-to-high review tier, undefined PR-number capture,
  unvalidated `$ARGUMENTS` batch-size parsing, unguarded direct pushes to `preview`, a diff-size-check/
  add-task-example contradiction, a missing cross-tool-migration Ambiguity callout, plus stale-doc
  fixes in `docs/TASK_BOARD.md` and `AGENTS.md` — see `DECISIONS.md`
  D-GH-2026-07-17-sweep-tasks-review-fixes for the full list.

## How to add an entry
Add at the TOP. Format:
`- **<date> · <type> — <headline>** (<proof: tests pass, files touched>). <what changed, condensed>.`
`<type>` ∈ `feature · rule · fix · data · UI · tooling · docs`. Note `DATA.version` only if it changed.

---
