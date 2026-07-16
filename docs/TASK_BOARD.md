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

## Shared onAuthChange(event, session) wrapper — stop the recurring argument-order bug — TODO
Branch refactor/shared-auth-change-helper. Factor the hand-copied onAuthChange(event, session) closure
each tool writes independently into one shared helper, since the same argument-order bug has now been
found and fixed 3 separate times at different call sites.

```text
js/auth.js's onAuthChange(cb) calls cb(event, session) — session is the 2nd argument, not the 1st. Every
call site across the three tools re-derives this by hand with its own inline function(event, session){...}
closure: tools/PACT-Live-Char-Sheet.html:1576, tools/PACT-CharGen-Webtool.html:573/746/848, and
tools/DM-Console.html:~1657 (fixed in PR #233 after the exact same bug — binding session to the event
string instead — was already independently found and fixed in Live Sheet and CharGen at earlier points).
Nothing structurally prevents a 5th recurrence: no shared wrapper, no lint rule, no JSDoc enforcement
beyond a comment at each existing site.

1. Add a shared helper to js/auth.js (or js/ui-helpers.js, matching where esc()/flash()/_csCopy() already
   live per D-GH-2026-07-14-shared-ui-helpers) — e.g. onSessionChange(cb) that wraps onAuthChange and
   calls cb(session) directly, so callers can't get the argument order wrong. Keep onAuthChange(cb) itself
   exported unchanged for any call site that genuinely needs the raw event string (e.g. Live Sheet's
   SIGNED_OUT-specific reset, CharGen's sign-in-transition invite redemption) — those can layer their own
   event-based logic on top of the same underlying subscription, or the new helper can optionally forward
   event too (design call, not prescribed here).
2. Migrate all 5 existing call sites (Live Sheet, CharGen x3, DM Console) to the shared helper. Each site's
   existing sign-in-transition/wasSignedIn-style guards should carry over unchanged in behavior — this is a
   refactor, not a behavior change.
3. Verify each tool's own auth-driven UI still updates correctly on sign-in, sign-out, and (if testable)
   a token-refresh event, since this is display/UI wiring that engine-parity.html doesn't cover.
4. Display/UI-only — no engine.js/DATA involvement, parity stays 20/0.

Found via /code-review on PR #233 (test/advancement-tracks-e2e) — see DECISIONS.md
D-GH-2026-07-16-advancement-tracks-e2e for the fix history this consolidates. Log this task's own decision
as D-GH-<date>-shared-auth-change-helper if the design choice in step 1 (wrap vs. replace onAuthChange)
isn't obvious from the diff alone.
```

**Done when:** one shared helper exists for the (event, session)-unwrapping pattern, all 5 existing call sites use it instead of their own hand-copied closure, each tool's sign-in/sign-out UI still behaves identically, and testing/tests/engine-parity.html is still 20/0.

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
