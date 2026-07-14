# PACT — Roadmap

> Written for agentic assistants (VS Code Copilot & Claude Code). With `AGENTS.md` committed, you don't
> repeat project context — **paste one task at a time**, review the diff, accept. Each task ends with a
> **Done when** check.
>
> **Rules for this file** (see `AGENTS.md`):
> 1. Holds only **open / planned** work. When a task is DONE, **move it into `CHANGELOG.md`** in the same change.
> 2. **Single writer.** Agents: *output* new items in this format for the human to fold in — don't append directly.
> 3. One task per branch. The open git branch is the "in flight" signal.
>
> **`REV-NN` items** come from the 2026-06-29 code review. Full evidence, code, and acceptance criteria
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this roadmap so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.

---

# 🔴 NOW — high-severity fixes + cleanup

## Wire testing/scripts/audit.py into CI — TODO
Branch chore/wire-audit-py-into-ci. `audit.py`'s own docstring says its checks (SW cache integrity, manifest/PWA correctness, engine-symbol drift, and an `--rls` mode that live-proves RLS rejects unauthorized writes) should run "eventually in CI" — no workflow currently calls it, so a grant/RLS regression (a class DECISIONS.md notes this project has "been bitten twice by" already) or a broken SW cache list only gets caught if a human remembers to run it by hand.

```text
1. Add a step/job to .github/workflows/engine-parity.yml (or a new workflow) that runs testing/scripts/
   audit.py's default (non-`--rls`) checks on every push/PR — fail the build on any finding.
2. The `--rls` live-proof mode needs real Supabase credentials against a test project. Decide: (a) wire it
   into CI using a GitHub Actions secret for a dedicated test Supabase project, or (b) keep it manual-only
   for now. Either way, make the decision explicit in testing/README.md and in a comment on the CI job —
   the goal is that "not wired into CI" never again silently reads as "wired," which is how this gap went
   unnoticed.
3. No js/engine.js or DATA changes — parity gate itself is unaffected, should stay 20/0.
```

**Done when:** `audit.py`'s non-RLS checks run automatically in CI on every relevant PR and fail the build on findings; the `--rls` mode's CI status (wired with a test project, or intentionally manual) is explicitly documented in testing/README.md.

---

# 🟡 NEXT — medium-severity fixes + remaining build work

## Parity gate: assert warning codes/text, not just counts — TODO
Branch test/parity-warning-code-assertions. `testing/expected/expected-results.csv` currently asserts only `new_engine_warnings` as a **count** against each of the 20 fixtures, not which warnings actually fired — so a warning changing wording, firing for the wrong reason, or silently disappearing while another appears wouldn't fail the gate. This is the documented precondition REV-14 (splitting `compute()`'s ~371-line, 54-`W.push`-site body into named sub-pricers) is waiting on — this task is that precondition, not the split itself.

```text
1. Grep js/engine.js for its 54 `W.push(...)` call sites to enumerate the distinct warning
   codes/labels compute() can emit.
2. Extend testing/expected/expected-results.csv (or add a companion fixture file) to assert the actual
   warning codes/text produced for each of the 20 existing fixtures, not just the count.
3. Update testing/scripts/engine-parity-ci.mjs (and the browser test runner in
   testing/tests/engine-parity.html) to compare warning content, failing on a mismatch.
4. If several of the 54 warning sites aren't exercised by any existing fixture, note the coverage gap
   (don't feel obligated to add new fixtures to close it in this same task — file that as a follow-up if
   it's sizable).
5. Do NOT attempt to split compute() in this task — that's REV-14, gated on this landing first.

Test-only change — does not touch DATA.version or compute() output; parity must still be 20/0 against the
current (unmodified) engine.
```

**Done when:** the parity gate fails if a fixture's warning codes/text change, even when the count stays the same; testing/tests/engine-parity.html still passes 20/0 against the current engine.

---


## Feature: In-app user feedback widget (Supabase-backed) — TODO
Branch feat/feedback-widget. Add a small feedback form to all four player-facing pages — CharGen, Live Sheet, DM Console, and the Player's Guide — that saves free-text feedback to a new Supabase table, readable only via the Supabase dashboard (no in-app admin view in v1).

