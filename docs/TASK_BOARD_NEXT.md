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

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

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

## DM manually adds/imports a character to a campaign, then hands off ownership via a claim link — TODO
Branch feat/character-ownership-claim-link. Today a DM can only get a NEW character into their campaign
by generating a player-invite link that creates a **blank** character owned by whoever redeems it
(`createPlayerInvite`/`redeemPlayerInvite`), or a player can bind an **already-owned** character to a
campaign via a reusable code (`bindCharacterToCampaign`). Neither covers: a DM building or importing a
fully-formed character themselves (e.g. an NPC promoted to PC, or a file a player emailed them) and then
handing *ownership* of that specific character to a player. Confirmed via `grep -n "owner_id"
sql/rls-policies.sql`: no ownership-transfer path exists anywhere today — `characters_update`'s RLS
policy requires `owner_id = auth.uid()` in **both** its `using` and `with check` clauses, so even a raw
table update can never reassign `owner_id`; the only insert grant (`grant insert (id, owner_id, name,
kind, stats)`) sets it once at creation. This is a brand-new SECURITY DEFINER RPC + invite-token flow,
not a wiring-up-an-existing-function task like `createCampaign`/`joinAsDm` were.
**Effort:** high · **Risk:** high — ambiguity is high (real open design questions below, no single
obviously-right answer); damage scale is high (a new ownership-transfer RPC is a genuine security/
trust-boundary change touching live character data — same class of decision `DECISIONS.md` already
treats carefully, e.g. the feedback-widget anon-write table call); damage likelihood is medium-to-high
(nothing automated would catch an authorization bug in a brand-new RPC until it's actually misused) —
worst-of high, never eligible for `/sweep-code-tasks`; recommend `/make-code-cold-plan-review` before
implementation given the trust-boundary + design-call nature.

```text
Open design questions to resolve BEFORE implementing (don't guess — surface for a human/cold-review):
1. How does the DM get the character into the campaign in the first place, while keeping DM Console's
   own stated "read-only, never edits a character" design principle intact? Options: (a) DM builds/
   imports it in CharGen under their own account, bound to the campaign, then generates the claim link
   from CharGen or DM Console; (b) DM Console gains a new, explicit non-read-only capability for this
   one flow, breaking its current invariant; (c) something else.
2. Claim-link semantics: single-use (like campaign_invites/redeem_player_invite) vs. a reusable code?
   Expiry? Can the DM revoke/regenerate it before redemption?
3. What happens to `ap` (DM-awarded, server-authoritative) across the transfer — it should carry over
   untouched per "store raw, derive the rest," but does `ap_awards.dm_id` still make sense pointing at
   the original DM after ownership moves?
4. Authorization for the new RPC: must verify the redeemer isn't already the owner, the character is
   actually unclaimed/transferable, and the caller is a genuine distinct user — mirroring
   redeem_player_invite's idempotency guard (a repeat call by the same user returns the same result
   instead of erroring).
5. Does the player need to consent/confirm before ownership silently changes hands to them, or is
   redeeming the link itself the confirmation?

Steps (once the above are resolved, not before):
1. Design the schema: likely a new invite-token table/column (or extend campaign_invites with a
   character_id + a kind discriminator) for "claim an existing character" tokens, distinct from today's
   "create a new character" tokens.
2. New SECURITY DEFINER RPCs (e.g. create_character_claim(character_id) / redeem_character_claim(token)),
   owner-of-the-character-gated on creation, single-use on redemption, updating characters.owner_id —
   the only path that may ever do so.
3. UI: wherever the DM actually gets the character into the campaign (per design question 1), add a
   "Generate claim link" action; the redemption side likely reuses the existing invite-redemption
   page pattern.
4. Log the ownership-transfer design decision in DECISIONS.md — exactly the kind of security-model
   choice AGENTS.md asks to be recorded.
```

**Done when:** a DM can get a specific, already-built character into their campaign under their own
account, generate a link, and have a named player redeem it to become that character's owner — with the
RPC-level authorization verified (only the current owner can create a claim link; only a genuine distinct
redemption can consume it) and the design questions above resolved and recorded in DECISIONS.md before
merging.

## Purge the "pace curve" mislabel from the historical records — TODO
Branch docs/pace-curve-terminology. `D-GH-2026-08-03-ap-budget-curve-standard` established that PACT has
no AP-earned-per-level curve at all — the `{1:50 … 20:491}` ladder was the Players Guide appendix's
twenty pregenerated Emberwatch sample characters, and the rules define only a *budget* curve (Standard
L1 79/+24, Generous 83/+28, prelude L0 55) and an *award pace* (AP per session, ~7). Live code was
corrected in that change; several archival records still assert the wrong framing as settled fact.
**Effort:** low · **Risk:** medium — ambiguity is low (the correct wording is already settled by
`D-GH-2026-08-03-ap-budget-curve-standard`, one obviously-right annotation per site) and damage scale is
low (docs only, fully `git revert`-able, no code, data or security surface); damage likelihood is medium
— nothing automated gates doc prose, and the real hazard is an agent "tidying" a historical record and
silently dropping reasoning, which AGENTS.md's edit-don't-regenerate rule exists to prevent.

```text
Annotate — do NOT rewrite. These are historical records of what was believed at the time; the repo's
convention is a dated correction note or addendum, the same shape as the existing "Addendum (2026-08-03)"
in D-GH-2026-08-02-creation-lock-switch.md. Preserve the original wording and reasoning verbatim; add a
short note beside it pointing at D-GH-2026-08-03-ap-budget-curve-standard. Never regenerate a whole file.

Sites (verified by grep on 2026-08-03 — re-grep before editing, they may have moved):
1. DECISIONS.md:448 — "left js/ap-by-level.js untouched (pace curve != budget curve)". The parenthetical
   is the mislabel; the decision it describes was still correct at the time.
2. decisions/2026/D-GH49.md:8 — cites DATA.levelAP as {1:50…20:491} / DATA.level1AP 50. Numbers are now
   79-based; note the supersession rather than editing the figures in place.
3. decisions/2026/D-GH-2026-07-14-advancement-tracks.md:9 — "(AP earned by level: 1->50…20->491, which is
   exactly what js/ap-by-level.js's AP_BY_LEVEL already is)". This record ALSO contains the follow-up
   note that predicted a DATA.version bump would be needed; that prediction came true, so cross-link it.
4. decisions/2026/D-GH-2026-08-02-creation-lock-switch.md:78/86/88 — the 2026-08-03 addendum's whole
   two-curve framing. Its mechanism (threshold reads the campaign budget curve) is unaffected and must
   stay; only the "pace curve" naming and the L1=50 figure are wrong.
5. docs/sessions/2026-07-14-advancement-tracks-review-saga.md:22 — session note. Lowest priority; a
   single dated footnote at the top is enough for a session log.

Also re-grep for "1st-level recruit", "491" and "+21/level" outside docs/PACT-Players-Guide.html,
docs/history/ and CHANGELOG-archive-*.md, in case a site was missed.

Docs-only: do NOT bump DATA.version; log the sweep in CHANGELOG.md as one line. No new DECISIONS.md
entry is needed — D-GH-2026-08-03-ap-budget-curve-standard already carries the "why", and this task is
listed there under "Caveats and follow-ups".
```

**Done when:** `grep -rn "pace curve\|PACE curve" --include=*.md --include=*.js --include=*.html .`
returns no hit that presents the term as current fact outside `docs/history/` and the changelog archive
(hits inside an explicit correction note are fine and expected), every edited record still contains its
original wording, and parity still 24/0.

---

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
