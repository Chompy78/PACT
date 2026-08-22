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

## Duplicate class-unlock (and arts/boons/sub-ability) events double-charge AP — TODO
Branch `fix/engine-pricing-edge-cases` (bundle with the two engine findings on NOW — same `DATA.version`
bump). `js/engine.js:344, 357-359`. Unlike proficiency lists (deduped every replay via `_dedupeProfLists`)
and features (explicit "already bought" `fcount[lab]` guard), `unlockedClasses`/`arts`/`boons`/
`subAbilities` sum raw array entries with no ownership check. A second identical unlock event charges a
full extra 8 AP even though the *gating* logic elsewhere already treats it as one class — pricing and
gating disagree on the same data. Live Sheet's own `DUP_FIELD` dup-guard table doesn't cover `unlockclass`
either; the buy panel's protection there is display-only (hiding the already-owned option).

**Effort:** low · **Risk:** low — ambiguity is low for `unlockedClasses` specifically (the fix is
"extend `_dedupeProfLists()` to cover it, same pattern as the nine lists it already dedupes"); `arts`/
`boons`/`subAbilities` need a deliberate decision on whether they're meant to be re-buyable before
touching them — don't assume no just because unlockedClasses clearly should dedupe.

```text
1. Extend _dedupeProfLists() (js/engine.js:792-795) to also cover unlockedClasses — this is the one with
   a demonstrated, unambiguous double-charge.
2. Decide deliberately (record in DECISIONS.md) whether arts/boons/subAbilities are meant to be
   re-buyable; only extend the dedupe to them if the answer is no.
3. Parity fixture: a duplicate unlockclass event for an already-unlocked class must not increase
   compute() total. Bundle the DATA.version bump with the other two engine findings on NOW.
```

**Done when:** a duplicate `unlockclass` event no longer double-charges; the arts/boons/subAbilities
question is answered and recorded; a parity fixture pins the unlockedClasses case; bundled version bump.

## DM Console has no UI to see or revoke an already-redeemed co-DM's access — TODO
Branch `feat/dm-console-codm-revoke-ui`. `tools/DM-Console.html:2652` (imports) — pulls in
`createDmInvite`/`redeemDmInvite`/`listCampaignInvites`/`setInviteRevoked` but never `removeDm`/
`getCampaignDms`, both of which already exist and are exported from `js/campaign.js` (verified: grep for
either across the whole file returns nothing; grep of `js/campaign.js`'s exports confirms both are
implemented and unused). The console lets a DM withdraw an *unredeemed* invite, but once someone has
actually redeemed one and joined `campaign_dms`, there is no way to see who currently has DM access to a
campaign or remove them. Given this project's own history with the invite/join privilege-escalation bug
(hardened, see `fix/harden-invitation-system` in `CHANGELOG.md`), this is a real follow-on gap: even after
hardening issuance, a campaign owner has no console control to undo a mistaken or compromised grant.

**Effort:** medium · **Risk:** low — the backend RPCs already exist and are presumably already correctly
gated (owner-only) since they were built for this purpose; this is UI wiring, not a new security surface.
Confirm the gating on `removeDm` server-side before shipping the button regardless — don't assume from the
function's existence alone.

```text
1. Confirm removeDm()'s server-side authorization (owner-of-campaign only) before wiring a UI to it —
   check the RPC/RLS it calls, not just the JS function signature.
2. Add a "Co-DMs" list to the campaign panel (via getCampaignDms), gated the same way existing owner-only
   controls in this file already are.
3. Add a "Remove" action per entry (via removeDm), with a confirm() given this revokes real access.
4. cloud-e2e or a manual signed-in verification: a removed co-DM's session loses DM access immediately
   (or on next auth check, whichever this project's session model actually provides — confirm, don't
   assume).
```

**Done when:** a campaign owner can see every current co-DM and remove one, the removal is confirmed
server-side authorized, and removal is verified to actually revoke access (not just hide the row).

## "Archived campaign is read-only" is enforced client-side only — the DM-write RPCs have no matching check — TODO
Branch `fix/archived-campaign-rpc-enforcement`. `tools/DM-Console.html:2299-2305, 2545-2548` plus six more
`_dmPeekActive`-style guard sites scattered across click handlers. Cross-checked against the actual
backend: `award_ap()` (`sql/migrations/2026-06-29-codm-ap-ledger.sql`) checks only `is_campaign_dm()` —
no `archived_at IS NULL` condition — and `is_campaign_dm()`/`is_campaign_owner()` in
`sql/rls-policies.sql` likewise never reference `archived_at`. Every write action while peeking an
archived campaign is blocked purely by scattered `if(window._dmPeekActive && ...) return;` checks in this
file's click handlers, not by anything the server itself enforces. Lower severity than a cross-user issue
(the only actor who can reach this state — a campaign's own DM/co-DM — already holds full RPC authority
over the campaign), but "archived = safe to browse" is a client convention today, not an invariant — it
would not survive a stray direct call or a future click-handler refactor that misses one of the several
guard sites this pattern requires remembering.

**⚠ Do not implement without running `/make-code-cold-plan-review` first.** This is a production
RLS/RPC change on the same security boundary the invitation-system and DM-creation-lock work already
treats as high-risk (AGENTS.md: "RLS is the only real security boundary"). Deferred from this audit sweep
for that reason — the mechanical/UI-only findings in this batch were fixed directly; this one needs its
own dedicated pass with Supabase advisor verification, not a same-session bundle fix.

**Effort:** medium · **Risk:** high — ambiguity is low on the mechanism (add `archived_at is null` to each
DM-write RPC) but damage scale is high (any mistake here is a production RLS/RPC change); damage
likelihood is low-medium (the advisor catches shape but not intent, and this project's RLS/grant drift has
bitten it before per D-GH15/D-GH12). **Not sweep-eligible.**

```text
1. Inventory every DM-write RPC (award_ap, dm_edit_character_log, set_ignore_player_ap, declare_downtime,
   set_campaign_rules, and any others touching campaign/character state) and confirm which lack an
   archived_at check — don't assume the four named above are the complete list.
2. Add archived_at is null to each, as a migration.
3. After the migration, run the Supabase advisor (get_advisors) and skim get_logs before opening the PR —
   this project has been bitten twice by grant/RLS drift the advisor catches for free (D-GH15, D-GH12).
4. Verify signed-in: an archived campaign's DM cannot award AP / edit a character log / change settings
   via a direct RPC call, not just through the (already-correct) client UI.
5. Confirm no LEGITIMATE workflow needs to write to an archived campaign (e.g. un-archiving itself must
   still work) — the check must exempt whatever RPC actually un-archives a campaign, if any.
```

**Done when:** every DM-write RPC rejects a write against an archived campaign server-side, verified by a
direct signed-in RPC call (not just through the UI); the Supabase advisor reports no new findings; the
un-archive path (if any) still works.

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
original wording, and parity still reports 0 failed.

---