```text
1. New Supabase table `feedback`: id uuid pk default gen_random_uuid(), user_id uuid references profiles(id)
   on delete set null (nullable — anonymous/signed-out feedback is allowed), source text not null check
   (source in ('chargen','livesheet','dmconsole','guide')), message text not null check (length(message)
   between 1 and 2000), page_url text, created_at timestamptz not null default now(). New dated migration
   in sql/migrations/, mirrored into sql/schema.sql.

2. RLS: insert-only. Grant insert to both `anon` and `authenticated` (the guide and CharGen work
   signed-out) with a policy that just enforces the check constraints above — no select policy for either
   role. Feedback is read via the Supabase dashboard (service role), not through the app, so no admin
   UI/read path is needed for v1.

3. Add a small shared client helper (e.g. `js/feedback.js`) exporting `submitFeedback({source, message,
   pageUrl})`, reusing the existing `js/supabase-client.js` singleton — usable from a `<script
   type="module">` on any of the four pages.

4. UI: a small floating "Feedback" button in the corner of each page opening a minimal textarea + submit,
   with an inline success/error state. Feedback text is never rendered back into any page's DOM in v1 (no
   admin view reads it), so `esc()` is not required now — but the moment any in-app view displays stored
   feedback, that becomes mandatory per AGENTS.md's stored-XSS rule.

5. Note: `docs/PACT-Players-Guide.html` currently has ZERO existing module/Supabase wiring (unlike the
   three tools, which already import `supabase-client.js`) — it needs a fresh `<script type="module">`
   added, not just a call into existing bridge code. It's also ~657 KB — search for the closing `</body>`
   or an existing `<script>` tag rather than reading the file wholesale (see AGENTS.md).

6. After applying the migration, run the Supabase advisor and skim recent logs (per the per-change
   checklist — this touches SQL/RLS). Re-run testing/tests/engine-parity.html (unaffected — no
   js/engine.js change, should stay 20/0).

Display/process-only — does not touch js/engine.js or DATA.version; just log in CHANGELOG.
```

**Done when:** all four pages have a working feedback button that inserts a row into the new `feedback` table (signed-in and signed-out); RLS allows insert-only for `anon`/`authenticated` with no select path; parity still 20/0.

---

## Advancement-tracks follow-up: end-to-end browser verification — TODO
Branch test/advancement-tracks-e2e. Drive the advancement dials shipped in `feat/advancement-tracks` (PR #206) through a real browser with an AI/browser-automation tool, since they need Supabase auth + a live campaign the headless parity gate can't exercise.

```text
Depends on PR #206 (feat/advancement-tracks) being merged first. Using a browser-automation/AI tool
(signed in to a test Supabase account with a live campaign):
1. DM Console → Campaign Rules: confirm the three new controls (Level budget curve, Award pace, Starting
   tier) render, the L20 preview updates live, and preset<->field sync works (picking Generous sets
   83/+28; editing a number flips the preset to Custom).
2. Save rules -> reload -> confirm all three persist in campaigns.rules.
3. Change Starting tier -> confirm the player-invite "Starting budget" field pre-fills and stays editable.
4. As a player bound to that campaign, open Live Sheet -> confirm the header shows "≈ Track-Level N"
   derived from AP spent against the campaign's tuned curve; an unbound character falls back to Standard.
5. Check the browser console for errors at each step.
Fold the reproducible parts into the existing e2e harness (testing/scripts, character-gen-e2e.yml) if
practical. Display-only feature — no DATA.version/compute() involvement; parity still 20/0.
```

**Done when:** the DM-panel↔bound-player advancement-dials round-trip is verified working in a real browser (save/load/persist, invite pre-fill, Track-Level label), with any bugs found either fixed or filed.

---

## Tools: back-to-Home navigation + toolbar button cleanup — TODO
Branch feat/tools-home-nav-cleanup. Add a "← Home" link back to index.html in each tool's header (tools/PACT-CharGen-Webtool.html, tools/PACT-Live-Char-Sheet.html, tools/DM-Console.html), and audit/reduce each tool's header/toolbar button clutter in the same PR.

```text
1. Add a small "← Home" (or house-icon) link/button in each tool's header, pointing to `../index.html`
   (tools/ is one level below the repo root), styled consistently with each tool's existing masthead/header
   controls. Keep it unobtrusive — this is UI-only, no engine/rules involvement.

2. Audit each tool's header/toolbar for redundant or cluttered buttons and consolidate/remove where
   appropriate:
   - DM-Console.html `.topactions` (~line 351): "▦ Table view" / "📊 Skill Matrix" / "📒 AP Ledger" plus the
     `.tbtoolbar` "⚙ Columns ▾" button — check for overlap/redundant toggles.
   - PACT-Live-Char-Sheet.html `.bar`/`#lmobar` (~lines 339, 358): "🛠 DM tools ▾", undo/redo, and the mobile
     action bar — check for duplicated controls between desktop and mobile bars.
   - PACT-CharGen-Webtool.html — audit its own header/toolbar area for the same pattern.
   Only remove/merge buttons that are genuinely redundant or rarely used; do not remove functionality
   players/DMs rely on without an equivalent path still available (e.g. move a rare action into an existing
   menu instead of deleting it outright).

3. While in this UI, fix DM-Console.html's icon-only header/toolbar buttons (e.g. the `×` close buttons
   around DM-Console.html:1189 and :1320) — it currently has zero `aria-label` attributes across ~30
   buttons and relies only on `title=`, versus 12 in CharGen and 3 in Live Sheet. Add `aria-label` to every
   icon-only button touched by this task's button audit (doesn't need to be a separate full accessibility
   pass — just don't leave newly-consolidated/kept icon buttons unlabelled).

