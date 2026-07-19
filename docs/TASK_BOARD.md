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

## Port the AGENTS.md/skills scaffold to another repo — TODO
Branch docs/port-agents-scaffold-skill. Generalize this session's manual copy-and-adapt work (porting
AGENTS.md + .claude/commands/ + hooks to chompy78/petdetective and chompy78/homelife — see
docs/sessions/2026-07-17-port-agents-scaffold-to-petdetective-homelife.md) into a repeatable PACT skill,
so a future "bring this workflow to repo X" request doesn't redo the analysis from scratch.
**Effort:** high · **Risk:** high — ambiguity is high (how prescriptive vs. flexible the skill should be —
auto-detect target conventions vs. always ask, how much to generalize vs. leave as human judgment — is a
genuine design call with no single obviously-right answer, the same way this session had to improvise two
different adaptations for two differently-shaped repos); damage scale is low (only touches
.claude/commands/ in whichever repo it's run against, and per this session's established practice should
always draft-then-show-for-approval before writing to a foreign repo, so a bad output is caught before
landing); damage likelihood is medium (nothing automated gates a skill's own prompt content — a flawed
skill design only surfaces the next time someone actually runs it against a real target repo) — worst-of
lands at high on ambiguity alone, so never eligible for /sweep-code-tasks; recommend `/make-code-cold-plan-review` before
implementation given the design-call nature.

```text
1. Read this session's session note (docs/sessions/2026-07-17-port-agents-scaffold-to-petdetective-homelife.md)
   and the two target repos' actual results (chompy78/petdetective's docs/agent-scaffold branch/PR #4,
   chompy78/homelife's commit ede0496) as the worked examples to generalize from.

2. Design a new skill, e.g. `.claude/commands/port-agents-scaffold.md`, that:
   - Takes a target repo as its argument.
   - Reads the target's actual current state first — does it already have AGENTS.md/CHANGELOG.md/
     DECISIONS.md/a task board? Does it have a test suite/CI? What's its branch model (single branch vs.
     branch-per-task, main vs. some other default)?
   - Branches its own behavior on what it finds: a blank-slate target gets the full scaffold built fresh
     (per the petdetective pattern); a target with existing mature governance docs gets only the missing
     pieces added, with small additive notes in the existing docs rather than any rewrite (per the
     homelife pattern).
   - **Explicitly handles the main-only case:** if the target's own stated or observed convention is
     commit-and-push-straight-to-main (no feature-branch workflow), the ported pick-code-task/run-code-task/
     sweep-code-tasks/cleanup-code-branches skills must drop all worktree/branch/PR machinery and work directly
     against that branch instead — never introduce branches/PRs into a repo whose established convention
     is branch-less, even for consistency with PACT's own model.
   - Always drafts the adapted files and shows them (or a summary) for approval before writing/committing/
     pushing anything to the target repo — same draft-before-write discipline `/add-code-task`,
     `/log-code-lesson`, and `/make-code-cold-plan-review` already use.
   - Pauses before pushing to the target repo if that repo has no PR gate (a direct push to its main
     branch may trigger an immediate live deploy, as it did for homelife) — flag this explicitly rather
     than pushing straight through.

3. Update `docs/SKILLS.md` to document the new skill alongside the existing eight.
```

**Done when:** the new skill exists, is documented in `docs/SKILLS.md`, and has been dry-run (or actually
run) against at least one real target repo of each shape (a blank-slate repo and a repo with existing,
possibly-conflicting governance docs) with correct behavior in both cases.