## Signed-out invite banner still can't distinguish a dead link from a live one — TODO
Branch `feat/invite-peek-signed-out-banner`. Remainder of the 2026-08-04 finding after
`feat/invite-peek-campaign-name` shipped (2026-08-10): `peek_player_invite(token)` now lets CharGen name
the campaign in its accept `confirm()` and catch a dead token before ever showing that prompt — but only
once the player is signed in. Signed OUT, a revoked/expired invite link still looks identical to a live
one, because `peek_player_invite` was deliberately scoped `authenticated`-only
(`D-GH-2026-08-10-invite-peek-auth-scope`) rather than anon-callable, to avoid an unrate-limited token-probe
surface. **Blocked on `feat/invite-rate-limiting`** landing first — that is what would make an
anon-callable lookup a deliberate, safe decision rather than reopening the exact hole this one avoided.
**Effort:** small (once unblocked) · **Risk:** medium — the auth-scope call was already made deliberately
in D-GH-2026-08-10-invite-peek-auth-scope; this task is "make it anon-callable now that rate limiting
exists," not a fresh design question. Not sweep-eligible — sequenced behind another task.

```text
1. Confirm feat/invite-rate-limiting has actually landed and covers RPC-level probing, not just invite
   generation/redemption, before starting.
2. Widen peek_player_invite's grant to anon (or add a second, anon-scoped variant if the rate-limit
   mechanism needs a distinct code path) — record the change as an amendment to
   D-GH-2026-08-10-invite-peek-auth-scope, not a fresh decision.
3. Make the signed-out banner in tools/PACT-CharGen-Webtool.html's tryRedeem() call it and distinguish a
   dead invite from a live one, mirroring the signed-in copy already shipped.
4. Add cloud-e2e coverage for a revoked token and a valid one, both signed out.
```

**Done when:** the signed-out banner distinguishes a dead invite from a live one, the widened auth scope
is recorded as an amendment to D-GH-2026-08-10-invite-peek-auth-scope, and `cloud-e2e` covers both token
states signed out.

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

## Record which of D1/D2 governs a pre-lock level-up — the divergence itself is GONE — TODO
Branch `docs/prelock-pricing-rule`. **Re-measured 2026-08-19 on v0.356: the divergence does not
reproduce.** This was filed as a live bug needing an owner rules ruling *before any code*; the code
question has since answered itself, and what remains is a docs task.

The original report (2026-08-05) measured a fresh Live Sheet character under the 79 AP threshold whose
ledger read **34 against `compute()`'s 46** after one level-up, and **44 against 83** by HD 5. Re-run
through the real tool on v0.356, driving `buy()` directly:

| sequence | ledger | `compute()` | drift |
|---|---|---|---|
| Grit at HD 1, then level to 5 | 15 | 15 | **0** |
| level to 5 first, then Grit | 15 | 15 | **0** |

Zero drift in both orders. The Live Sheet still does **not** call `repriceDraft()` (checked), so this was
not fixed by adopting D2 — one of the pricing branches that landed after 5 Aug made the two rules stop
producing different numbers, rather than one of them winning. Which branch did it has not been traced.

**Effort:** low · **Risk:** low — no behaviour changes; it is a decision-record edit. Downgraded from
high, which was correct while a live 44-vs-83 divergence was believed to be sitting in the tool.

**Already done, so don't redo it:** step 5 of the original task (assert the case rather than remember it)
shipped on 2026-08-19 — `tool-pricing-ci.mjs` now drives a pre-lock character through level-ups in both
purchase orders and asserts `economy().spent === compute().total`. It was 141 → **143** checks. That gate
is what stops this silently regressing while the wording question waits.

```text
1. Decide, at leisure, whether D1 or D2 is the STATED rule for a pre-lock level-up. This is now a
   question of what the record should say, not of what the tool does - nothing is broken either way.
2. Amend D-GH-2026-08-05-pricing-model to narrow whichever one loses, so the next agent does not read
   the two as still conflicting. Include the 2026-08-19 re-measurement above, or the closed case will
   be re-reported as a bug by whoever reads the original table.
3. Optional, and worth it if anyone touches draft pricing again: trace WHICH branch closed the gap, so
   the record says why the rules stopped disagreeing instead of just noting that they did.
```

**Done when:** `D-GH-2026-08-05-pricing-model` states which rule governs a pre-lock level-up, and carries
the 2026-08-19 re-measurement showing the original divergence no longer reproduces.

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
0. SCOPE HAS SHRUNK — re-measure before planning a big inventory. Verified 2026-08-05: no tool emits
   `campaignBound` or `creationLocked` (grep across tools/ and js/ outside the engine returns nothing),
   and a character saved before feat/creation-lock-wiring carries no `creationLockConfig` either — so
   `_autoArmed` is false and `isCreationDraft()` returns TRUE for every pre-existing character. They are
   all drafts. CharGen now reprices a draft on LOAD (_cgApplyEnvelope), so every one of them self-heals
   the moment it is opened in CharGen. What is left for this pass is therefore narrower than written
   below: characters that are only ever opened in the LIVE SHEET, which does not reprice at all pending
   the rules answer in fix/livesheet-draft-reconcile. Confirm this still holds before starting.
0b. Both pricing blockers have LANDED (fix/livesheet-context-pricing and fix/species-pack-not-charged, 2026-08-05),
   but one question they raised has not been answered: fix/livesheet-draft-reconcile above decides whether
   a pre-lock Live Sheet character reconciles at all. Settle that FIRST — it changes what "correct" means
   for exactly the characters this pass rewrites. Reconciling against a moving definition is how this began.
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
6. engine-parity must stay at 0 failed and DATA.version must not move — this rewrites data, not rules.
```
**Done when:** the inventory table exists and has been reviewed by the owner, the agreed correction has
been applied to every affected saved character, over-budget outcomes have an owner decision recorded, and
a gate asserts the invariant for corrected characters.

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

## A DM-applied creation lock a player cannot undo (cloud campaign characters only) — TODO
Branch `feat/dm-creation-lock`. Owner, 2026-08-06 — *"ideally but not critical"*, and scoped 2026-08-06 to
**cloud characters that are in a campaign**. That scoping is the whole design, not a detail: a DM lock only
exists where there is a DM, a campaign only exists in the cloud, and a cloud character's row is
server-mediated — so this can be **genuinely enforced** rather than merely honoured by the client.
**Effort:** medium · **Risk:** high — ambiguity medium (the enforcement point is now clear, but the
detach/export edge cases below are genuine judgement calls); damage scale HIGH (it is an RLS/authorization
change on the `characters` table, the app's only real security boundary, and a wrong policy either locks
players out of their own characters or lets them through); damage likelihood medium (the advisor catches
policy shape, nothing catches intent) — worst-of lands at high. **NOT sweep-eligible.**

```text
0. READ FIRST: decisions/2026/D-GH-2026-08-06-creation-lock-survives-reload.md — its Outstanding section
   is this task. Note its trust-boundary worry is RESOLVED BY THE SCOPING, not by argument: the concern
   was "a player can edit their own local LOG", which does not apply to a character whose authoritative
   copy is a server row the player cannot write freely.
1. THE SERVER IS THE ENFORCEMENT POINT, not the LOG. Per AGENTS.md, RLS is the only real security
   boundary; a client-written flag is decoration. So the rule belongs in sql/rls-policies.sql:
   an UPDATE by the character's OWNER must not be able to clear a DM-applied lock while the row's
   campaign_id is set; the campaign's DM must be able to set and clear it.