4. This is a UI-only change — do not touch js/engine.js, DATA, or compute() output.

5. Re-run testing/tests/engine-parity.html — should be unaffected, still 20/0.

Display-only — do NOT bump DATA.version; just log in CHANGELOG.
```

**Done when:** all three tools have a working link back to index.html from their header, each tool's header/toolbar has measurably fewer or better-consolidated buttons with no loss of reachable functionality, DM Console's icon-only buttons touched by this task carry `aria-label`s, and parity still 20/0.

---

## DM Console roster: migrate apLevel() off the fixed ladder onto the tuned levelBudgetCurve — TODO
Branch fix/dm-console-roster-tuned-curve. DM Console's campaign roster (tools/DM-Console.html:552 apLevel(), used at line 603) still computes each character's displayed level from the fixed DATA.levelAP ladder, even though DM Console is the one tool where a DM configures the per-campaign levelBudgetCurve.

```text
Surfaced by an independent /code-review of PR #210/#211 (D-GH-2026-07-14-livesheet-eco-track-level /
D-GH-2026-07-14-livesheet-eco-track-level-review-followups): those PRs unified Live Sheet's header
Track-Level and eco-line Earned-Lv onto the DM-tunable levelBudgetCurve, but DM Console's roster was out of
scope for both (single-file tasks). A DM who tunes their campaign's curve away from Standard sees their own
roster (fixed ladder) disagree with what that same character's Live Sheet correctly shows.

Decide and implement: migrate DM Console's roster apLevel(eco.earned) call to use Live Sheet's
_levelCurve()/trackLevel() pair (would need extracting them to a shared location, since they currently live
only in tools/PACT-Live-Char-Sheet.html), or a DM-Console-local equivalent reading DATA.levelBudgetCurves via
the same resolveRules()-style path. Display-only — do NOT bump DATA.version; log in CHANGELOG, and in
DECISIONS.md if the shared-vs-local approach involves a non-obvious trade-off.
```

**Done when:** DM Console's roster level display reads the campaign's tuned `levelBudgetCurve` (not the fixed `DATA.levelAP` ladder) when one is configured, consistent with Live Sheet; parity still 20/0.

---

## Consolidate the 4 duplicated "AP vs threshold table → level" lookups across tools — TODO
Branch chore/unify-level-lookup-helper. The same loop shape (find highest level L whose per-level threshold <= a value) now exists independently in tools/PACT-Live-Char-Sheet.html (_levelCurve()/trackLevel(), reading the DM-tunable levelBudgetCurve), tools/DM-Console.html:552 (apLevel(), fixed DATA.levelAP ladder), and tools/PACT-CharGen-Webtool.html:880 (apLevel(), same fixed ladder) — none in js/engine.js.

```text
Surfaced by an independent /code-review of PR #210/#211 as pre-existing debt, not previously tracked by any
roadmap item.

