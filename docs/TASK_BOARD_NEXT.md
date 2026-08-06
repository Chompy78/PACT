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

## Give the three ways to add a player an obvious hierarchy — TODO
Branch fix/add-player-hierarchy. From the 2026-08-04 usability review (MEDIUM), recorded NOT DONE
because which route to recommend is a product call rather than a mechanical fix. DM Console shows three
differently-scoped routes together with no guidance: the reusable **Players code** (binds a character the
player has ALREADY built, grants the campaign's starting tier), a **single-use invite link** (creates a
NEW character, grants a per-player amount), and the **local-file import** card. A DM meeting this for the
first time cannot tell which fits their situation.
**Effort:** small · **Risk:** low — ambiguity is MEDIUM and is the whole task (the decision, not the
edit); damage scale is low (copy and ordering only); damage likelihood is low — **not** sweep-eligible,
it needs a human decision first.

```text
1. DECIDE (human): which of the three is the default recommendation for a DM adding a player, and in
   what order they should appear. Record it in DECISIONS.md — this is the actual deliverable.
2. Add a one-line "use this when…" under each of the three, in the decided language.
3. Mark one visually as the usual choice; de-emphasise the other two rather than hiding them.
4. Copy-only. Display-only — do NOT bump DATA.version; log in CHANGELOG.
```

**Done when:** each of the three routes carries a one-line "use this when…", one is visibly the default,
the ordering matches the decision, and the reasoning is in DECISIONS.md.

## Reconcile the unnamed-character default across CharGen and DM Console — TODO
Branch fix/unnamed-character-default. From the 2026-08-04 usability review (LOW), recorded NOT DONE
because resolving it means changing a shared default rather than a display string. CharGen sets a real
default NAME of `'New Character'`; DM Console shows `'Unnamed character'` as a fallback for a blank name.
They describe **different states**, so they are not simply inconsistent — but a player sees one word and
their DM sees another for what looks like the same character.
**Effort:** small · **Risk:** medium — ambiguity is medium (the choice below is a real fork); damage
scale is medium (`saveCharacter()`'s `name ?? prev?.name ?? 'New Character'` in `js/sync.js` is on every
cloud write path, so getting it wrong renames characters); damage likelihood is low (`cloud-e2e` covers
the save path) — **not** sweep-eligible.

```text
1. DECIDE (human): should an unnamed character carry a real default name at all, or be stored blank and
   rendered with a fallback everywhere it is displayed? Record in DECISIONS.md.
2. Apply it in ONE place: js/sync.js saveCharacter()'s name default, plus each tool's display fallback.
   Do not leave two different literals in the codebase.
3. Check the migration case: characters already stored as 'New Character' must not be renamed by this.
4. Add a cloud-e2e assertion that the same state renders the same string in CharGen, DM Console and
   My Characters.
```

**Done when:** one convention is documented in DECISIONS.md, all three surfaces render the same string
for the same state, existing characters are unaffected, and `cloud-e2e` asserts it.