2. Decide WHERE the lock lives on the row before writing any policy. Two shapes:
   a) a dedicated column (e.g. characters.dm_locked boolean) - trivially checkable in a policy, and
      independent of the LOG's contents. Preferred: an RLS policy cannot reasonably inspect a JSON LOG.
   b) inside the stats envelope - keeps everything in one place but makes the policy parse JSON to
      enforce it, which is fragile and slow. Expect to reject this; say why in the record.
3. The LOG event is then a MIRROR for display, not the source of truth. The tools still want a
   creationLocked event so pricing behaves (js/engine.js:749), but the engine must stay ignorant of
   auth - it compares values, it does not know who a DM is. Stamp provenance on the event for the UI's
   benefit and say plainly in the record that the event is not what enforces anything.
4. EDGE CASES that need an owner answer, not a guess:
   - a DM-locked character is REMOVED from the campaign (campaign_id cleared). Does the lock survive as
     an ordinary lock, or clear? Both are defensible; pick one and record it.
   - a player EXPORTS a DM-locked character to a file and re-imports it locally. The local copy has no
     server row, so nothing enforces it. Is that acceptable (it is now a different, standalone
     character) or must the export refuse/strip? Note the existing precedent:
     D-GH-2026-07-11-clone-campaign-character-standalone deliberately severs the campaign on clone.
   - a character with no campaign_id can never be DM-locked. Confirm the UI never offers it.
5. DM Console has NO lock UI at all today (grep: creationLocked appears 0 times in tools/DM-Console.html).
   That is the whole player-facing half of this task.
6. Back-compat: no existing character has the column/flag, so default it false and every existing
   character behaves exactly as it does now.
7. After any RLS/migration change, run the Supabase advisor (get_advisors) and skim get_logs BEFORE
   opening the PR - AGENTS.md step 4. This project has been bitten twice by grant/RLS drift.
8. Verification needs a signed-in campaign with a DM and a player account; it cannot be covered by the
   dependency-free gate. Say in the PR exactly what was exercised by hand.
```
**Done when:** a DM can lock a campaign character from DM Console, the owning player cannot clear that
lock through the app or by a direct row update (verified signed-in, both roles), a character with no
campaign cannot be DM-locked, the detach and export answers from step 4 are recorded in a
`D-GH-<date>-dm-creation-lock` record, the Supabase advisor is clean, and engine-parity is unchanged.

## Randomize (and shared links) build in canonical order, not purchase order — TODO
Branch `feat/randomize-emits-in-order`. Successor to the ordering half of `feat/creation-vs-awarded-ap`,
after the interactive and undo/redo paths were fixed (2026-08-06, PR #373 and the addendum in
`decisions/2026/D-GH-2026-08-06-creation-lock-survives-reload.md`).
**Effort:** medium · **Risk:** medium — ambiguity medium (mapping ~30 randomizer mutations to event shapes
is mechanical but each needs the right category and cost, and a wrong one mis-prices a character); damage
scale medium (one tool, revertable, but it rewrites how a whole character is constructed); damage
likelihood low (tool-pricing drives CharGen over CDP and the parity gate covers the engine) — medium.

```text
0. SCOPE — read this before assuming there is more to do than there is. Purchase order is ALREADY correct
   for the paths that matter, verified 2026-08-06:
     - interactive building: emit() appends in click order and does NOT tag noLock, so the creation lock
       lands exactly where cumulative spend crossed the threshold.
     - native save/load: _cgApplyEnvelope reinstates the saved LOG verbatim (D-GH40), so order survives.
     - undo/redo: restoreFrame() now reinstates the frame's LOG verbatim too.
   What is LEFT are the paths where the character arrives whole and no click order ever existed:
     randomize, the shared "#b=" link, and legacy flat-file import.
1. Only RANDOMIZE can be fixed honestly. A shared link and a legacy file carry a flat build with no
   sequence in it - there is nothing to recover, and inventing one would be a lie dressed as data. Decide
   explicitly whether those two keep today's behaviour (whole build creation-priced, lock appended after)
   and SAY SO in the record rather than leaving it implied.
2. randomizeRoll() (~tools/PACT-CharGen-Webtool.html:3407) already HAS a real sequence: it applies ~30
   mutator lambdas in a random order until the budget is spent. That order is as genuine as a generated
   character can have. The work is emitting one event per applied mutator instead of mutating a flat
   build and bursting at the end.
3. The actual cost is the mapping. Each lambda mutates the build directly - x.skills.push(s),
   x.stats[a]+=2, x.traditions.push(...) - and each needs the matching event shape and cost
   ({cat:'skill',payload:{v:s}}, {cat:'abil',payload:{ab:a,to:N}}, ...). Roughly 30 of them. Do not
   guess a category: check each against MUT in js/engine.js.
4. PERFORMANCE - measure before and after. emit() calls _cgRepriceDraft(), which replays the whole log;
   doing that per event across ~50 events is O(n^2). If it is slow, batch the repricing to the end rather
   than abandoning the ordering.
5. Gate it in testing/scripts/tool-pricing-ci.mjs: after a randomize that spends past the threshold, the
   creation lock must sit at the purchase where cumulative spend crossed it, not at the end. Prove the
   assertion fails against the current burst-based implementation before trusting it.
6. Display/state only - no compute() change expected, so do NOT bump DATA.version; confirm rather than
   assume, and keep engine-parity at its current count.
```
**Done when:** a randomized character over the creation threshold has its `creationLocked` event at the
purchase where spend crossed it rather than appended after everything, the shared-link and legacy-import
answers from step 1 are recorded, a gate asserts the randomize case, and engine-parity is unchanged.

## Duplicate non-stacking purchases are charged in full — TODO
Branch `fix/non-stacking-duplicate-charge`. `js/engine.js` (`compute()`'s feature pricing).
**Effort:** medium · **Risk:** medium — ambiguity is the driver (what "the same feature from two classes"
means needs defining before it can be priced, and the answer decides whether this is a refund or a
block); damage scale is low (it overcharges rather than undercharges, so nobody gained anything); damage
likelihood low (it needs a multi-class build at T4+ to reach at all).

Found 2026-08-18 while building `testing/scripts/sim-combat-abuse.mjs`, and **recorded nowhere until
now** — it lived only in a simulation's source comments, which is exactly the failure mode
`AGENTS.md`'s "log as you go" section exists to prevent.

A character who buys the *same non-stacking* feature from two different classes — Extra Attack being the
clearest case — is charged **in full both times** while receiving the benefit once. The optimiser hit
this hard enough that it had to be special-cased: it bought all six classes' Extra Attack for 102 AP on a
Rogue because raw summed Tier counted them as +24, and the sim now carries a `NON_STACKING` group list to
stop metric-gaming. That list is a **simulation-side workaround for an engine-side gap** — the engine
itself has no concept of a non-stacking group.

Not urgent: it cannot be reached below **tier 4**, and it costs the player rather than the table, so no
character is currently over-powered by it. It is a real overcharge on a legal build, though, and the
first person to notice it will be someone who paid twice.

```text
1. Define the rule FIRST: is a second copy of a non-stacking feature (a) barred outright, (b) free,
   or (c) charged at some reduced rate for the class-access it also confers? Ask the owner - the guide
   does not currently say, which is itself part of the finding.