Decide: should a shared helper live in js/engine.js (display-only, so arguably not "rules logic" under
AGENTS.md's rule, but a reasonable case either way), or a new small shared js/ module, parameterized by
threshold source (fixed ladder vs. tuned curve)? Then migrate all 3-4 call sites onto it. Note CharGen's
apLevel() usages may be a legitimately distinct concept (fixed creation-budget tiering, not campaign-tunable
advancement pace) — confirm before merging that call site into the same helper as the other two.
```

**Done when:** the level-lookup loop exists in exactly one place (shared helper), all prior call sites migrated with no behavior change for the fixed-ladder cases; parity still 20/0.

---

# ⚪ LATER — low-severity fixes + ideas (not scheduled)

## Service-worker caching: decide whether auth/sync/campaign/dm modules stay cache-first — TODO
Branch chore/sw-network-first-security-modules. `service-worker.js`'s `NETWORK_FIRST_RE` currently covers only `.html`, the root, and `js/engine.js` — documented as network-first "so deployed fixes reach returning users immediately." `js/auth.js`, `js/supabase-client.js`, `js/sync.js`, `js/campaign.js`, `js/dm.js` are pre-cached and fall into the cache-first branch, so a client-side fix to one of them doesn't reach a returning offline-capable user until the SW updates *and* they reload twice.

```text
1. Review service-worker.js's NETWORK_FIRST_RE (~lines 9-26) and its stated rationale for singling out
   js/engine.js.
2. Decide: (a) widen the regex to include auth/sync/campaign/dm.js so client-side fixes to them propagate
   as fast as engine.js fixes do, or (b) leave them cache-first — since RLS is server-authoritative, a
   stale auth/sync client isn't itself a security hole — and just make that reasoning explicit instead of
   leaving it an unstated inconsistency.
3. If widening, weigh the added network dependency: these modules currently work fully offline via
   cache-first; moving them to network-first trades that off against faster fix propagation.
4. No engine.js/DATA involvement — parity unaffected, should stay 20/0.

Low priority — not urgent, since RLS already enforces this server-side regardless of which caching
strategy wins. Log the decision as D-GH-<date>-sw-network-first-security-modules either way, since "why
engine.js is special-cased but these aren't" isn't obvious from the code alone.
```

**Done when:** either NETWORK_FIRST_RE is widened to cover auth/sync/campaign/dm.js, or a DECISIONS.md entry explicitly states why they're intentionally left cache-first; parity still 20/0.

---

## Engine review cleanup: drawback buyoff IDs, signature guard, baseBuild dedupe, noLock scoping — TODO
Branch chore/engine-review-cleanup. Four small, low-risk js/engine.js hardening/cleanup items surfaced by
the 2026-07-14 engine.js review (see session discussion); bundled as one low-risk batch per AGENTS.md's
"quick" bundling allowance — each item still gets its own commit and CHANGELOG line.

```text
1. Drawback buyoff matches by label, not a stable ID. `activeEvents()`/`_replay()` key `boughtOff` off
   `e.refVal` against the drawback's own label string (`e.payload.v`) — a renamed or duplicate-labeled
   drawback can mis-associate a buyoff. Give each `buy` (drawback) event a stable id at creation and have
   `buyoff` events carry `refEventId` instead of `refVal`; keep label-matching as a fallback for legacy
   logs with no id. This touches how Live Sheet (and CharGen's `_lsImportFold`/`buildToLiveLog` import
   path, per D-GH3) construct these events, not just engine.js — check CharGen's embedded import-fold
   copy emits/consumes the new field too, since it's a separate hand-copied path (see AGENTS.md
   high-risk-files note). Best done after Task 6, or update CharGen's embedded copy in the same PR.

2. `verifyPayload()`'s docstring claims "Never throws," but `_canonicalJSON()` recurses with no cycle
   guard — a circular in-memory object (not a JSON-parsed one, where cycles can't occur) would stack
   overflow uncaught. Wrap the top-level call in try/catch and return a defined error status (e.g.
   `{signed:true, valid:false, status:'error'}`) on exception, so the "never throws" contract is actually
   true regardless of input shape.

3. `baseBuild()`'s object literal declares `lineage:'', racialSpells:[]` twice (harmless — the later
   assignment silently wins). Remove the duplicate.

4. `noLock:true` in `_replay()` is currently scoped only by a comment (intended for CharGen's one-shot
   import burst) — nothing structurally prevents any `buy`/`buyoff`/`names` event from setting it and
   permanently dodging the creationLocked auto-trigger threshold. Add a structural constraint (e.g. only
   honor `noLock` for events before any real spend/finalize event in the log) or at minimum rename the
   field to make its narrow intended scope unambiguous (e.g. `importBurst`), and note the decision either
   way in DECISIONS.md.

