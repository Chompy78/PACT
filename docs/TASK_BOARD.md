# PACT — Task Board

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
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this task board so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.

---

# 🔴 NOW — high-severity fixes + cleanup

---

# 🟡 NEXT — medium-severity fixes + remaining build work

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

## Rename docs/TASK_BOARD.md + DECISIONS.md to a new naming convention — TODO
Branch docs/rename-roadmap-decisions-files. Rename the two core process files per a naming convention the user will specify at implementation time, then sweep every reference across the repo so no skill or doc points at a stale path.

```text
1. BLOCKED on the user supplying the exact target filenames for docs/TASK_BOARD.md and DECISIONS.md
   before any renaming starts — do not guess. Confirm both names explicitly at the start of this task.

2. High blast radius — both files are hard-referenced by name (not just linked) in:
   - AGENTS.md itself (roadmap bucket rules, "Multiple sessions" single-writer note, D-GH numbering
     section, per-change checklist)
   - Every skill in .claude/commands/: add-roadmap-task.md, pick-task.md, run-task.md, close-session.md,
     plan-for-review.md, cleanup-branches.md, log-ai-lessons.md — several read/write TASK_BOARD.md or
     DECISIONS.md as their literal file target, not just mention them
   - docs/SKILLS.md, docs/HOW-TO-WORK.md, CHANGELOG.md, docs/roadmap.html's footer, docs/sessions/*.md
   Grep the whole repo for both exact filenames before touching anything, and treat the count as the
   real scope of this task, not just two `git mv` calls.

3. Given the risk of a missed reference silently breaking a skill's read/write path (e.g.
   /pick-task or /add-roadmap-task pointing at a file that no longer exists), do this as a cold
   plan review first (/plan-for-review) rather than a live edit sweep — per AGENTS.md's own trigger for
   "a wrong approach would cost more than one implementation cycle to undo."

4. Use `git mv` (not delete+recreate) so history is preserved, then update every reference found in step 2
   to the new path/name in the same PR — no file should end up referencing the old name except historical
   CHANGELOG.md/docs/sessions/ entries (records of what happened at the time, not live links).

5. Docs/process-only — no js/engine.js, DATA, or compute() involvement; parity gate itself is unaffected.
   Log the rename itself as D-GH-<date>-rename-roadmap-decisions-files in the (renamed) decision log,
   since "why these got renamed" won't be obvious from the diff alone.
```

**Done when:** docs/TASK_BOARD.md and DECISIONS.md exist under their new agreed names with history preserved via `git mv`; every skill/doc reference across the repo points at the new paths (verified by a repo-wide grep for the old names returning only historical CHANGELOG/session-log mentions); testing/tests/engine-parity.html still 20/0.

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