2. The grouping belongs in DATA, not in compute() and not in a sim: a named non-stacking group per
   feature family, the same shape sim-combat-abuse.mjs's NON_STACKING already uses. Move that list into
   the dataset rather than maintaining a second copy.
3. compute() reads the group and applies the rule from step 1.
4. This CHANGES compute() output: update testing/expected/ in the same PR and bump DATA.version. Add a
   parity fixture buying the same non-stacking feature from two classes.
5. The Players Guide must land it too - a pricing rule that exists only in the engine is half-done
   (AGENTS.md, "A mechanics change isn't finished until the engine AND the guide land it").
```

**Done when:** the owner's rule is recorded; the non-stacking groups live in `DATA` with the simulation
reading them rather than holding its own copy; `compute()` applies the rule; a parity fixture pins a
duplicate purchase; the guide states the rule; `DATA.version` bumped and `testing/expected/` updated in
the same PR; engine-parity **0 failed**.

## Security audit: privilege boundaries + character/AP integrity against a malicious client — TODO
Branch `security/privilege-and-character-integrity`. Owner request, 2026-08-08. Assume the attacker has
the full frontend source, the Supabase URL, the publishable key, complete control of browser JS/
localStorage, and calls Supabase directly — every finding must be verified at the RLS/RPC boundary, not
just in the UI. **Explicitly excludes the invitation system** — `docs/TASK_BOARD_NOW.md`'s
`fix/harden-invitation-system` already owns that surface; do not touch `campaigns.dm_invite_code`,
`campaign_invites`, or `joinAsDm`/invite RPCs from this task.

**Not green-field — audit before assuming a gap exists.** Several of the asks below already have a
documented answer or a partial existing task; confirm the real state (read the actual RLS/RPC, per
AGENTS.md's "verify before writing an absence claim") before treating anything here as a fresh finding:
- `ap` is already documented as server-authoritative, DM-only, never overwritten by a local push
  (`AGENTS.md` File & data map) — audit whether that's actually *enforced* in `sql/rls-policies.sql`/RPCs
  or only true by convention.
- `characters_update`'s RLS already requires `owner_id = auth.uid()` in both `USING` and `WITH CHECK`
  (confirmed via `grep -n "owner_id" sql/rls-policies.sql`) — so raw ownership reassignment is already
  blocked, and `feat/character-ownership-claim-link` (shipped 2026-08-11, deliberately as a COPY into a
  new player-owned row rather than a transfer — see `D-GH-2026-08-11-character-claim-link-copy-not-
  transfer`) never needed to touch this boundary at all. `create_character_claim`/`redeem_character_claim`
  are new SECURITY DEFINER RPCs, though — confirm they're correctly gated (owner-of-source AND DM-of-
  campaign to create; single-use, idempotent-on-repeat to redeem) and that no other path in this audit
  reopens what that redesign closed.
- DM-applied creation-lock enforcement is already scoped as its own task, `feat/dm-creation-lock` (below)
  — its "server is the enforcement point, not the LOG" framing is exactly this task's model; don't
  re-derive the lock design here, cross-check against it instead.
- `feat/ap-model-reconcile` (shipped 2026-08-10, `D-GH-2026-08-10-ap-model-reconcile`) already covers the
  *display* divergence between `compute()` and the frozen ledger; this task covers whether a malicious
  client can *create* that divergence server-side — related, not overlapping. Sequence awareness, not a
  merge.

**1. Role boundaries (Owner / DM / Player) — audit and enforce server-side, don't introduce new roles.**
Do not add finer-grained roles unless the audit finds a concrete vulnerability that requires it. For each
of: DM transferring campaign ownership, DM accessing another campaign, player escalating to DM/Owner,
campaign-membership checks, DM-only operations — confirm the enforcement is a `SECURITY DEFINER` RPC or
RLS policy check, not a UI gate. Do not reduce any *legitimate* DM capability while doing this.

**2. Character/AP integrity — treat all browser state as untrusted.** Confirm server-side (RLS/RPC, not
just `engine.js` — the engine is called client-side and proves nothing about a raw API call):
- AP cannot be set/increased directly by a player write; AP changes require an authorised RPC.
- AP cannot go negative or be set arbitrarily via a crafted request.
- Frozen ledger / LOG history cannot be rewritten or deleted by an UPDATE once persisted.
- Purchase prices in a saved character cannot be client-supplied — pricing must be derivable/verifiable
  from `compute()`, not trusted as sent.
- A locked/finished character cannot be mutated via a direct API call once locked.
- A character cannot move between campaigns except through an authorised path.
- LOG events cannot be replayed/duplicated to double-grant purchases, rewards, or AP.
- Creation-lock rules cannot be bypassed by client-constructed state (cross-check `feat/dm-creation-lock`).
- Species/heritage/2nd-origin pricing cannot be gamed via a hand-crafted LOG.
- A malformed/forged LOG cannot produce a cloud character that persists.
Preserve the invariant **`sum(frozen event costs) == compute().total`** for valid finished characters —
audit whether the server can currently accept a saved character where these disagree, and if so, close
that specific gap (don't build new validation infrastructure beyond what closes the actual gap found).

**3. Campaign-rule integrity.** Audit whether a DM changing campaign rules (starting AP, pricing gates,
species/heritage rules, creation restrictions) can silently reprice or invalidate *existing* characters.
If retroactive application is intentional design, preserve it and say so; if not, confirm existing
character history is immune to a later rule edit.

**4. Cloud/client trust boundary — the general sweep.** For every operation currently protected only by
client-side logic (JS checks, UI hiding) touching AP, LOG/event data, character locking, campaign IDs,
ownership, DM permissions, or character↔campaign relationships: move real enforcement to
PostgreSQL/RLS/RPCs where it's missing. Where enforcement already exists, this step is "confirm it," not
"rebuild it."

**5. Adversarial tests.** Add/extend the automated security suite proving each of: no player privilege
escalation; no cross-campaign read/write; no direct AP manipulation; no forged purchase prices; no event
replay/duplication; frozen ledger immutable; locked characters immutable via API; campaign
reassignment properly authorised; DM cannot transfer ownership (unless a task explicitly adds that
capability); malformed event/state payloads rejected; `compute().total` == frozen-ledger total holds;
existing legitimate Owner/DM/Player workflows still pass. Run the full existing test/security suite
alongside the new tests — a regression here is exactly what this task must not cause.

**Effort:** high · **Risk:** high — ambiguity is high (this is an open-ended audit across RLS, RPCs, and
three tools with several sub-areas that may turn out to already be enforced correctly, so scope only
firms up once findings land); damage scale is high (touches the same core auth/character/campaign schema
and RLS surface as the invitation-system and ownership-transfer tasks); damage likelihood is medium (this
project's RLS/grant drift has bitten it twice before per D-GH15/D-GH12, and the class of bug this task
hunts for — client-trusted state — is exactly what those incidents were) — worst-of lands at high, **never
eligible for `/sweep-code-tasks`**. **Run `/make-code-cold-plan-review` before implementing any fix** this
audit turns up that touches RLS/RPCs/schema — it meets AGENTS.md's own trigger (security-critical,
multi-file, real design trade-offs, and a wrong approach costs more than one cycle to undo). The audit
*itself* (read-only investigation, no schema change) does not need the cold review; a fix does.

```text
1. Inventory every RPC and RLS policy touching characters/campaigns/ap_awards (sql/schema.sql,
   sql/rls-policies.sql, sql/migrations/) and classify each security-sensitive operation as
   "server-enforced" or "client-trusted-only" — this classification IS the audit's deliverable before any
   fix is written.