## REV-14b — split js/engine.js's compute() into named sub-pricers — TODO
Branch refactor/rev-14b-compute-subpricers. Second half of REV-14 (REV-14a — the DATA extraction — shipped
in PR #251); decompose compute()'s single ~370-line body (~lines 76–446) into named `_price*` helpers. Full
plan already drafted at docs/plans/2026-07-17-engine-breakup-rev14.md.
**Effort:** high · **Risk:** high — ambiguity is high (decomposing a stateful pricing algorithm while
guaranteeing byte-identical output is a genuine architectural call); damage scale is high (edits compute()
directly — the engine's single source of truth); damage likelihood is medium (the parity gate catches
numeric/ledger drift, but REV-01's known warning-text fixture-coverage gap means some W.push branches are
unverified) — worst-of lands at high, never eligible for /sweep-code-tasks.

```text
1. Pre-flight (no code change): produce a data-flow map of which compute() locals each commented section
   reads vs writes (total, L, W, mod, effScore, the add() closure, any first-occurrence/suppression state),
   and confirm the exact line span of the _raceTraitLocked creation-lock logic so extraction-by-comment-
   boundary can't split it.
2. Extract each commented section into a named _price* helper taking ONE SHARED MUTABLE CONTEXT
   ({total, L, W, mod, effScore, add, …}) and mutating it exactly as the inline code did — NOT return-and-
   merge (which forces hidden inter-section dependencies to be made explicit and is where silent drift
   creeps in). Preserve L (ledger) and W (warnings) push order exactly.
3. Extract one section per commit; run engine-parity after each so any regression is bisectable. compute()
   ends as setup + a fixed ordered sequence of _price* calls + return assembly, same signature/return shape.
4. Verify byte-identical output: hash the full compute() return (totals + ledger L + warnings W) for every
   fixture before vs after; list any W.push branch no fixture reaches. This is a BEHAVIOUR-PRESERVING engine
   change — do NOT bump DATA.version (output must be identical); just log in CHANGELOG.
```

**Done when:** compute() is a dispatcher over named `_price*` helpers (shared-context design), unchanged
signature/return shape; full-payload output identical across all fixtures; engine-parity still 20/0.

## Harden close-code-session's session-note write against implicit pausing — TODO
Branch docs/close-code-session-note-no-pause. Part 1's session-note step already says "write one if any
of these are true" (no stated confirmation gate — that's Part 3, the commit) but doesn't explicitly rule
out an agent presenting its criteria evaluation as a question and waiting for a reply before writing.
Add one explicit sentence closing that gap.
**Effort:** low · **Risk:** medium — ambiguity is low (one clear wording addition, easily checkable by
re-reading the result) and damage scale is low (single skill file, git-revertable, no data/security
implication), but damage likelihood is medium (no automated check verifies an agent parses a skill's own
instructions correctly — a wrong wording would only surface on the next /close-code-session run).

```text
1. In .claude/commands/close-code-session.md, in Part 1, item 3 (the docs/sessions/<date>-<topic>.md
   step), add a sentence directly after "write one if any of these are true, otherwise skip it and say
   so:" making explicit: once the criteria are evaluated, write the file immediately — do not phrase the
   evaluation as a question, and do not pause for a reply before writing. (Item 3 already instructs
   writing directly, same as items 1-2 (CHANGELOG.md/DECISIONS.md); this closes the gap where an agent
   might treat "here's my reasoning" as an implicit request for permission.)
2. Docs-only; no code/rules change.
```

**Done when:** close-code-session.md's Part 1 item 3 explicitly states the write happens immediately upon
meeting its criteria, with no pause for a reply.

---

# ⚪ LATER — low-severity fixes + ideas (not scheduled)

---

## Engine review cleanup: drawback buyoff IDs, signature guard, baseBuild dedupe, noLock scoping — TODO
Branch chore/engine-review-cleanup. Four small, low-risk js/engine.js hardening/cleanup items surfaced by
the 2026-07-14 engine.js review (see session discussion); bundled as one low-risk batch per AGENTS.md's
"quick" bundling allowance — each item still gets its own commit and CHANGELOG line.
**Effort:** medium · **Risk:** high — ambiguity is high on item 4 (noLock scoping is explicitly framed
as a real design call between a structural fix and a rename-only, with possible compute()/DATA.version
impact); damage scale is also high (touches js/engine.js directly, item 1 also touches CharGen's
separate hand-copied import-fold path); worst-of across the bundled 4 items lands the whole task at
high regardless of how contained items 2-3 are alone — never eligible for /sweep-code-tasks.

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
  **Effort:** high · **Risk:** high — damage scale is high (edits `compute()` directly, the engine's
  single source of pricing truth) and damage likelihood is medium (the parity gate exists but has a
  known fixture-coverage gap on some warning-text paths, per REV-01's own follow-up note) — worst-of
  lands at high regardless of the decomposition's own ambiguity being only medium.

**Polish & hardening** (from the Task 5 audit session):
- **Real icons** — replace the placeholder 192/512/180 PNGs with real artwork (needs your art).
  **Effort:** low · **Risk:** low — a static-asset swap, one obviously-right way to do it, instantly and
  visually verifiable, no code/logic touched. (Blocked on human-supplied artwork, not on classification.)

**Supporting reference tasks** (run when needed, intentionally untagged — too undefined in scope to
rate Effort/Risk meaningfully until one is actually picked up and scoped):
- Supabase project setup · Icon & asset list (192/512/180) · Offline UX spec · Future-features roadmap.

**Improvements** (recommended action first; the *then* line is a lower-priority upgrade with its caveat):
- **A1 — Engine API contract.** *(base shipped 2026-07-13)* Full JSDoc contract now sits atop `js/engine.js`.
  *Remaining (optional):* a dev-only `engine.d.ts` for IDE autocomplete — *caveat:* a new format to maintain;
  can read as "TypeScript creeping in." **Effort:** medium · **Risk:** medium — ambiguity is medium (a
  real but low-stakes call: auto-generate vs. hand-maintain, and whether to add it at all given the
  caveat above); damage scale is low (dev-tooling only, no runtime impact); damage likelihood is low (a
  wrong `.d.ts` only misleads an IDE, immediately visible to whoever hits it).
- **A3 — Client error visibility.** *(base shipped 2026-07-13)* Global `error`/`unhandledrejection` surface +
  Report-issue link now on all pages. *Remaining (lower priority):* log errors to a Supabase table once
  sign-in is the default — *caveats:* extra write traffic + a privacy note to document. **Effort:**
  medium · **Risk:** high — ambiguity is medium (schema/sampling/PII-scrubbing decisions, but bounded);
  damage scale is high (a new live-data table + RLS policy is a security/trust-boundary change, the
  same class as the feedback-widget's anon-write table decision, D-GH-2026-07-15-feedback-widget);
  damage likelihood is medium (the per-change checklist's Supabase-advisor check is a real gate, but a
  manual one, not CI-enforced) — worst-of driven by damage scale.
- **A6 — Tag releases to the build version.** `git tag v0.x` (matching `BUILD`) + a GitHub Release per
  ship, for a labelled rollback point. *Then (lighter alternative):* tags only, no notes — *caveat:* less
  context on what each release shipped. *(base shipped 2026-07-17 — v0.107 tagged with a GitHub Release;
  not yet marked done/graduated here — flag for a human to confirm and move to CHANGELOG.md.)*
- **A7 — Lighthouse 85 → 90.** *(base shipped 2026-07-16)* Lighthouse CI now runs on every PR
  touching `index.html`/assets (D-GH-2026-07-16-lighthouse-ci), gated on a measured baseline
  (perf 100, a11y 98-100, best-practices 96, seo 100), so regressions auto-catch going forward.
  *Remaining (lower priority, higher risk):* split/lazy-load the engine (= REV-14) for a further
  score gain — *caveat:* a big engine change; do it only after REV-01 makes the gate real. **Effort:**
  high · **Risk:** high — ambiguity is high (an architectural engine-loading change with real
  trade-offs, no single obviously-right split); damage scale is high (touches `js/engine.js` directly);
  damage likelihood is medium (the parity gate runs in Node, so an async-loading-order bug specific to
  the browser might not be caught by it) — worst-of high, driven by ambiguity and damage scale both.
- **General engine maintainability (from the 2026-07-14 review).** `compute()` does normalization,
  pricing, validation, and warning-generation all in one ~350-line function — biggest source of risk when
  editing it (see REV-14 above for its own Effort/Risk — this is the same underlying work, not a second
  task). `MUT.patch` (`Object.assign(b, p.patch)`) can write arbitrary build fields and is named like
  an ordinary mutator despite being import-only — consider renaming (e.g. `importPatch`) and/or
  restricting its allowed fields. **Effort:** medium · **Risk:** high — ambiguity is medium (rename-only
  vs. rename-plus-field-restriction is a low-stakes call once the import contract is understood); damage
  scale is high (touches `js/engine.js`'s public `MUT` export, which CharGen's separate hand-copied
  import-fold path also depends on per AGENTS.md's high-risk-files note); damage likelihood is medium
  (the parity gate covers the bridged `MUT` usage in all three tools, but CharGen's import-fold closure
  is a separate hand-copied path the bridged fixtures don't fully exercise) — worst-of driven by damage
  scale. No fix scheduled; noted for whoever next does a larger engine refactor.
**Code-review follow-ups (from `feat/campaign-ap-model`)** — low-severity cleanup flagged by
`/code-review`, not fixed in that PR (low risk / negligible impact either way); heading currently empty,
nothing to tag:

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