## Let an invite link identify its campaign before it is redeemed — TODO
Branch feat/invite-peek-campaign-name. Closes TWO 2026-08-04 review findings with one change: the
campaign-join `confirm()` cannot name the campaign (LOW, recorded WON'T FIX for this reason), and a
revoked invite link looks identical to a live one when opened signed out (MEDIUM, PARTIALLY FIXED —
the banner stopped *promising* validity but still cannot check it). Both need the same missing thing: a
way to resolve a token to `{campaignName, valid}` WITHOUT redeeming it. See
`tools/PACT-CharGen-Webtool.html`'s `tryRedeem()`, where the constraint is already commented.
**Effort:** medium · **Risk:** medium — ambiguity is medium (the auth scope below is a genuine security
call); damage scale is medium (a new anon-reachable RPC widens the attack surface if scoped wrong);
damage likelihood is low (`cloud-e2e` covers invite paths, and the Supabase advisor catches
anon-callable functions — it already caught one this session) — **not** sweep-eligible.

```text
1. DECIDE (human): does the lookup require `authenticated`, or is it anon-callable?
   - `authenticated` fixes the confirm() naming but NOT the signed-out banner.
   - anon-callable fixes both, but lets anyone probe whether a token exists — needs rate limiting and a
     deliberate decision that token-probing is acceptable. Record either way in DECISIONS.md.
2. Add a SECURITY DEFINER RPC returning {campaign_name, valid} for a token, revoking EXECUTE from PUBLIC
   explicitly (new functions inherit it — see D-GH-2026-08-03-invite-note-dm-only).
3. Name the campaign in CharGen's accept confirm(), and remove the now-obsolete comment explaining why
   it could not.
4. Make the signed-out banner distinguish a dead invite from a live one.
5. Run the Supabase advisor and skim get_logs before opening the PR (per AGENTS.md step 4).
6. Add cloud-e2e coverage for a revoked token and a valid one.
```

**Done when:** a token resolves to its campaign name without redeeming, its auth scope is recorded in
DECISIONS.md, the confirm names the campaign, the signed-out banner distinguishes dead from live, the
advisor reports no new findings, and `cloud-e2e` covers both token states.

## DM sets how many characters one player may have in a campaign — TODO
Branch `feat/campaign-character-limit`. Today the limit is hard-wired to exactly **one** character per
player per campaign, and it is not a soft app rule: it is the unique index
`idx_characters_owner_campaign_unique` on `characters(owner_id, campaign_id) where campaign_id is not
null` (`sql/schema.sql`, added by `sql/migrations/2026-07-13-campaign-bind-character.sql`). Requested by
the owner, who wanted two copies of a character in one campaign for a diagnosis and found the limit
was a database invariant rather than a setting.

**The trap that makes this bigger than "drop the index":** that index is not merely a limit, it is the
**TOCTOU race guard** for `bind_character_to_campaign` — the RPC's `EXISTS`-then-write check cannot
close the window on its own, which is exactly why the index exists (see its comment in `sql/schema.sql`
and in `sql/migrations/2026-07-13-campaign-join-race-friendly-error.sql`, which added the friendly error
for the duplicate-key it raises). Dropping it to allow N-per-player would silently reopen that race.
A partial or expression index cannot express "at most N rows per (owner, campaign)" either, so the
guard has to move — most likely into the RPC itself under a `select … for update` on the campaign row,
or a count check inside a serializable transaction. **Get this design reviewed before implementing**
(`/make-code-cold-plan-review`): it is a concurrency change to production data, and a wrong answer here
is a duplicate-join bug that only shows up under real simultaneous joins.

**Effort:** large · **Risk:** high — schema + RPC + RLS + UI; the failure mode is silent (a race that
only bites under concurrency), and it touches the one invariant that currently makes double-joins
impossible. **Not** sweep-eligible.

```text
1. Decide where the limit lives: `campaigns.rules.maxCharactersPerPlayer` (integer, default 1) is the
   natural home — it rides the existing rules JSON, so no new column and DM Console already has a rules
   panel and a save path.
2. Replace the unique index with a guard that still closes the race at N. Do NOT simply drop it. The
   count check has to be race-safe against two simultaneous redemptions of the same invite.
3. Teach bind_character_to_campaign and redeem_player_invite the limit: the current one-per-campaign
   EXISTS check becomes a count-against-limit check, and the friendly error message needs to state the
   actual limit ("Amble allows 2 characters per player") rather than today's fixed wording.
4. DM Console: a number input in the campaign rules panel, next to the starting tier. Default 1.
   Lowering it below what players already hold must NOT delete or unbind anything — existing rosters
   are grandfathered; the limit only gates new joins. Say so in the field's ⓘ.
5. CharGen's join path shows the campaign's limit when a join is refused for hitting it.
6. Migration under sql/migrations/, then run the Supabase advisor and skim get_logs (per-change
   checklist step 4). Rules-only change to the DB — no DATA.version bump.
7. cloud-e2e: cover limit=1 (today's behaviour, must not regress), limit=2 (second join succeeds), and
   the refusal at the limit. A concurrency check for the race guard if one can be written cheaply.
```

**Done when:** a DM can set the per-player character limit on a campaign, the default of 1 reproduces
today's behaviour exactly, joining past the limit fails with a message naming the limit, lowering the
limit never removes an existing character, the race guard is demonstrably still closed at the new N,
the advisor reports no new findings, and `cloud-e2e` covers limit=1, limit=2 and the refusal.

## Password reset is broken end-to-end — the email link lands on the homepage — TODO
Branch `fix/password-reset-flow`. Reported by the owner: clicking the reset link in the recovery email
takes you to the main PACT homepage, not to anywhere you can set a new password. Confirmed in the code,
and it is **two** defects, not one — fixing only the link would still leave the flow dead:

1. **Wrong destination.** `js/auth.js:41-43` calls `resetPasswordForEmail(email, { redirectTo:
   REDIRECT_BASE })`, and `REDIRECT_BASE` (`js/auth.js:12`) is `https://chompy78.github.io/PACT/` — the
   app menu. `index.html` has no recovery handling, so the recovery session is established and then
   silently discarded.
2. **There is no reset page at all.** `setNewPassword()` exists (`js/auth.js:52`, calling
   `supabase.auth.updateUser({password})`, with a comment noting Supabase has put the user in a
   temporary recovery session by then) but **nothing anywhere calls it** — verified by grep across all
   `.html`/`.js` outside `js/vendor/`. `login.html` has no recovery branch and no new-password form.
   So even pointed at `login.html`, the link would land on a sign-in form the user can't use.

**Effort:** medium · **Risk:** medium — auth flow on production, and the failure mode is a locked-out
user rather than a visible error. Needs a real end-to-end test with a live recovery email; the happy
path cannot be verified by unit-level checks alone. Not sweep-eligible.

```text
1. Add a recovery branch (a `?type=recovery` route on login.html, or a small reset.html) that listens
   for Supabase's PASSWORD_RECOVERY auth event and shows a new-password form, then calls the existing
   setNewPassword(). Prefer login.html — one auth page, one place service-worker caching has to be
   right — unless the fragment handling makes a dedicated page materially simpler.
2. Point resetPasswordForEmail's redirectTo at that page. Note REDIRECT_BASE is ALSO used by signUp's
   emailRedirectTo (js/auth.js:25), where the homepage IS correct — so introduce a separate constant
   rather than repointing the shared one.
3. Add the new URL to the Supabase project's Auth → URL Configuration → Redirect URLs allow-list.
   A redirect not on that list is silently rewritten to the Site URL — which is very likely the real
   reason this lands on the homepage, so CHECK THIS FIRST: the allow-list may make step 2 a no-op
   until it is fixed, and it is a dashboard setting, not a repo change.
4. The recovery token arrives in the URL fragment/query and is consumed on load — make sure the page
   reads it before anything (service worker, a redirect, a router) can drop it, and that the service
   worker does not serve a cached copy of the page that misses the fragment handler.
5. Handle the expired/already-used token case with a real message and a way to request a new email,
   not a blank form.
6. Confirm sign-UP confirmation emails still land on the homepage correctly after the constant split.
```

**Done when:** a real recovery email's link opens a page that accepts a new password, the new password
works for sign-in, an expired link says so and offers a resend, the signup confirmation email is
unaffected, and the redirect URL is on the Supabase allow-list.

## Species/heritage packs are never charged as a purchase — the frozen ledger under-records — TODO
Branch `fix/species-pack-not-charged`. Found while investigating a DM Console report that roster AP
figures looked wrong. **This is the root defect behind that whole thread** — the display bugs were real
but downstream of this.

**Reproduction (Anders Tealeaf, live Amble character, built 2026-08-02 on v0.337).** The build is
correct at **33 AP** and its species costs are correct — confirmed by the owner:

| what `compute()` charges | AP |
|---|---|
| Heritage pack | 5 |
| 2nd origin species (×2 pack) | 10 |
| Species traits (Halfling: Naturally Stealthy) | 4 |
| **species total** | **19** |

The four traits *inside* the packs (Halfling Nimbleness, Gnome Darkvision, Gnome Gnomish Cunning,
Halfling Luck) are correctly 0 — pack-included. But the LOG records, for the same 19 AP:

| log event | recorded |
|---|---|
| `patch/identity` (set Halfling + Gnome + Forest + Rogue) | **−5** |
| `racial` Naturally Stealthy | +4 |
| four pack-included traits | 0 each |
| **total** | **−1** |

So the packs are **never charged**: ~20 AP of species cost missing, netted against categories where he
overpaid at v0.337 prices (saves 8 vs 5 today, skills 4 vs 2) to leave the build's frozen spend **18 AP
short** of what it costs — comparable like-for-like, frozen **15** vs `compute()` **33**.

**Cause — sharper than "the packs aren't charged".** `compute()` derives the pack cost from `b.species`
/ `b.species2` alone (`js/engine.js:177-178`), so a pack is never an event by design; it is priced as a
consequence of the identity state. That is fine on its own. The defect is in how the identity event's
delta was computed:

- The four traits were **committed to the LOG before the identity event**, each recorded at **0**
  (priced as pack-included — CharGen's form already knew the species even though no identity event had
  been written yet).
- `priceOf()` then priced the identity event as `compute(after) − compute(before)`. But
  `compute(before)` sees traits owned with **no species set**, so it prices them as expensive
  **cross-race** purchases — 21 AP that the log never actually charged.
- The delta therefore *refunds* that phantom 21 while adding the real +15 of packs, landing at −5.

Verified: `compute()` on the log truncated just before the identity event returns **21**, while the sum
of recorded costs to that point is **0**. So the identity delta refunds AP that was never paid, and from
that event onward the frozen ledger and `compute()` stay ~18 apart for the rest of the character's life.

**The general failure:** `priceOf()` computes deltas against `compute(build)`, but recorded costs are
not kept equal to `compute()`. Once the two diverge for any reason — here, ordering — every later delta
compounds the error rather than correcting it. Any fix that only special-cases packs will leave this
mechanism intact.

**Owner's direction:** the packs are *real, allowable purchases* that grant those species abilities at a
discount, so they must be recorded as purchases in their own right — their own log events with their own
cost — not folded into an identity patch's net delta.

**Effort:** large · **Risk:** high — rules-adjacent, changes what the frozen ledger contains, and every
existing character is already under-recorded. **Get a cold plan review before implementing**
(`/make-code-cold-plan-review`). Not sweep-eligible.

```text
0. SUPERSEDED — H2 (the INVARIANT route) was REVERSED on 2026-08-05 after two rounds of external cold
   review (5 reviewers, then 4). DO NOT BUILD IT. See decisions/2026/D-GH-2026-08-05-pricing-model.md.
   Why it was wrong: H2 said "make each event's recorded cost equal compute()'s own delta by
   construction" — but that delta is EXACTLY what priceOf() already returns, i.e. the contaminated
   number that produced the -5. H2 formalises the defect rather than fixing it.
   The real defect is priceOf()'s whole-build-delta quoting basis (tools/PACT-Live-Char-Sheet.html
   :503-511): any purchase that changes pricing context bills the player for re-pricing everything
   they already own. Already escaped by hand three times (abil, mbound, dbound).
   The acceptance test below is also wrong as a general property — prices freeze at purchase while
   compute() re-prices at today's context, so the two are MEANT to diverge for any character who has
   levelled or unlocked a class. It holds only for a character built entirely at one context, which is
   what its own "freshly built character" wording actually scoped.
   THIS TASK IS NOW LAST OF FOUR and reduces to CharGen draft reconciliation. Prerequisites, in order:
   (1) docs/pricing-model-decisions — DONE; (2) feat/creation-lock-wiring — DONE; both landed on
   branch claude/get-ready-i52ojw. (3) fix/livesheet-context-pricing — NOT STARTED, must land first.
1. If emitting pack events: a distinct `cat:'pack'` buy event per pack (heritage, 2nd-origin) carrying
   its own cost. Keep the pack-included traits at 0; they are correct and the owner confirmed it.
2. Whichever route, the identity patch must stop absorbing the pack cost, or the same AP is charged
   twice. This is the part to get reviewed: priceOf() computes a WHOLE-BUILD delta, so splitting one
   component out without double-counting needs care. compute() is the arbiter — after the change, the
   sum of a character's frozen costs must equal compute().total for a character built entirely under
   one rules version. That is the acceptance test, and it fails today: 15 vs 33.
3. Changing species later (Halfling -> Elf) must refund/recharge the pack, not silently keep the old
   entitlement. Cover the swap in both directions.
4. MIGRATION — do not skip. Existing live characters (Anders 33 vs 21, Fenwick, Cedric, and any
   already-built PCs) carry under-recorded ledgers. Options: leave them grandfathered (the app's stated
   rule is that price drift is never refunded or charged), or emit a one-off reconciliation event.
   This is a product decision for the owner, not an implementation detail — ask before writing it.
5. engine-parity must stay 24/0. If compute() output moves, update testing/expected/ in the same PR and
   bump DATA.version. If only CharGen's recorded costs change, DATA.version does NOT move.
6. Add a gate asserting frozen-spend == compute().total for a freshly built character, which is the
   invariant this task exists to restore.
```

**Done when:** buying a heritage/2nd-origin pack writes its own priced log event, a character built from
scratch has frozen spend equal to `compute().total`, changing species re-prices the pack correctly, the
migration decision is recorded in `DECISIONS.md`, and a gate covers the invariant.

## Live Sheet history hides derived costs — it shows the traits but never the packs — TODO
Branch `fix/history-shows-derived-lines`. Reported by the owner alongside the pack-charging defect
above. **Sequenced after it** — much of this may resolve once packs are real events, so re-assess
before starting.
**⚠ Inherits the reversed H2** — re-read this entry against `decisions/2026/D-GH-2026-08-05-pricing-model.md`
before scoping; the pack-charging task it sits behind has changed shape and is now last of four.

The Live Sheet's purchase history is **event-only**, so for Anders it renders:

```text
241  Species trait — Halfling: Halfling Nimbleness   v0.337   −0
242  Species trait — Gnome: Darkvision 60 ft         v0.337   −0
243  Species trait — Gnome: Gnomish Cunning          v0.337   −0
244  Species trait — Halfling: Luck                  v0.337   −0
```

Four entries at −0 and **no sign of the 19 AP the species actually cost**, because Heritage pack and
2nd origin species are *derived* lines from `compute()`, not log events. The AP Ledger panel does show
them. So the tool presents two views of the same spend that don't reconcile, and the history — the one a
player reads to answer "where did my AP go" — is the one that hides it.

**Effort:** medium · **Risk:** low — display-only, no rules logic. Sweep-eligible **only after** the
pack task lands and the remaining gap is re-measured.

```text
1. Re-measure first. If packs become real log events, the history may become complete on its own and
   this task shrinks to a check.
2. For whatever derived cost remains, make the history reconcile with the AP Ledger — either by showing
   derived lines inline, or by grouping pack-included traits under their pack with the pack's price so
   a −0 entry is visibly explained rather than looking free.
3. A 0-cost entry should never read as "this was free" when it was paid for inside a bundle. That is
   the actual user-facing complaint.
4. Display-only — do NOT bump DATA.version; log in CHANGELOG.
```

**Done when:** the Live Sheet history accounts for every AP the AP Ledger charges, a pack-included trait
is visibly attributed to the pack that paid for it, and the two views reconcile for Anders Tealeaf.

## feat/ap-model-reconcile — "AP left" and the AP Ledger disagree on the same screen — TODO
Branch `feat/ap-model-reconcile`. Long-deferred from D-GH30, now with a live worked example and a
decision already taken, so it is ready to scope.
**⚠ Inherits the reversed H2** — re-read this entry against `decisions/2026/D-GH-2026-08-05-pricing-model.md`
before scoping. In particular, "AP left" vs the AP Ledger disagreeing is EXPECTED, not a defect, wherever
the character's context has changed since a purchase: the ledger records what was paid, `compute()` prices
what it would cost today. The bug is only where the two disagree for a reason other than that.

**The decision (G1, owner, 2026-08-04):** DM Console's roster "AP left" uses the **frozen ledger** —
`compute().spendable − economy().spent` — matching the Live Sheet's `_apRemaining()` and, critically,
its `buy()` gate: the frozen figure is what actually governs whether a player can spend. Shipped in
#355. The AP Ledger panel keeps showing `compute().total`, because repricing is that panel's subject.
The consequence is accepted, not overlooked: the two can disagree on one screen.

**Worked example — Fenwick Copperkettle (live, Amble):**

| figure | value | source |
|---|---|---|
| DM AP (spendable, campaign ignores player AP) | 36 | `characters.ap` |
| frozen spend | 47 | `economy().spent` |
| repriced build cost | 40 | `compute().total` |
| card "AP left" | **−11** | frozen |
| AP Ledger | **4 over** | repriced |

The 7 AP gap is two things: ~3 of genuine price drift (paid 8 for a DEX save that reprices to 5, etc.)
and 4 of drawback accounting — the refund sits inside `compute().total` as −4 but is excluded from
frozen `spent`, landing in `earned` instead.

**Also unresolved here:** `apLevel` uses `trackLevel(eco.earned)`, so a fully DM-funded character reads
**Earned Lv 0** with **0 earned** even when the DM granted 36 — because `economy().earned` cannot see DM
AP. This is wrong identically in the Live Sheet and DM Console, which is why #355 deliberately did NOT
fix it there alone (that would have traded a shared bug for a new divergence). Fixing it belongs here.

**Effort:** large · **Risk:** high — decides what every AP number in the app means. Not sweep-eligible.
**Sequence after `fix/species-pack-not-charged`**, which changes what the frozen ledger contains.

```text
1. Decide whether "earned" is a display composition (eco.earned + dmAp, honouring ignore_player_ap) or
   whether the engine grows a frozen-ledger-aware remaining-AP export. The former keeps economy() pure
   and log-only, which the anti-double-count invariant wants; the latter puts it in one place.
2. Whatever is chosen, Earned Lv / "AP to reach Earned Lv N+1" / the header Track-Level must all read
   from it, in BOTH tools, or the divergence just moves.
3. Decide whether the card and the AP Ledger should ever be allowed to differ. If yes, label them so a
   DM can tell which question each answers; if no, one of them changes.
4. Note for scoping: Amble's starting tier is 36 AP while the Standard curve's L1 is 79 and its level 0
   is 55 — so every character there reads below level 0 on the curve. Worth confirming with the owner
   whether that is intended before treating low Track-Levels as a bug.
```

**Done when:** a DM-funded character shows an Earned Lv and an earned figure that account for DM AP, the
card and the AP Ledger either agree or are labelled to explain why they differ, both tools read the same
definition, and Fenwick's numbers are used as the regression fixture.

## buyManeuver() emits without an affordability check — TODO
Branch `fix/maneuver-afford-gate`. Found while auditing the pricing model
(`decisions/2026/D-GH-2026-08-05-pricing-model.md`); unrelated to it.
**Effort:** low · **Risk:** low — ambiguity low (route it through the existing gate, an exact pattern to
copy); damage scale low (one buy path); damage likelihood low (the guard either fires or it doesn't, and
it is trivially checkable in a browser) — worst-of lands at low.

```text
1. tools/PACT-Live-Char-Sheet.html:1497 emits the mvbuy event directly:
     emit({type:'buy',cat:'mvbuy',payload:{},cost:4+(b.maneuverBuys||0),...})
   bypassing buy() and therefore the `cost>avail` gate at :537-538.
2. A player with 0 AP available can buy maneuvers indefinitely — the only unguarded purchase path in
   the tool. (setWornArmour and takeDrawback also bypass buy(), but are cost 0 and negative-cost
   respectively, so both are intentionally exempt; leave them alone.)
3. Fix: route the maneuver purchase through buy(), or replicate the affordability guard at the emit
   site if buy()'s dup/legality checks don't apply cleanly to this category.
4. Note the OVER BUDGET warning is deliberately NOT a gate (see the comment at :515) — do not "fix"
   this by hard-blocking on that warning; the gate is the frozen-economy check in buy().
```
**Done when:** buying a maneuver with insufficient AP is refused with the same flash as any other
purchase, and buying one with sufficient AP still works; engine-parity 24/0.

## Epic boons are hard-blocked on their first purchase in the Live Sheet — TODO
Branch `fix/epic-boon-first-buy-block`. Found while auditing the pricing model
(`decisions/2026/D-GH-2026-08-05-pricing-model.md`); unrelated to it. A whole category of boon (12 of
them, all `epic:true`) currently cannot be bought at all in the Live Sheet.
**Effort:** low · **Risk:** low — ambiguity low (add the pattern to the existing SOFT_WARN regex, an
exact pattern to copy); damage scale low (one warning's classification); damage likelihood low —
worst-of lands at low. Care needed only in not widening SOFT_WARN so far that real violations slip
through, so match the specific wording.

```text
1. MUT.boon (js/engine.js:489) only pushes the label; it does not set epicBoonAbil. So compute() on the
   candidate build takes the else-branch at js/engine.js:110 and raises
     "<boon>: choose an ability to raise (+2)"
2. legalCheck() surfaces that as a NEW warning, and it does not match SOFT_WARN
   (tools/PACT-Live-Char-Sheet.html:523), so buy() classifies it as a hard rules violation and refuses
   the purchase with "⛔ Purchase blocked" at :543.
3. But the warning is expected, not a violation: the ability is chosen afterwards, in the Names dialog
   (:1414, :1499-1509). The purchase is legal; the prompt is guidance.
4. Fix: add the "choose an ability to raise" wording to SOFT_WARN (or exempt it explicitly), so it
   becomes a confirm-through advisory rather than a block.
5. Sequencing note: fix/chargen-preserve-epicboonabil (NOW) touches the same feature from the other
   end. Neither blocks the other, but do them in either order aware of the other.
```
**Done when:** an epic boon can be bought in the Live Sheet, the "choose an ability to raise" prompt
still appears as guidance, a genuinely illegal purchase is still hard-blocked; engine-parity 24/0.

## One-off reconciliation pass for characters built before the pricing fixes — TODO
Branch `fix/ledger-reconciliation-pass`. **Sequence LAST — after all four pricing branches have landed**
(see `decisions/2026/D-GH-2026-08-05-pricing-model.md`, D6, where the owner decided this on 2026-08-05).
Characters built before that work carry ledgers frozen from a contaminated quoting basis: Anders is 15
against `compute()`'s 33, and every Level Up or class unlock recorded an over- or under-charge. They are
grandfathered until this runs; do not bolt a partial migration onto any individual fix.
**Effort:** medium · **Risk:** high — ambiguity high (what "correct" means for a character whose purchases
were made at contexts that no longer reproduce is a genuine judgement call, not a lookup); damage scale
high (rewrites frozen ledgers, the app's own record of what a player paid); damage likelihood medium (the
corpus is small and known, and the invariant is checkable afterwards) — worst-of lands at high. Not
sweep-eligible.

```text
0. DO NOT START until fix/livesheet-context-pricing and fix/species-pack-not-charged have both landed.
   Reconciling against a definition of "correct" that is still moving is how this drift began.
1. Inventory first, decide second. Replay every saved character (local + cloud) and produce a table of
   frozen-sum vs compute().total, per character, with the per-event deltas that explain the gap. Do not
   write anything on this pass — the owner needs the numbers before authorising any rewrite.
2. Expect at least three distinct causes and report them separately: species packs never charged; Level
   Up over-charged by the Vigor/Grit re-price; class unlock under-charged (it could go NEGATIVE, i.e. it
   paid AP out) — so some characters are over-budget under corrected pricing and some are under.
3. Decide the shape WITH the owner: a correcting event appended per character (auditable, keeps the
   append-only property, shows in the ledger as a visible adjustment), or a rewrite of the frozen costs
   (cleaner-looking, destroys the record of what was actually paid). Default to the appended event.
4. Characters that are over-budget after correction are a product question, not an implementation one —
   ask before trimming, refunding, or granting AP to cover the difference.
5. Gate: after the pass, a corrected character's frozen sum must equal compute().total where the rules
   say it should. Add that assertion to testing/scripts/tool-pricing-ci.mjs rather than checking by hand.
6. engine-parity must stay 24/0 and DATA.version must not move — this rewrites data, not rules.
```
**Done when:** the inventory table exists and has been reviewed by the owner, the agreed correction has
been applied to every affected saved character, over-budget outcomes have an owner decision recorded, and
a gate asserts the invariant for corrected characters.

## AP ledger: drawbacks don't list what was taken, unlike every other itemised line — TODO
Branch `feat/ledger-itemise-drawbacks`. In CharGen's AP ledger the `Drawbacks (refund)` line shows only a
lump sum, so a character with three drawbacks shows one number and no way to see which three. Every
comparable line already expands into named third-level rows — Arts & Techniques, Species traits, Class
features, Subclass abilities and **Boons** all do.
**Effort:** low · **Risk:** low — ambiguity low (four existing `addItems()` calls to copy exactly, and
the ledger already renders `itemize` generically so no UI work is needed); damage scale low (display
only — no AP total moves); damage likelihood low (the parity gate plus an eyeball in the ledger) —
worst-of lands at low.

```text
1. compute() already returns `itemize` (js/engine.js:454), a map of ledger-line label -> [[name, ap], …],
   populated by addItems(). It is called for exactly five lines: "Arts & Techniques" (js/engine.js:160),
   "Species traits" (:205), "Class features" (:237), "Subclass abilities" (:268) and "Boons" (:398).
   The drawbacks loop (~:404) collects nothing.
2. Both tools' ledgers already render itemize generically — CharGen at
   tools/PACT-CharGen-Webtool.html:3705,3708 walks (r.itemize||{})[lineLabel] for EVERY line. So adding
   the engine-side collection is the whole job; no renderer change.
3. In the drawbacks loop, build the pairs alongside the existing `drawGain` tally and call
   addItems("Drawbacks (refund)", …) — the key must match the ledger line's label EXACTLY or it renders
   nothing and fails silently. Note the values are refunds: decide and state whether each row shows the
   drawback's AP as positive (matching the label's "(refund)") or negative (matching the line total's
   sign), and be consistent with how "Boons" presents its rows.
4. House-ruled drawbacks (b.houseRules.draws) override the printed AP — itemise the value actually
   charged, not the printed one, or the rows won't sum to the line.
5. Check whether testing/expected/ captures `itemize`. Totals do NOT change, so this should be a
   display-only change with NO DATA.version bump — but confirm rather than assume, and if the fixtures
   do capture it, refresh them in the same PR and say so.
6. While here: confirm "Boons" rows actually appear in the ledger. The engine populates them, but it is
   worth an eyeball that the label matches, since that is the exact failure mode described in step 3.
```
**Done when:** a character with two or more drawbacks shows each one as its own named row under
`Drawbacks (refund)` in CharGen's AP ledger, the rows sum to the line total, house-ruled values are
respected, and engine-parity still reports 24/0.

## Tune CharGen's random character generator — TODO
Branch `feat/randomize-tuning`. `randomizeRoll()` (`tools/PACT-CharGen-Webtool.html:3232`) rolls a
character but nobody has written down what a *good* roll looks like.

**⚠ Acceptance criteria are deliberately unset.** The owner asked for "tuning" without naming a
complaint, so step 1 is to capture what is actually wrong — not to guess. Do not start implementing
against invented criteria.

**Effort:** medium · **Risk:** high — ambiguity is high (what counts as a good roll is a design/taste
call only the owner can make); damage scale is low (single tool, no rules logic, `git revert` undoes it)
and damage likelihood low (`random-manual-e2e.mjs` already gates it in a real browser). Not
sweep-eligible until the owner has named concrete criteria — then re-rate.

How it works today, verified 2026-08-05 rather than assumed:
- `randomizeBuild()` confirms, then `randomizeRoll()` deep-clones `readBuild()` (= `foldBuild(LOG)`,
  cloned because the fold's nested arrays ALIAS the LOG event payloads).
- It **keeps anything already chosen** — species, class, name, budget — and fills only what is unset,
  biased toward the chosen class and species.
- The ceiling is `compute(b, _cgDmOpts()).spendable`, i.e. player AP **plus** DM-granted AP when a
  campaign is active — not the raw player budget.
- A spendable of 0 is treated as a real answer, not a missing one: it refuses with "ask your DM to
  grant some" rather than building an unaffordable ~79 AP character.

```text
1. FIRST, and before any code: get the owner to name what a bad roll looks like. Concrete examples beat
   adjectives — "rolled 3 Vigor and no skills", "spent 12 of 79 AP", "took cross-race traits it can't
   use", "every roll looks the same". Without this the task cannot be judged done.
2. Write those down IN THIS ENTRY as the acceptance criteria, then re-rate Risk (it is high only
   because they are missing) and note whether it has become sweep-eligible.
3. Only then implement. Keep the four behaviours listed above unless a criterion explicitly overrides
   one — each is a deliberate fix for a real bug, not an accident, and the spendable-of-0 refusal in
   particular has its own comment explaining what it replaced.
4. Assert the agreed criteria in `testing/scripts/random-manual-e2e.mjs`, which already drives randomize
   in a real browser against an independent oracle (D-GH-2026-07-13-random-e2e-real-oracle). Note it
   needs Playwright and so cannot run in a CLI session — if the criteria are checkable without UI
   interaction, prefer `testing/scripts/tool-pricing-ci.mjs`, which is dependency-free CDP.
5. Budget-adherence checks must read the RECONCILED ledger. `fix/species-pack-not-charged` (2026-08-05)
   changed what randomize's resulting log contains — a draft's frozen costs are now re-derived by
   `repriceDraft()` to equal `compute().total` — so asserting against the old frozen figures would be
   testing a state that no longer exists.
6. Display/UX only — randomize writes a build, it does not change rules. Do NOT bump `DATA.version`.
```

**Done when:** the owner's concrete criteria are written into this entry, the generator satisfies each
one, a test in `random-manual-e2e.mjs` (or `tool-pricing-ci.mjs`) asserts them, and engine-parity still
reports 24/0.

## CharGen quotes a locked character's context changes as a whole-build delta — TODO
Branch `fix/chargen-context-pricing`. D1 of `decisions/2026/D-GH-2026-08-05-pricing-model.md` — *a
purchase that changes pricing context is quoted from its own rules table, never by whole-build diff* —
was implemented for the Live Sheet's `priceOf()` only. CharGen's `replacePatchSlot()`
(`tools/PACT-CharGen-Webtool.html`) still does `compute(after).total − compute(before).total`.

**Effort:** medium · **Risk:** medium — ambiguity medium (D1 already fixes the rule and the Live Sheet's
`_CTX_PRICERS` table is the pattern to copy, but CharGen prices whole patch SLOTS rather than single
categories, so the mapping is not one-to-one); damage scale medium (one tool, but it writes frozen costs
into saved logs); damage likelihood low (`tool-pricing-ci.mjs` gates it and is dependency-free).

**Re-measured 2026-08-05 (after the Grit correction and the Vigor per-rank stamp): this is now the LAST
remaining disagreement between the two tools.** Nine pricing categories were compared on identical logs;
eight agree. The survivor:

| case | Live Sheet | CharGen |
|---|---:|---:|
| unlock Wizard owning 4 Wizard features | 7 | **−6** |
| unlock Wizard owning none (control) | 7 | 7 |

CharGen *pays the player 6 AP* to unlock a class they already have features in, because the whole-build
delta sweeps in the retroactive discount those features get once the class is unlocked. The fix has the
same shape as the two that landed: stamp each feature with whether its class was unlocked when it was
bought (as `_raceTraitLocked` does for species traits and `_vigorRankTier` now does for Vigor), so an
already-owned feature keeps the cross-class price it was actually bought at.

**Why it was survivable until now, and why it no longer is.** While a character is a draft,
`repriceDraft()` overwrites whatever `replacePatchSlot()` quoted, so the bad quote never reached the
ledger. Once the lock fires, re-pricing stops by design (D7) and the quote is what gets frozen.
Reproduced 2026-08-05: a locked character with species Dwarf and four Halfling traits, switching to
Halfling, is quoted **−4** — a refund — where the listed Halfling pack price is 7. The ledger keeps it.

```text
1. Read the Live Sheet's `_CTX_PRICERS` table first; it is the same rule already solved once, and the
   two tools must not disagree about what a context change costs.
2. The mismatch to design around: `_CTX_PRICERS` is keyed by event CATEGORY (abil, hd, unlockclass…),
   but `replacePatchSlot` writes a whole SLOT (IDENTITY carries originClass, originClass2, species,
   species2, size, lineage at once). Decide whether to price a slot field-by-field against its own
   table, or to split the context-bearing fields out of the slot. Say which and why — this is the part
   worth getting reviewed.
3. Only the pricing basis changes. Do NOT reintroduce filter-and-append: replace-in-place is what keeps
   the identity line in its own position in the ledger, and it is now also what keeps a locked
   character's event indices stable.
4. The draft path must stay unchanged — `repriceDraft()` still owns pre-lock pricing, and this quote
   only ever reaches a ledger once the lock has fired. Assert both halves.
5. Gate in `testing/scripts/tool-pricing-ci.mjs` alongside the existing "re-pricing stops dead once the
   lock has fired" block, which already builds a suitable locked fixture. The assertion is that a locked
   species change is quoted at the listed pack price, independent of what traits are already owned.
6. Prices move, so if `compute()` output changes at all, bump `DATA.version` and refresh
   `testing/expected/` in the same PR. If only CharGen's recorded costs change, it does NOT move.
```

**Done when:** a locked character's species/class change is quoted at its listed price regardless of what
is already owned, CharGen and the Live Sheet agree on that price, draft re-pricing is unaffected, a gate
asserts it, and engine-parity still reports 24/0.

## DM: view a campaign character in CharGen (read-only) — TODO
Branch `feat/chargen-dm-view`. Owner, 2026-08-05: *"it's only for looking at this stage… first step is
just the view as this is most useful during start of a campaign."* Stage 2 (DM editing) is the separate
entry below; build this one first and do not let its scope drift into editing.

**Today there is no route at all.** DM Console's roster card offers only "View in Live Sheet"
(`tools/DM-Console.html:1762` → `PACT-Live-Char-Sheet.html?viewChar=<id>`). CharGen has **no `viewChar`
handler** — zero matches in the file. The obvious workaround was deliberately closed: the Live Sheet's
"Open in CharGen" button is hidden in read-only mode (`_lsApplyViewOnlyUi`, ~:1901), because CharGen has
no read-only concept and would happily edit and persist another player's character.

### Preferred approach — hand the DM a COPY, not a locked view (owner, 2026-08-05)

*"Have a duplicate of the character automatically created in the background that the DM can look at and
view as if it was their own character. This way the DM can play with a character if they really want and
there's no risk of damaging the actual original."*

**This is better than the read-only route below on every axis that matters, and it should be built first.**

- **Safe by construction rather than by vigilance.** The read-only route needs twelve mutation entry
  points gated correctly, and stays correct only while every future edit path remembers to check the flag.
  A copy with its own id cannot touch the original no matter what CharGen does to it.
- **Much less code.** No `CG_VIEW_ONLY`, no guards, no hide-list. CharGen works exactly as it does today.
- **More useful.** "What if I gave them this boon?" is a question a DM actually has at campaign start, and
  a locked view cannot answer it.
- **It also sidesteps the re-pricing trap** noted below: a scratch copy showing today's reconciled ledger
  is unremarkable, whereas the same numbers presented as "the player's character" would read as a bug.

**THE ONE HAZARD, and it is severe: the copy MUST get a fresh `genCharId()`.** The handoff envelope
carries the original's `id`, and CharGen adopts whatever id it is handed (`currentCharId()`,
`_cgApplyEnvelope`). A copy that keeps the original id is not a copy — it is the DM's browser autosaving
and cloud-saving over the player's character. Assert the new id differs from the source id in the gate;
this is the single thing most likely to be got wrong, and it destroys player data when it is.

**Housekeeping to decide before building:**
- Where does the copy live — the DM's local storage only, or their cloud character list? Cloud means it
  shows up among their own characters and needs clear labelling; local-only means it vanishes on another
  device, which for a scratch copy is probably fine.
- Naming: something unmistakable, e.g. *"Anders Tealeaf (DM copy)"*, so it is never mistaken for the real
  character in a roster.
- It must NOT be campaign-bound, or a save could write into the campaign's roster.
- Do copies accumulate? A DM checking six characters gets six copies. Overwrite-per-source, or let them
  pile up and prune manually?
- It is a **snapshot**: if the player edits afterwards the copy is stale. Fine for "look at it at campaign
  start", worth stating in the UI so nobody treats it as live.

**The read-only route below is retained as the fallback**, for the case where the DM genuinely needs to
see the character *as it currently is* rather than a point-in-time copy. Do not build both up front.

**Copy the Live Sheet's shape, which already solved this.** Its `VIEW_ONLY` flag no-ops emit/save/undo/
redo — *that* is the safety; hiding buttons is cosmetic, so a control missed off the hide-list silently
does nothing rather than becoming a data risk. Keep that split, it is the reason the Live Sheet version
is robust.

**CharGen's guard surface is larger than the Live Sheet's** — every one of these mutates the LOG or
persists it, and all need gating:
`emit()` · `replacePatchSlot()` · `retractFlatEvent()` · `replaceWholeLogFromBuild()` ·
`_cgSyncSingletonEvent()` · `undo()` · `redo()` · `resetBuild()` · the local autosave · and the **three**
`S.saveCharacter(...)` call sites (~:770, ~:800, ~:1011).

**Two traps specific to CharGen:**
1. **Its boot REGENERATES the log from the DOM** (`applyBuild` → `replaceWholeLogFromBuild`) and, since
   `fix/species-pack-not-charged`, re-prices a draft ledger via `repriceDraft()`. So a DM viewing a
   player's character would see a *reconciled* ledger, not the frozen one the player sees in the Live
   Sheet. That is not wrong exactly — it is "what this costs today" — but two tools showing a DM
   different totals for the same character will read as a bug. Decide whether the DM view labels this,
   suppresses the re-price, or shows both. Worth settling before coding.
2. **Use `peekCharacter()`, not `loadCharacter()`.** `loadCharacter()` caches whatever it fetches into
   localStorage with no ownership check — the exact mechanism of
   `D-GH-2026-08-02-listmycharacters-local-cache-leak`. Note `peekCharacter()` (`js/sync.js:172`) prefers
   an existing local copy, so confirm it cannot serve the DM a stale one.

**Effort:** medium · **Risk:** high — ambiguity is high (trap 1 is a genuine design call about what the
DM should be shown); damage scale high (a wrong guard means a DM's browser silently overwrites a player's
character, and it touches the cloud write path); damage likelihood medium (no automated cover — the
dependency-free gate cannot sign in). Not sweep-eligible.

```text
1. Build the COPY approach first (see above) - it is safer, smaller and more useful than the read-only
   route, and it makes trap 1 moot. The steps below describe the read-only fallback; do them only if the
   copy approach is rejected.
1b. For the copy: mint a fresh genCharId(), assert in the gate that it differs from the source id, drop
   the campaign binding, and label the character unmistakably as a DM copy.
2. Add a CG_VIEW_ONLY flag and gate all twelve entry points listed above. Gate at the function head, as
   the Live Sheet does, so anything added later no-ops by default rather than needing a list kept current.
3. Add the ?viewChar=<id> handler, loading via peekCharacter(). Mirror the Live Sheet's banner naming
   whose character it is.
4. Add "View in CharGen" to the DM Console roster card beside the existing Live Sheet button.
5. Hide the visibly-editable controls, but treat that as cosmetic only - never as the safety.
6. Cover what can be covered without credentials: that CG_VIEW_ONLY makes each entry point a no-op is
   assertable in testing/scripts/tool-pricing-ci.mjs with no sign-in. The cloud half will need a manual
   check - say so in the PR rather than implying it was tested.
7. engine-parity must stay 27/0; no DATA.version change (no rules move).
```

**Done when:** a DM can open a roster character in CharGen from the DM Console, nothing in that view can
alter or persist the character (verified by trying each entry point), the character is fetched without
being cached into the DM's local storage, and a gate asserts the no-op behaviour.

## DM: edit a campaign character, recorded in the log as a DM edit — TODO
Branch `feat/dm-edit-events`. Owner, 2026-08-05: *"I want to be able to eventually edit, particularly with
adding or removing boons and drawbacks. But I think this should be an edit to the save file log that
states it is a DM edit."* **Blocked on `feat/chargen-dm-view` above** — build the read-only view first.

**The design idea is the good part and should not be lost:** a DM's change is not a silent overwrite, it
is *an event in the character's log marked as having come from the DM*. That falls straight out of the
event-sourced model — the log already records what happened and in what order, so a `dmEdit` marker (plus
who and when) makes the ledger show the player exactly what their DM changed, and keeps it undoable and
auditable like anything else. This is strictly better than a DM editing the character's raw state.

**Scope named by the owner:** adding and removing boons and drawbacks first. Not a general editor.

**Effort:** high · **Risk:** high — ambiguity high (several open questions below, all rules/product
calls); damage scale high (writes to another user's character through the cloud). Not sweep-eligible.

### Owner's answers, 2026-08-05

**A DM edit must leave the player's available AP unchanged.** The owner gave this as two rules and asked
whether they conflict. They do not — they are one rule applied to opposite signs, which is worth stating
plainly because it makes the implementation a single invariant rather than two special cases:

| DM action | normally | so, to stay neutral |
|---|---|---|
| adds a boon | costs AP | grant matching **bonus AP** — net 0 |
| adds a drawback | *grants* AP | **suppress** the AP grant — net 0 |

A player is never richer or poorer for a DM edit: they simply have the boon, or they simply have the
drawback. Implement it as the invariant "a `dmEdit` event contributes 0 to the player's spendable AP" and
both rows fall out of it.

**The player cannot undo a DM edit.** There is already a working precedent to copy rather than invent:
an `award` event acts as an undo barrier in the Live Sheet (~:611, *"AP awards lock your history — buys
made before an award can't be undone"*). A DM-marked event should behave the same way. Note CharGen's
undo is snapshot-based rather than LIFO, so it needs its own guard — the two tools do not share a
mechanism here.

### Drawbacks — settled 2026-08-05

**Imposing a drawback gives the player no AP, and their power level still drops.** The owner's worry was
that a drawback with no points attached would be invisible when comparing characters. Measured — it is
not, because the two figures come from different sources: `compute().total` prices the drawback from the
character's `drawbacks` list against the rules table, while spendable AP comes from the recorded event
cost. Recording a DM-imposed drawback at **cost 0** therefore gives both halves at once, with **no engine
change**:

| drawback worth 2 | spendable AP | power level | drawback ledger line |
|---|---:|---:|---:|
| player takes it normally | 81 (+2) | −2 | −2 |
| DM imposes it (cost 0) | 79 (unchanged) | −2 | −2 |

This makes the model symmetric with boons, and the whole thing states in one line: **a DM edit moves the
character's power level without touching their wallet.** A granted boon raises it (the DM supplies the AP
to pay for it); an imposed drawback lowers it (the DM withholds the AP it would normally pay).

**Removal has two INDEPENDENT settings** (owner: *"There are actually two states. One state is locked or
unlocked for removal. The second is the actual removal cost which is either flat or expensive."*):

1. **Locked / unlocked** — can this drawback be removed at all?
2. **Removal cost, when unlocked** — **flat** (the drawback's table value, e.g. 2) or **expensive**
   (3× the table value, e.g. 6 — the rate players already pay). **Flat is the default.**

Even when unlocked, the player always spends AP to remove it; there is no free removal.

**Why flat is the right default**, since it differs from today's rule and someone will ask. The existing 3×
exists to deter treating a drawback as a cheap AP loan and then buying out. That deterrent does not apply
to a drawback the DM imposed — no loan was made. Under a flat 3× the arithmetic actually inverts:

| drawback worth 2 | got | pays to remove | net AP |
|---|---:|---:|---:|
| chose it, then bought out | +2 | −6 | **−4** |
| DM imposed it, removed at 3× | 0 | −6 | **−6** |

— i.e. the punished player ends up worse off than the one who gamed the system. Flat removes that: you
lost 2 AP of power, you spend 2 to get it back, one-for-one. Expensive stays available for a DM who wants
the drawback to bite.

**The DM chooses whether a drawback can be bought off.** `buyoffDrawback(v)` (Live Sheet ~:603) currently
takes only the drawback name and prices it from `DATA.drawbacks` — there is nowhere to express "this one
is locked". The flag therefore belongs on the drawback **event**, and `buyoffDrawback()` must consult the
LOG rather than `DATA` alone. Buy-off must be refused with a reason, not silently hidden, or a player will
think the app is broken.

**Concurrent edits — still open, owner unsure.** Four routes, cheapest first:

- **A. Last-write-wins** (today's behaviour). Free, and silently destroys whichever side saved first.
  Not acceptable for a DM writing to a character its owner may have open.
- **B. Optimistic check on `updated_at`.** The column already exists and is already selected
  (`js/sync.js:172`). Read it on open, send it with the write, reject if it moved, tell the DM to reload.
  Cheap, no silent loss, needs a retry path. **Recommended as the first implementation.**
- **C. Merge the two logs.** The right answer for this data model — a character IS an event log, so two
  independent appends usually reconcile by `seq`/`ts` rather than conflicting at all. More work, and the
  `stats` column being a single blob means the merge has to happen tool-side before the write.
- **D. Lock the character while a DM has it open.** Needs presence tracking and a way to break a stale
  lock; heaviest, and it fails badly offline.

Worth deciding B-vs-C explicitly rather than drifting: B is a guard, C is the actual fix, and B does not
block C later.

### The DM does not remove drawbacks (owner, 2026-08-05)

*"The DM should not remove drawbacks — instead they should just award the APs to let the player do it
themselves."*

This removes an operation from the design rather than specifying one, and it dissolves the open question
that was here (whether removing a player-taken drawback should claw back the AP it originally paid): the
DM never removes it, so nothing is clawed back.

What the DM does instead is **award AP**, which already exists and needs no new mechanism. The player then
uses the ordinary buy-off path at whatever price the drawback carries. Two consequences worth holding:

- **The removal-cost setting becomes the DM's real lever.** Locked means never; unlocked at flat means the
  player pays the drawback's value; unlocked at expensive means 3×. The DM decides the price and whether
  to fund it — they do not reach in and delete.
- **It composes cleanly.** A DM imposes a drawback worth 2 at cost 0, unlocked/flat. Later they decide the
  character has earned their way out, so they award 2 AP; the player spends it buying the drawback off and
  is exactly where they started. No special case anywhere in that sequence.

**Scope now:** DM edits are ADD-only for drawbacks — the DM awards AP and the player buys the drawback
off. Boons are different, because a player has no way to sell a boon back, so there is no player-side
route to hand it to.

### Removing a boon (owner, 2026-08-05) — the DM can, and the player loses the AP

*"The DM can remove the player-bought boon and the player effectively loses the AP."* No refund, whether
the DM granted the boon or the player paid for it themselves.

**This is consistent with the neutrality invariant rather than an exception to it.** The player already
spent the AP; not refunding it means their spendable total does not move, while their power level drops
by the boon's value. Same one-line rule as everything else here: *a DM edit moves the character's power
level without touching their wallet.*

**The mechanism matters, and the obvious implementation is wrong.** Removal must NOT delete the original
buy event. Measured on a 25 AP boon:

| | spent | available | power |
|---|---:|---:|---:|
| player bought it | 25 | 75 | 25 |
| **if the buy event were deleted** | 0 | **100** | 0 |

Deleting refunds the AP — exactly what the owner said must not happen. Removal has to **suppress the boon
in the fold while leaving its cost in `spent`**.

There is already a mechanism shaped like this: `buyoff`. `activeEvents()` collects `boughtOff[refVal]`,
`_replay()` skips the matching drawback buy, and `_economyFrom()` drops its earned AP. A boon removal
wants the same *shape* with a different economy rule — skip it in `_replay`, but leave `_spendCost()`
alone so the AP stays spent. Note that is genuinely different from `buyoff`, which removes both the build
effect and the AP; do not reuse the drawback branch verbatim.

**There is no boon-removal path in the engine today** — `MUT.boon` only pushes, and `boughtOff` handles
drawbacks alone. This needs a new event type or marker plus a skip in `_replay`, which makes it the one
part of stage 2 that touches `js/engine.js`.

```text
1. DO NOT START until feat/chargen-dm-view has landed. Scope is now fully settled: drawbacks are
   ADD-only (the DM awards AP, the player buys off); boons can be added AND removed, with no refund on
   removal. Concurrency is handled by its own tasks - fix/optimistic-character-save (NOW) and
   feat/character-log-merge (LATER) - so this one does not need to solve it, only to not fight it.
1b. Boon removal is the ONLY part of this task that touches js/engine.js: it needs an event that skips
   the boon in _replay() while leaving its cost in _spendCost(). Verify against a fixture that spent and
   available are UNCHANGED by the removal and only the power level moves - that is the whole point, and
   the naive implementation (deleting the buy event) gets it backwards.
2. Implement neutrality as ONE invariant - a dmEdit event contributes 0 to spendable AP - not as two
   separate rules for boons and drawbacks. Assert it directly: for any DM edit, economy().available
   before == economy().available after.
3. Marker shape: a field on the event rather than a new event type, so every existing replay path keeps
   working untouched. Check it against economy()/_replay()/_spendCost() before committing to it.
4. Undo barrier: copy the award-event pattern in the Live Sheet; give CharGen its own guard, since its
   undo restores whole-LOG snapshots rather than popping the last event.
5. TWO flags on the drawback event, not one: locked/unlocked, and flat/expensive removal cost.
   buyoffDrawback() (Live Sheet ~:603) currently reads only DATA.drawbacks and hardcodes refund*3, so it
   must consult the LOG for both. A locked drawback refuses with a stated reason rather than hiding the
   button - a hidden control reads as a broken app.
5b. Impose a drawback by recording the buy event at cost 0. Verified this needs no engine change: the
   power-level hit comes from the drawback being in the build, the AP handout from the event cost, and
   the two are already independent. Assert both in the same test, or a later refactor will merge them.
6. Both tools' ledgers must render a DM-marked event distinctly - the whole point is that the player can
   see what their DM changed.
7. RLS: a DM writing to a character they do not own is a policy change. Run the Supabase advisor
   (get_advisors) and check the logs afterwards - this project has been bitten twice by grant/RLS drift
   (D-GH15, D-GH12).
```

**Done when:** a DM can add/remove boons and drawbacks on a roster character, each change is recorded in
the log as a DM edit and rendered as such in both tools, the open questions above are answered in a
decision record, and the RLS change passes the advisor.

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