2. For each "client-trusted-only" finding, confirm it's real by attempting the bypass against a live
   Supabase call shape (not just reading code) — the same standard the invitation-system finding used
   ("verified by reading the actual schema/RLS on preview, not assumed").
3. Cross-check every finding against the three related tasks named above (fix/harden-invitation-system,
   feat/dm-creation-lock, feat/character-ownership-claim-link, feat/ap-model-reconcile) before writing a
   new fix — don't duplicate work already scoped elsewhere on the board.
4. For confirmed gaps, design the smallest RLS/RPC change that closes them — do not introduce new roles,
   new tables, or broader schema changes than the specific gap requires per the Acceptance criterion.
5. Write the adversarial test suite (Section 5) covering every confirmed gap plus the invariants listed
   even where no gap was found, so regressions are caught going forward.
6. After any RLS/RPC/migration change, run the Supabase advisor (`get_advisors`) and skim `get_logs`
   before opening the PR — this project has been bitten twice by grant/RLS drift (D-GH15, D-GH12).
7. Run the full existing test/security suite plus the new adversarial tests; fix regressions before
   declaring done.
8. Document every finding (confirmed gap, closed or deliberately deferred) and every intentional trust
   assumption in DECISIONS.md — including where the audit confirmed something was ALREADY correctly
   enforced, so a future session doesn't re-audit the same ground from scratch.
```

**Done when:** every item in Sections 1–4 has been checked against live RLS/RPC behaviour (not just code
review) and is either confirmed already-enforced or has a merged fix; the adversarial test list in
Section 5 passes; `sum(frozen event costs) == compute().total` holds for every path that can produce a
saved cloud character; the Supabase advisor reports no new findings; `testing/tests/engine-parity.html`
is unaffected (0 failed); all findings and trust assumptions are recorded in `DECISIONS.md`; no
invitation-system file (`campaigns.dm_invite_code`, `campaign_invites`, invite RPCs) was touched by this
task.

## Rate limiting / abuse protection for invite generation and redemption — TODO
Branch `feat/invite-rate-limiting`. Split off from `fix/harden-invitation-system` (TASK_BOARD_NOW.md) per
its cold-review Decision 4 — see `docs/plans/2026-08-08-harden-invitation-system.md`'s "Decisions" section
and its `z-cold-reviews/` files, where all 6 reviewers independently agreed rate limiting shouldn't gate
the core RLS/token fix: once DM invites move to 128-bit tokens, brute-forcing them directly becomes
infeasible, so the remaining value of rate limiting is abuse/DoS protection on invite generation and
redemption RPCs, not closing the core escalation path. No rate-limiting or abuse-tracking mechanism exists
anywhere in this project's schema or policy files today (confirmed by inspection while drafting the
invitation-system plan) — this is new ground, not an extension of an existing pattern.
**Effort:** medium · **Risk:** medium — ambiguity is medium (whether Supabase's platform-level rate
limiting already covers arbitrary RPC calls, as opposed to auth-specific endpoints, is genuinely
unconfirmed — the answer determines whether this needs new application-level infrastructure at all);
damage scale is low (additive — a new attempt-tracking mechanism, no changes to existing invite/campaign
logic); damage likelihood is low (a rate-limiting gap fails open to "no limit," the pre-existing status
quo, not a new failure mode) — not sweep-eligible given the unresolved platform-verification step, but
low risk once that's answered.

```text
1. FIRST: verify whether Supabase's project-level configuration already throttles arbitrary RPC/PostgREST
   calls (not just auth endpoints like signup/login/OTP) — this determines the rest of the task's scope.
   Check the live project's configuration/advisor output, don't assume from documentation alone.
2. If platform-level throttling is confirmed sufficient for the invite generation/redemption RPCs, this
   task is mostly a verification + documentation task: confirm coverage, record the finding in
   DECISIONS.md, done.
3. If not sufficient, design a minimal attempt-tracking mechanism (e.g. a small table keyed by caller +
   action + time window, checked at the top of the invite-generation and invite-redemption RPCs) —
   race-safe under concurrent requests, matching this codebase's existing atomic-claim discipline
   (UPDATE ... WHERE ... RETURNING) rather than a check-then-act pattern.
4. Cover both directions: generation (a DM spamming invite creation) and redemption (an attacker hammering
   the redemption RPC to brute-force or enumerate tokens) — these may need different thresholds.
5. Add adversarial test coverage: N rapid requests from one caller are throttled after the configured
   threshold; legitimate, well-spaced usage is never blocked.
6. Run the Supabase advisor (`get_advisors`) after any schema/policy change; this project has been bitten
   twice before by grant/RLS drift the advisor catches for free (D-GH15, D-GH12).
7. Record the platform-vs-application-level decision and its reasoning in DECISIONS.md.
```

**Done when:** either platform-level rate limiting is confirmed to cover invite generation/redemption RPCs
(documented, no new code needed), or a new race-safe attempt-tracking mechanism is in place and covered by
adversarial tests proving both that abuse is throttled and legitimate use isn't blocked; the decision is
recorded in `DECISIONS.md`; the Supabase advisor reports no new findings.

## Supabase Edge Function running the real engine.js for AP-budget validation — TODO
Branch `feat/ap-edge-function-validation`. Third of three ideas from the 2026-08-09/10 AP-integrity
external-review batch (`z-cold/` on the `zcold` branch — 7 independent AI reviews synthesized against the
actual code). The other two shipped as one change: `feat/campaign-ap-log-integrity` (a frozen-cost-sum
consistency trigger with a non-regression guard, plus a locked-history append-only protection trigger
scoped to the same boundary Live Sheet's own `undo()` already enforces — the last non-discretionary
`award` event). This is the deferred, lower-priority third leg.

**Why it's lower priority, not higher — confirmed by reading the code, not assumed.** Several of the
external reviews proposed this as the "real"/airtight server-side fix, on the theory that running the
actual `compute()` server-side re-derives correct prices. Checked directly in `js/engine.js`
(`_spendCost()`/`_economyFrom()`, ~lines 617-662): `compute()`/`economy()` only **sum** the frozen `cost`
field already sitting on each LOG event — they never re-derive what a purchase *should* cost from the
action itself. (Only `repriceDraft()` does real re-derivation, and it deliberately no-ops the instant a
log is locked — post-lock prices are supposed to diverge from current rules; that's grandfathering, not a
gap.) So an Edge Function that calls `compute()` server-side gives the exact same guarantee as the SQL
trigger already shipped in `feat/campaign-ap-log-integrity` — both just confirm the client's *declared*
numbers are internally consistent and within server-truth AP, neither proves any individual frozen cost is
*correct*. Its real value is DRY/maintainability (one canonical pricing implementation instead of a second,
hand-written SQL sum that could drift) and broader coverage (could also run `validate()`'s other checks,
not just the budget sum) — not a bigger security boundary than what's already shipped.
**Effort:** medium · **Risk:** low — ambiguity is low (the mechanism — bundle `engine.js` for Deno, call
`compute()`/`validate()` inside a Supabase Edge Function, gate the DB write on the result — is well
understood); damage scale is low (additive: a new Edge Function alongside the existing PostgREST save
path, not a replacement, unless a later decision retires direct client writes); damage likelihood is low
(explicitly deferred — "do only if the SQL-trigger approach proves insufficient in practice," not urgent).

```text
1. Re-confirm the premise before starting: re-check that feat/campaign-ap-log-integrity's two triggers are
   actually proving insufficient in practice (a real bypass observed, not a theoretical one) — this task
   exists to be revisited, not built reflexively once the SQL-trigger PR merges.
