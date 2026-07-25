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

## Prevent Supabase free-tier auto-pause (keep-alive or paid upgrade) — TODO
Branch chore/supabase-keep-alive. The PACT Supabase project auto-paused from inactivity today (2026-07-25),
which silently broke login/register app-wide with "Failed to fetch" until manually restored via
`mcp__Supabase__restore_project` — evaluate and implement a fix so this doesn't recur, especially before
PACT has real users relying on cloud sync/DM campaigns.
**Effort:** medium · **Risk:** medium — ambiguity is medium (scheduled keep-alive ping vs. paid-tier
upgrade is a real but low-stakes call, not architectural); damage scale is low (a new CI workflow file
only, easily reverted, no engine/app code touched, uses only the already-committed anon key); damage
likelihood is low (worst case on failure is a return to today's status quo, not a new/worse failure
mode) — eligible for `/sweep-code-tasks`.

```text
1. Evaluate two options and pick one (or recommend the paid-tier one to the user as a billing decision
   they must approve, since it's a recurring cost):
   a. A scheduled GitHub Actions workflow (e.g. .github/workflows/supabase-keepalive.yml) that pings the
      Supabase project on a cron cadence tighter than the free-tier auto-pause window (~7 days of
      inactivity) — e.g. every 3 days, a lightweight authenticated request using only the already-committed
      publishable/anon key (js/supabase-client.js's SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY). This is CI/ops
      tooling, not app backend code, so it doesn't conflict with the "GitHub Pages only, no custom backend"
      rule (same class as the existing Lighthouse CI workflow).
   b. Upgrade the Supabase project to a paid tier, which removes auto-pause entirely — flag this to the
      user explicitly rather than deciding unilaterally, since it's a recurring cost only they can approve.
2. Default to (a) unless the user explicitly opts into (b). If implementing (a), verify the workflow
   actually prevents pausing (check project status stays ACTIVE_HEALTHY across a full off-cadence window)
   before considering this done.
3. Log the decision (workflow vs. paid-tier, and why) as D-GH-<date>-supabase-keep-alive in DECISIONS.md.
```

**Done when:** a scheduled keep-alive workflow is running and has been confirmed to keep the Supabase
project's status `ACTIVE_HEALTHY` across at least one full auto-pause window (or, if the user chose the
paid-tier path instead, the project has been upgraded and auto-pause confirmed disabled), and the decision
is logged in DECISIONS.md.

## Consistent, obvious sign-in indicator across the three tools — TODO
Branch feat/signin-indicator-consistency. The three tools each show cloud sign-in state differently — DM
Console (`tools/DM-Console.html`) shows the user's email or "Not signed in" plus a Sign in/Sign out button
in the top bar (`#campWho`/`#campSignInBtn`); Live Sheet (`tools/PACT-Live-Char-Sheet.html`) shows a
`#cloudStatusBadge` reading "🔒 Not signed in" with no equivalent "signed in" text shown in the same spot;
CharGen (`tools/PACT-CharGen-Webtool.html`) shows one of three different strings via `renderStatus()`
("🔒 Local only — not connected to any cloud campaign" / "☁ Signed in — no campaign selected" / "☁
Campaign: <name>"). Different wording, different icons, different prominence — a user checking whether
they're signed in has to relearn the pattern per tool (surfaced when a user went looking for it in DM
Console).
**Effort:** medium · **Risk:** medium — ambiguity is medium (the exact shared wording/icon/placement
convention is a real but low-stakes UI call, not architectural — each tool stays a standalone file per the
"no framework/no shared bridge for UI" architecture, so this is a copy/consistency pass, not a merge);
damage scale is low (isolated text/icon/CSS changes, one contained edit per tool, trivially revertible, no
data/security/engine impact); damage likelihood is medium (no automated gate catches copy/consistency
drift — only manual/visual review would) — eligible for `/sweep-code-tasks`.

```text
1. Decide one shared convention (document it briefly in the PR description or a DECISIONS.md entry) for:
   - Icon: 🔒 for signed-out / ☁ for signed-in (already the majority pattern across the three tools).
   - Wording pattern: something like "🔒 Not signed in" (signed out) vs "☁ Signed in as <email>" or
     "☁ Signed in — <campaign/context>" (signed in) — pick one template and apply it consistently.
   - Placement/prominence: keep each tool's existing location (top bar), but make sure the signed-in
     state is at least as visually prominent as DM Console's current email+button treatment — Live
     Sheet and CharGen currently only show a subtle badge, easy to miss.
2. Apply the convention in each tool's own status-rendering code:
   - DM Console: `updateAuth(session)` (~line 1509) — already closest to the target pattern, adjust
     wording only if needed for consistency.
   - Live Sheet: `#cloudStatusBadge` update logic (~line 1561) — add a clear "signed in" state to match,
     not just the "Not signed in" case.
   - CharGen: `renderStatus()` (~line 531) — align wording/icon with the shared convention.
3. This is UI text/CSS only — no engine.js, no compute() involvement. Display-only, do NOT bump
   DATA.version; log in CHANGELOG.
