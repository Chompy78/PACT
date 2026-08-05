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

## Merge concurrent character edits instead of refusing them — TODO
Branch `feat/character-log-merge`. The deep fix behind `fix/optimistic-character-save` (NOW), which only
*refuses* a stale write. Do that one first; this supersedes its behaviour rather than conflicting with it.

**Why this is the right end state for THIS data model.** A PACT character is not an opaque document — it
is an append-only event log (`{schema, rules, name, LOG, SEQ, id}`). Two people editing the same character
are usually appending different events, not overwriting the same field, so the "conflict" is an artefact
of storing the log inside a single `stats` JSONB blob and writing the blob whole. Reconcile the two logs
by `seq`/`ts` and most conflicts stop existing.

That is a genuinely better outcome than the NOW task's refusal: a DM adding a boon while the player buys a
skill should end with the character having both, not with one of them being told to reload and redo.

**What makes it non-trivial:**
- The merge has to happen client-side, before the write, because the server stores one blob. So both
  logs must be fetched, merged and pushed — with the guard from the NOW task still protecting the push.
- Event order matters for pricing. The engine replays in log order, and `_replay`'s creation-lock and
  per-purchase stamps depend on that order. Two logs interleaved by timestamp could price differently
  than either did alone. Check this against `repriceDraft()` and `_vigorRankTier` before trusting a merge.
- Singleton events (`name`, `award`, patch slots) do not append — they replace. A naive union would
  produce two `name` events, or double an award. These need per-type merge rules, not one rule.
- Genuinely conflicting edits still exist (both sides change species) and need a human answer.

**Effort:** high · **Risk:** high — ambiguity high (the per-event-type merge rules are a real design
problem, and the ordering interaction with pricing is subtle); damage scale high (sync layer, all three
tools, player data); damage likelihood high (untestable without a live signed-in session). Not
sweep-eligible. Wants a cold plan review before implementation.

```text
1. DO NOT START until fix/optimistic-character-save has landed - refusing a stale write is the safety
   net this builds on, and it stays as the fallback whenever a merge cannot be resolved automatically.
2. Classify every event type as append-mergeable or singleton-replace BEFORE writing merge code. The
   list is in js/engine.js's event documentation plus CharGen's PATCH_SLOTS.
3. Prove the ordering question with the fuzzer rather than by reasoning: merge two randomly generated
   logs, then assert the merged log still satisfies the invariants log-fuzz.mjs already checks
   (idempotent reprice, no NaN, ledger reconciles for a draft).
4. Anything that cannot be merged automatically falls back to the NOW task's refusal + reload, with the
   conflicting field named. Never guess between two human intentions.
5. engine-parity must stay at its current count; this is a sync-layer change and must not move compute().
```

**Done when:** two independent edits to the same character both survive a save, singleton events merge
correctly rather than duplicating, the fuzzer confirms merged logs satisfy the same invariants as
authored ones, and anything unmergeable still falls back to a clear refusal.

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

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

## Warn when compute() encounters a rules-table reference that no longer exists in DATA — TODO
Branch feat/warn-missing-data-refs. Several `compute()` lookups silently no-op when a character
references a racial trait/boon/drawback (and likely other categories) that's been removed or renamed
from `DATA` — confirmed sites: racial traits (`js/engine.js` ~L182, L189, `if(!r)continue`), boons
(~L372, `if(!bo)continue`), drawbacks (~L383, `||0` fallback). The character keeps the stale label in
its saved data, but gets zero cost/effect from it on recompute with no warning telling anyone why —
surfaced while discussing what happens if existing abilities get removed from the rules content.
**Effort:** medium · **Risk:** medium — ambiguity is medium (touch each lookup site individually vs.
centralize behind one shared helper is a contained, low-stakes call, not an architectural fork); damage
scale is medium (touches `compute()` directly across several lookup sites, but the change is purely
additive — new warning text only, no pricing/AP-total change — bounding the blast radius); damage
likelihood is medium (the parity gate does check warning text via its `legacy_warnings`/
`new_engine_warnings` columns, but REV-01's own follow-up note already flags a known fixture-coverage
gap for some `W.push` branches, so a new warning path isn't automatically exercised without a dedicated
fixture) — eligible for `/sweep-code-tasks`.

```text
1. Enumerate every DATA lookup in compute()/rebuildStateFromEvents() that silently skips or
   zero-prices an unrecognized reference — confirmed so far: racialTraits, boons, drawbacks; also
   check masteries, features, class/subclass references, spells/traditions, and feats for the same
   pattern (grep for similar `if(!X)continue` / `||0` guards against DATA lookups).
2. At each site, keep the existing skip/zero-fallback behavior unchanged (this task is additive, not a
   pricing/behavior change) and push a warning to W naming the specific missing reference, e.g. "⚠
   '<label>' is no longer in the rules data — no cost/effect applied." Reuse each site's existing
   W.push warning-string conventions (⛔/⚠ prefixes, label-splitting logic) rather than inventing a new
   format.
3. Decide once, up front, whether to centralize these lookups behind one shared helper (e.g. a
   `_lookupOrWarn(table, key, W)` function) or keep each site's existing ad hoc structure and just add
   one warning line to each — default to the latter (minimal, additive, lowest risk) unless the audit
   in step 1 finds it's clearly cleaner to centralize. Don't use this task to also refactor compute()'s
   overall structure — that's REV-14b's job, tracked separately.
4. Add at least one new fixture (or extend an existing one) in testing/fixtures/ + testing/expected/
   with a build referencing a racial trait/boon/drawback deliberately absent from the current DATA, so
   the new warning path gets real, permanent test coverage — closing exactly the kind of
   fixture-coverage gap REV-01's own follow-up note already flags for W.push branches.
5. This is additive/display-only for compute()'s numeric output (AP totals, pricing) — do NOT bump
   DATA.version; log in CHANGELOG.
```

**Done when:** every silent-skip DATA lookup in compute() found in the step-1 audit pushes a visible
warning naming the missing reference instead of silently doing nothing; at least one fixture exercises
this new warning path; `testing/tests/engine-parity.html` is still 20/0 for all pre-existing fixtures
(no numeric/pricing change), plus the new fixture passes with the expected warning text.

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