2. Bundle js/engine.js for Deno (an ESM re-export wrapper + esbuild bundle, or confirm engine.js is already
   Deno-importable as-is — it's pure JS with no browser globals per the 2026-08-10 review batch, but verify
   directly rather than trusting that claim).
3. New Edge Function (e.g. supabase/functions/validate-save/): fetches authoritative characters.ap and
   campaigns.rules server-side (never trusts client-supplied budget figures), runs the real compute()
   (and optionally validate()) against the client-submitted LOG, rejects the write if over budget or if a
   validate() check fails, otherwise performs the write itself.
4. Client integration: CharGen's and Live Sheet's cloud-save paths call the Edge Function instead of (or
   in addition to, during a transition) a raw PostgREST PATCH on characters.stats.
5. Decide whether to revoke direct client UPDATE on characters.stats once the Edge Function path is proven
   — that's the point where this stops being additive and starts being the primary security boundary.
   Record that decision explicitly; don't let it happen implicitly as a side effect of "the new path works."
6. Run the Supabase advisor (get_advisors) and skim get_logs after deploying the function, per the
   per-change checklist step 4.
```

**Done when:** the premise re-check in step 1 is recorded (with its evidence) before implementation
starts; the Edge Function runs the real, unmodified `engine.js`; a campaign-bound cloud save that would
exceed budget is rejected server-side even when submitted via a raw PATCH bypassing the client UI; the
decision on whether/when to revoke direct client writes is recorded in `DECISIONS.md`; the Supabase
advisor reports no new findings.

## Reconcile guide↔engine rules-version drift (the `documents-rules:` pointer) — MOSTLY DONE, one step left
Branch `claude/merge-pact-guide-version-132ppm`. Mechanism, tooling, and both projects' decision/docs
records shipped 2026-08-12 — see `D-GH-2026-08-12-guide-engine-version-pointer` (full record:
`decisions/2026/D-GH-2026-08-12-guide-engine-version-pointer.md`) and the cold-reviewed plan at
`docs/plans/2026-08-12-guide-engine-version-pointer.md` (4 reviewers, `z-cold/` on branch `zcold`).
Summary: mirrored branch settled as `main`; guide now declares two distinct markers (`content-version`
unchanged, new `documents-rules` — a *reconciliation* assertion, never auto-advanced by a vendor refresh);
`pact-guide`'s canonical file renamed off its version (`PACT-Players-Guide-v0.333.html` →
`PACT-Players-Guide.html`), with its three stale hardcoded references fixed; `pact-guide`'s new
`py/tools/stamp_guide_rules.mjs` (`stamp`/`--check`) implements the pointer; this repo's
`docs/VERSION-SYNC.md` documents the manual, three-way-verified transfer procedure for
`docs/PACT-Players-Guide.html`.

**Still open** (tracked in `pact-guide`'s own `TASK_BOARD.md`, not sweep-eligible from this repo — spans
a project not in this repo): the first real `documents-rules` stamp requires an actual guide-content
reconciliation pass against the live vendored snapshot, deliberately not done blind. Once that stamp
exists, transfer `pact-guide`'s canonical HTML into this repo's `docs/PACT-Players-Guide.html` per the
new `VERSION-SYNC.md` procedure — that transfer is also what corrects this repo's currently-stale
`v0.332` marker. **Effort:** low (the design/tooling work is done) · **Risk:** low — display-only, no
rules-logic or player-data impact.

**Done when:** `pact-guide`'s guide carries a real `documents-rules` marker (not blank), that transfer has
landed in `docs/PACT-Players-Guide.html`, and the three-way check (vendored snapshot ↔ `pact-guide`
canonical ↔ this repo's served copy) passes.

## Seven CI gates never trigger on a `js/engine-data.js`-only change — their path filters watch `js/engine.js` but not its DATA split-out — TODO
Branch `ci/engine-data-path-filters`. `.github/workflows/engine-parity.yml`, `tool-pricing.yml`,
`static-audit.yml`, `chargen-flows.yml`, `dm-console-ui.yml`, `character-gen-e2e.yml`, and `cloud-e2e.yml`
each list `js/engine.js` in their `pull_request: paths:` filter, but none of them list
`js/engine-data.js` — the file REV-14a split `DATA` out into. A PR that touches only `engine-data.js`
(a real, common shape: pricing/feature-table changes, not rules-logic changes) silently skips every one
of these gates, even though `engine-parity.yml` and `tool-pricing.yml` exist specifically to catch
`DATA`-driven `compute()` regressions.

**Observed for real on PR #441** ("unbar Rage/Wild Shape/Bardic Inspiration die", `js/engine-data.js`
only, no `js/engine.js` touch): only `Lighthouse CI` and `Service-worker staleness e2e` ran in CI — the
other seven workflows above never triggered at all. The PR merged green because nothing red ever ran,
not because the relevant gates passed; `testing/tests/engine-parity.html` (52/52) and
`testing/scripts/audit.py` (29/0) were only verified by running them manually before pushing. Confirmed
by reading each workflow file's `on: pull_request: paths:` list directly and cross-checking against the
actual GitHub Actions check-run list for that PR's branch.

**Effort:** low · **Risk:** low — ambiguity is low (add one path line per file, mirroring the existing
`js/engine.js` line already present in each — no new logic); damage scale is low (CI config only, no
app code, no rules, no data); damage likelihood is low (worst case a path is missed and the gap persists
for that one workflow, same as today). Worst-of lands at low.

```text
1. In each of the 7 workflow files, add "js/engine-data.js" to the `pull_request: paths:` list,
   immediately next to the existing "js/engine.js" line.
2. Re-check whether js/ap-by-level.js and js/advancement.js (already listed individually in some of
   these files) should also gain any currently-missing sibling paths while touching these blocks —
   don't expand scope beyond engine-data.js unless a matching gap is found the same way (read the
   file, don't guess).
3. Verify the fix the same way the gap was found: on a scratch branch, touch only js/engine-data.js
   (a no-op whitespace edit is enough) and confirm via `gh`/the GitHub Actions API that the 7 gates
   now appear as queued/running checks on that branch's PR, not absent.