If any of these changes alters compute() output for an existing fixture (most likely item 4, if it
changes when a build is considered creation-locked), bump DATA.version and update testing/expected/ in
the same PR; items 1–3 are expected to be output-neutral. Log a decision as
D-GH-<date>-engine-review-cleanup if item 1 or 4 changes real behavior (not just internal naming).
```

**Done when:** drawback buyoffs resolve by a stable event reference (with legacy label fallback), `verifyPayload()` cannot throw on any input, `baseBuild()`'s duplicate fields are removed, `noLock`'s scope is structurally constrained or renamed to make misuse unambiguous, and `testing/tests/engine-parity.html` is still 20/0.

---

**Low-severity review findings:**
- **REV-14** — (optional, engine-targeted) Extract `DATA` into `engine-data.json`; split `compute()` into
  named sub-pricers. Only safe once REV-01 gives real assertions; dedicated PR, byte-identical output.

**Polish & hardening** (from the Task 5 audit session):
- **Real icons** — replace the placeholder 192/512/180 PNGs with real artwork (needs your art).

**Landing-page follow-ups** (deferred from the redesign):
- Extend theming to the guide and tools (index-only today).
- "Continue / recent characters" on the landing page (needs the tools' save format).
- iOS "Add to Home Screen" hint (no `beforeinstallprompt` on iOS Safari).

**Supporting reference tasks** (run when needed):
- Supabase project setup · Icon & asset list (192/512/180) · Offline UX spec · Future-features roadmap.

**Improvements** (recommended action first; the *then* line is a lower-priority upgrade with its caveat):
- **A1 — Engine API contract.** *(base shipped 2026-07-13)* Full JSDoc contract now sits atop `js/engine.js`.
  *Remaining (optional):* a dev-only `engine.d.ts` for IDE autocomplete — *caveat:* a new format to maintain;
  can read as "TypeScript creeping in."
- **A3 — Client error visibility.** *(base shipped 2026-07-13)* Global `error`/`unhandledrejection` surface +
  Report-issue link now on all pages. *Remaining (lower priority):* log errors to a Supabase table once
  sign-in is the default — *caveats:* extra write traffic + a privacy note to document.
- **A6 — Tag releases to the build version.** `git tag v0.x` (matching `BUILD`) + a GitHub Release per
  ship, for a labelled rollback point. *Then (lighter alternative):* tags only, no notes — *caveat:* less
  context on what each release shipped.
- **A7 — Lighthouse 85 → 90.** Add a Lighthouse CI GitHub Action to auto-catch perf regressions. *Then
  (lower priority, higher risk):* split/lazy-load the engine (= REV-14) for the real score gain —
  *caveats:* a big engine change; do it only after REV-01 makes the gate real.
- **Harden `search_path` on SECURITY DEFINER functions against temp-table shadowing.** Every SECURITY
  DEFINER function in `sql/schema.sql`/`sql/rls-policies.sql` (11+ instances, pre-existing) sets
  `search_path = public` without also listing `pg_temp`, which doesn't fully close the classic
  session-local-temp-table-shadowing pitfall. Low real-world exploitability today (Supabase/PostgREST
  clients have no raw-SQL/DDL path), but worth closing repo-wide rather than piecemeal — a partial fix
  across only some functions would be worse than no fix. Change every `set search_path = public` to
  `set search_path = public, pg_temp` consistently; new dated migration; re-run
  `testing/tests/engine-parity.html` (20/0) and the Supabase advisor. Found during `/code-review` on
  PR #203. Branch `fix/harden-search-path-pg-temp`.
- **General engine maintainability (from the 2026-07-14 review).** `compute()` does normalization,
  pricing, validation, and warning-generation all in one ~350-line function — biggest source of risk when
  editing it. `MUT.patch` (`Object.assign(b, p.patch)`) can write arbitrary build fields and is named like
  an ordinary mutator despite being import-only — consider renaming (e.g. `importPatch`) and/or
  restricting its allowed fields. No fix scheduled; noted for whoever next does a larger engine refactor.
**Code-review follow-ups (from `feat/campaign-ap-model`)** — low-severity cleanup flagged by
`/code-review`, not fixed in that PR (low risk / negligible impact either way):

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