4. Verify in a real browser (per AGENTS.md's UI-testing expectation) in both signed-in and signed-out
   states, and in both light and dark theme where each tool supports it.
```

**Done when:** all three tools use the same icon + wording template for signed-in vs signed-out state,
the signed-in state is clearly visible (not just a subtle badge) in every tool, and this has been visually
verified in a real browser in both auth states.

## Wire up joinAsDm() — co-DM invite codes currently can't be redeemed anywhere — TODO
Branch feat/join-as-dm-ui. `js/campaign.js` exports `joinAsDm(code)` (a SECURITY DEFINER RPC, already
correctly gated server-side) but no tool calls it — DM Console generates and lets you copy a campaign's
"DMs" invite code, but there's no UI anywhere to redeem it and actually become a co-DM. Found while adding
an info tooltip to the Players/DMs codes (2026-07-25); same class of gap `createCampaign()` had before
this session (confirmed dead via `grep -rln "joinAsDm" tools/*.html login.html` → zero matches).
**Effort:** medium · **Risk:** medium — ambiguity is low (CharGen's existing "Join campaign" flow —
`cgJoinCode`/`onJoinCampaignClick` calling `joinCampaign()` — is a near-exact pattern to mirror for
`joinAsDm()`, just in DM Console instead); damage scale is low (new, additive UI + one already-gated RPC
call, isolated and reversible); damage likelihood is medium (no automated gate for this UI flow, only
manual verification) — eligible for `/sweep-code-tasks`.

```text
1. Add `joinAsDm` to DM Console's campaign.js import list and window._campBridge (tools/DM-Console.html
   ~line 1290/1294, alongside this session's createCampaign/archiveCampaign/unarchiveCampaign additions).
2. Add a "Join as co-DM" input + button to DM Console's Campaign panel (mirrors CharGen's cgJoinCode/
   onJoinCampaignClick pattern almost exactly — an invite-code text input, a button calling
   B.joinAsDm(code), a status message on success/error).
3. On success, reload the campaign list (loadCampaigns()) so the newly-joined campaign appears and is
   selectable, matching the pattern this session's createCampaign wiring already uses.
4. UI-only, no engine.js/compute() involvement. Display-only — do NOT bump DATA.version; log in CHANGELOG.
```

**Done when:** a signed-in user can enter a campaign's DM invite code somewhere in DM Console,
successfully redeem it via `joinAsDm()`, and see that campaign appear in their campaign list — verified
in a real browser.

## Support banning a class as a 2nd origin only (mirror the species asymmetric-ban pattern) — TODO
Branch feat/banned-2nd-origin-class. Investigated while adding boon/drawback tooltips (2026-07-25):
`js/engine.js`'s `validate()` already bans an origin class in **both** `originClass`/`originClass2` slots
via one `bannedOriginClasses` list — there's no equivalent to species' `bannedOriginSpecies` (an
asymmetric list banning a species *only* as a bonus 2nd origin, while still allowing it as a primary
species). This is a genuine engine gap, not a UI oversight: add a mirrored `bannedOriginClasses2`-style
rule so a DM can allow a class as a primary origin but ban it as a stacked 2nd origin, same as species
already supports.
**Effort:** medium · **Risk:** medium — ambiguity is medium (an exact precedent exists to mirror —
`bannedOriginSpecies`'s schema field, `validate()` branch at `js/engine.js` ~lines 689-691, and DM
Console's "Banned as 2nd origin species" rule grid — but naming the new field and confirming CharGen's
embedded engine copy needs the same update are real, if low-stakes, calls); damage scale is medium
(touches `js/engine.js`'s `validate()`, not `compute()`/`_replay()`/`DATA.version` directly, so per
`AGENTS.md`'s rubric this doesn't hit the High tier, but it's still the rules engine); damage likelihood
is medium (no fixture currently exercises `bannedOriginClasses`-style violations, so nothing automated
would catch a wrong implementation) — eligible for `/sweep-code-tasks`, but touches `js/engine.js` so
treat with the file's usual care.

```text
1. Mirror the exact species pattern:
   - `js/engine.js`: add a new rule-schema field (e.g. `bannedOriginClasses2`) alongside
     `bannedOriginSpecies` in `RULE_BAN_FIELDS` (~line 733-745).
   - `validate()`: add a branch checking `b.originClass2` against the new list, mirroring the
     `bannedOriginSpecies` check at ~lines 689-691 (banned only in the 2nd-origin slot, not slot 1).
2. `tools/DM-Console.html`: add a "Banned as 2nd origin classes" rule grid (mirroring
   `ruleBannedOriginSpecies`) to `RULE_GRIDS` and the Campaign Rules panel markup, options from
   `DATA.classes` (same source `ruleBannedOriginClasses` already uses).
3. Best done after Task 6, or update CharGen's embedded engine copy in the same PR — check whether
   CharGen's local copy also needs the new field/validate() branch (per AGENTS.md's Task 6 note).
4. Check whether this changes any existing REV-01 fixture's output (it shouldn't — the new list only
   fires when a DM explicitly sets it, which no existing fixture does). If genuinely output-neutral for
   all current fixtures, do NOT bump DATA.version — log in CHANGELOG. If any fixture's violations output
   changes, bump DATA.version and update testing/expected/ in the same PR.
```

**Done when:** a DM can ban a class as a 2nd-origin-only pick (allowed as primary, banned as bonus 2nd)
via a new DM Console rule grid, `validate()` enforces it, `testing/tests/engine-parity.html` is still 20/0.

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