```

**Done when:** all 7 workflow files' `pull_request.paths` list includes both `js/engine.js` and
`js/engine-data.js`; a scratch-branch PR touching only `js/engine-data.js` shows all 7 gates actually
running (not silently absent) in its check list.

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

## refactor/subclass-purchase-unify — one purchase path for everything a subclass sells — TODO
Branch `refactor/subclass-purchase-unify`. Deferred half of AE3 (the pricing half shipped as `DATA.version`
v0.350). Two separate mechanisms currently sell subclass content, and both leak. (1) Spell bundles live in
`DATA.subclasses[…].spellBundle` with their own pricing branch in `compute()`, keyed in the LOG as
`b.subSpellBundles`; subclass abilities live in `DATA.subAbilMap`, keyed as `b.subAbilities`. (2) All **192**
subclass abilities are additionally mirrored into `DATA.features` (188 of them in `featureList`, so CharGen's
*feature* picker offers them alongside its *subclass* picker) — and the two routes have **separate dedup
domains**, so buying the same ability in both pickers charges twice with no warning, skips subclass-unlock
accounting, and bypasses the v0.347 class-access gate entirely.
**Effort:** high · **Risk:** high — ambiguity is high (the `subSpellBundles` LOG field needs either retention
or a migration, and Circle of the Land's four terrain variants are keyed `Class|Sub|Terrain` which doesn't fit
`subAbilMap`'s `Class|Sub|Name` shape); damage scale is high (engine data model + both tools' pickers + the
saved-character format); damage likelihood is medium (the parity/pricing gates catch price drift, but no gate
covers the pickers or LOG round-tripping) — worst-of lands at high, never eligible for `/sweep-code-tasks`.

```text
1. Pre-flight, no code change: confirm whether the DATA.features mirror of subclass abilities is load-bearing
   for anything (search both tools + any fixture for a `Cls: Name` feature key that is also a subclass
   ability). If nothing depends on it, removal is a deletion; if something does, that dependency is the task.
2. Decide the LOG question BEFORE touching data: keep `subSpellBundles` as a distinct field (bundles unify in
   pricing only) or migrate bundle entries into `subAbilities` (true unification, breaks existing saved
   characters). Record the choice as a `D-GH-<date>-subclass-purchase-unify` decision record — this is the
   call that makes the rest mechanical.
3. Resolve Circle of the Land: four terrain bundles, one engine `spellBundle`. Either give each terrain its
   own subAbilMap entry or keep the terrain as a purchase parameter. Whichever, the four must stay separately
   buyable and each must still cost the 15 AP Subclass Unlock beyond the first.
4. Fold bundles into the chosen path; delete the `spellBundle` pricing branch from `js/engine.js`.
5. Remove the 192 mirrored entries from `DATA.features`/`featureList`. Confirm CharGen's feature picker drops
   to real class features only, and that the double-charge is gone by construction.
6. Bump `DATA.version` only if prices move — this task should move none.
```
**Done when:** `testing/tests/engine-parity.html` reports 0 failed; `tool-pricing-ci` and all three guide
checkers stay green; buying the same subclass ability through both routes is impossible (or charges once);
a subclass purchase from a class that is neither origin nor unlocked raises the v0.347 gate warning by
whichever route it is bought; and CharGen + Live Sheet still round-trip a character containing a bundle.

---

## Cache Chromium in the browser CI jobs — an install stall currently reads as a test failure — TODO
Branch `ci/cache-chromium`. Seven workflows run `npx playwright install --with-deps chromium` with no
cache: `character-gen-e2e`, `chargen-flows`, `cloud-e2e`, `dm-console-ui`, `guide-theme`, `sw-cache-e2e`,
`tool-pricing`. Five of them sit inside a `timeout-minutes: 10` budget (`cloud-e2e` has 20,
`character-gen-e2e` 15), so a slow apt/CDN fetch consumes the whole job before any test starts.

**Observed for real on PR #429** (`d89dc1e`, the `v1.429` promotion): `dm-console-ui` spent **605s** on
`Install Chromium` and was killed by the 10-minute timeout with the `DM Console UI checks` step *skipped* —
it reported `cancelled` with three failure annotations while never executing a single assertion. The same
tree passed **96/96** locally and the other ten jobs on that commit went green, so there was no defect to
find; the job that would have found one never ran. A re-run of just that job passed. The hazard is that a
red X from an install stall is indistinguishable at a glance from a red X from a real regression — and the
documented response to a flaky-looking gate is *"verify locally before the first retry"*, which only works
if the difference is visible.

**Recurred three more times the same night, on PR #430** (`e66a301`) — `dm-console-ui` once (605s→timeout,
then a clean re-run) and `e2e` three times in a row (906s, 906s, 907s — each within a second of the job's
own 15-minute wall) before a fourth re-run finally succeeded at ~800s. All three `e2e` failures were on the
exact same commit, which changed nothing but `docs/TASK_BOARD_NEXT.md` — no code content to blame, and every
*other* commit that same workflow ran against that night succeeded. The clustering right at each job's own
timeout, rather than a spread of durations, is the signature of a genuine hang getting killed by the wall,
not a slow-but-real install — a slow install would show variable completion times; a hang looks exactly like
this: fast when the runner's healthy (~100-200s, seen repeatedly the same night), dead at the cap when it
isn't. Four stalls across two PRs in one session is well past "rare" — this should be treated as a live,
recurring cost, not a one-off worth a passive mention.

**Effort:** low · **Risk:** low — ambiguity is low (`actions/cache` keyed on the Playwright version is the
standard pattern, and `PLAYWRIGHT_BROWSERS_PATH` is already how the browser location is controlled); damage
scale is low (CI config only — no app code, no rules, no data); damage likelihood is low (a wrong cache key
simply misses and reinstalls, which is today's behaviour). Worst-of lands at low.

```text
1. Add an actions/cache step to each of the seven workflows above, keyed on the runner OS plus the
   resolved playwright version from testing/package-lock.json, with PLAYWRIGHT_BROWSERS_PATH pointing at
   the cached path. Keep `--with-deps` — the apt half cannot be cached and is cheap; it is the browser
   download that is worth keeping.
2. Consider factoring the install into a composite action under .github/actions/ rather than pasting the
   same block seven times — seven copies is exactly how five of them ended up with the same 10-minute
   budget and the other two did not.
3. Separately from the cache: give the install its own step-level timeout well below the job budget, so
   an install stall fails as "install timed out" instead of consuming the job and skipping the tests.
   This is the part that actually fixes the misdiagnosis; the cache only makes it rarer.
4. Do not raise the job timeouts as the fix on its own — that hides the stall for longer rather than
   distinguishing it from a real failure.
```

**Done when:** a second run of any of the seven workflows restores Chromium from cache rather than
downloading it (visible in the job log), an install that stalls fails at the install step with a message
naming the install — not as a skipped test step — and all seven jobs still pass on a normal PR.

## Live Sheet drawback purchases bypass legalCheck() entirely — no drawback gate is enforced there — TODO
Branch `fix/livesheet-drawback-legalcheck`. `takeDrawback()` (`tools/PACT-Live-Char-Sheet.html`) calls
`emit()` directly with no `legalCheck()` call at all, so **no** drawback gate is enforced in that tool —
not just the new `DATA.drawbackReq` caster gate added in `feat/drawbacks-phobias-expansion`, but the
**pre-existing** `DATA.drawbackMaxStats` stat caps from `b016331` too. This contradicts that decision's own
claim ("The Live Sheet's `buy()` already blocks anything not matched by SOFT_WARN, so both directions were
already refused there") — disproven by `/code-review max`: a Fighter can tick Mana Leak, and a character
can hold a drawback whose stat cap their current score already breaks, with nothing in that tool's UI or
save path surfacing it (the engine's advisory `⛔` line in `compute().warnings` exists but nothing reads
it there).
**Effort:** medium · **Risk:** medium — ambiguity is low (the fix is routing drawback purchases through
`legalCheck()`/`buy()`, the same path every other purchase category in that tool already uses); damage
scale is medium (a purchase-flow-control change in a live tool, though scoped to one category); damage
likelihood is low-medium (well-trodden pattern, but no e2e coverage of the disabled/blocked state exists
today for either gate to catch a regression) — worst-of lands at medium.

```text
1. Route takeDrawback() through legalCheck()/buy() instead of its direct emit() shortcut, mirroring how
   every other purchase category in the Live Sheet already works. A hard (⛔) violation must be refused
   at the point of purchase, the same way CharGen's checkbox guard now refuses it (see
   feat/drawbacks-phobias-expansion).
2. Related bug, same review pass, same code path: CharGen's random builder (actDraw/tryAct) increments
   _draws BEFORE tryAct's rollback and never restores it on rejection — a randomly-picked drawback that
   gets rejected (stat cap, or since this task, a caster-gate violation) silently costs a draw attempt.
   Pre-existing, not introduced by drawbackReq, but fold the fix in here since it touches the same
   candidate-filter/rollback code.
3. Add browser-driven coverage (dm-console-ui-e2e.mjs or chargen-flows-e2e.mjs) asserting the Live Sheet
   actually refuses a hard drawback violation — no equivalent e2e coverage exists today for the
   disabled-checkbox behavior in EITHER tool, for EITHER gate (drawbackMaxStats or drawbackReq).
```

**Done when:** drawback purchases in the Live Sheet go through `legalCheck()` the same way every other
purchase category does; a hard (⛔) drawback violation is refused there exactly as CharGen's checkbox
guard refuses it; `actDraw`'s rollback no longer leaks a draw attempt on a rejected candidate; a new
browser-driven check confirms the enforcement; `testing/tests/engine-parity.html` still 0 failed.

## guide-price-check.mjs has zero drawback-price coverage against the engine — TODO
Branch `test/guide-drawback-price-check`. `testing/scripts/guide-price-check.mjs` verifies guide prices
against the live engine for other purchase categories but has **no** coverage of drawback AP values at
all (`grep -c drawback testing/scripts/guide-price-check.mjs` → 0). This is precisely the class of gap
that produced the six-day Grit ladder divergence (`D-GH-2026-08-12-grit-steep-ladder`) — nothing catches
a guide drawback price silently drifting from `DATA.drawbacks`.
**Effort:** low · **Risk:** low — ambiguity is low (the shape to build already exists as
`guide-price-check.mjs`'s pattern for other categories, or as the description-match technique
`verify-guide.mjs` already uses); damage scale is low (adds a test, touches no rules or app code); damage
likelihood is low (a new gate can only fail loud, never silently break something already working).

```text
verify-guide.mjs (fixed in feat/drawbacks-phobias-expansion) now checks that guide drawback DESCRIPTIONS
match DATA.drawbackFx byte-for-byte, which transitively catches a price drift too IF the price appears
inside the description text — but the guide's own "AP gained" table column is a separate cell that check
does not capture or compare on its own. First confirm whether the description-match check already closes
this gap in practice (does every drawback's printed AP value also appear inside its own description
text?) or whether a dedicated price-column comparison is still needed for genuine independent coverage.
If needed, follow the guide-price-check.mjs pattern used for other categories, or extend verify-guide.mjs
to capture and compare the "AP gained" cell directly.
```

**Done when:** either `guide-price-check.mjs` or `verify-guide.mjs` mechanically asserts every
`DATA.drawbacks[name]` AP value against the guide's own printed "AP gained" column for that drawback,
independent of the description-text comparison, and the gate fails loudly on a mismatch — proven by
deliberately mispricing one guide row and confirming the gate goes red before restoring it.

## pact-guide master's cap-wording has diverged from the served copy — needs reconciliation — TODO
Branch `docs/guide-cap-wording-reconcile`. Discovered while updating drawback tables for
`feat/drawbacks-phobias-expansion`: the `pact-guide` project's `PACT-Players-Guide.html` (the canonical
master) still describes stat caps as advisory — *"The tool only warns, it does not block, if your current
[ability] is above [N] — DMs should enforce it as a hard requirement"* — on `Asthmatic`, `Frail`,
`Glass Frame`, `Lame`, `Missing Arm`, `Peg Leg`, and `Old Wound`. This repo's served copy
(`docs/PACT-Players-Guide.html`) already carries the hard-enforcement wording (*"You may only take this
drawback if your [ability] is currently [N] or below"*) that `b016331` introduced on 2026-08-18, and
additionally states the cap sentence at all on `Forgetful`, `Slow Study`, `Suggestible`, and
`Weak-Willed`, where the master omits it entirely. `feat/drawbacks-phobias-expansion` deliberately did
**not** resolve this — new rows were applied on top of each file's own existing prose, so the divergence
is neither widened nor silently overwritten.
**Effort:** low · **Risk:** medium — ambiguity is low (the served copy's wording is already the correct,
shipped-and-live posture per `b016331`'s owner ruling); damage scale is medium (a `pact-guide` transfer
done wrong has form — see the ⛔ box in `docs/VERSION-SYNC.md` and commit `e0c5e9f`'s image loss); damage
likelihood is low (the transfer procedure with its before/after `verify-guide.mjs` gate exists precisely
to catch this class of mistake, IF followed).

```text
Follow docs/VERSION-SYNC.md's transfer procedure exactly: run node testing/scripts/verify-guide.mjs
BEFORE touching anything. Apply the hard-enforcement wording to the pact-guide master's 7 named
drawbacks, and add the missing cap sentence to Forgetful/Slow Study/Suggestible/Weak-Willed there too —
do NOT copy the served file wholesale (it carries served-copy-only assets the master must not gain, per
the ⛔ box). Re-run verify-guide.mjs AFTER. Cross-check documents-rules version/branch/commit against
pact-guide's own py/vendor/engine/SYNCED_FROM.txt per VERSION-SYNC.md's three-way check. Worth first
checking D-GH-2026-08-19-drawback-statcap-enforcement (or its pact-guide-side equivalent, if one exists)
for whether the guide-side wording update was intentionally deferred or simply missed.
```

**Done when:** `node testing/scripts/verify-guide.mjs` passes both before and after the transfer; the
served copy and `pact-guide` master state the SAME enforcement posture for every capped drawback; the
transfer is verified against `pact-guide`'s own `py/vendor/engine/SYNCED_FROM.txt` per the three-way
check in `docs/VERSION-SYNC.md`.
