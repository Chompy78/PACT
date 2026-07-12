# Plan: Campaign join/invite UI (Path A: new-player token invite, Path B: bind existing character)

> **Revision 2** — revised after three independent cold reviews (2026-07-12). Each review finding was
> triaged against the actual code (see "Review outcome" at the bottom), not applied blindly. The most
> consequential change: the original plan's `stats={budget:N}` character-creation shape was **verified
> wrong** and corrected (see Approach step A4). The feature is now **split into two deliverables** (Path A,
> Path B) per two reviewers' recommendation.

## Goal
PACT is a static tabletop-RPG character tool suite (vanilla JS, GitHub Pages, Supabase backend). A DM can
create a campaign and a player can *technically* join via a Postgres RPC, but **no production UI calls it**
— joining is only exercisable from a dev test harness today. This plan adds the missing front-end as two
independent deliverables:
- **Path A** — a DM invites a brand-new player via a single-use, per-player token carrying a starting AP
  amount and a starting build budget; the player redeems it to get a new character already bound to the
  campaign with those starting values.
- **Path B** — an existing player binds an already-built character to a campaign via the campaign's shared
  invite code, sees non-blocking rule-violation warnings via the engine's `validate()`, and binds
  regardless (unless the server rejects for a real blocking condition).

## Split into two deliverables (branches/PRs)
Two reviewers independently recommended splitting; it also fits the repo's "one task per branch, small
focused PR" rule. The two are genuinely independent (different RPCs, different UI entry points):
- **Deliverable 1 — Path A** (branch `feat/campaign-invite-tokens`): new `campaign_invites` table,
  `create_player_invite` + `redeem_player_invite` RPCs, DM-Console "Invite new player" UI, CharGen
  `?invite=` redemption flow. Higher user value, self-contained.
- **Deliverable 2 — Path B** (branch `feat/campaign-bind-character`): `bind_character_to_campaign` RPC
  (reuses the existing shared `invite_code`, no new table), CharGen "Join campaign" action with
  `validate()` warnings. Reviewable/hardenable independently without blocking Path A.

Everything below is written to be implemented in that order; Path B has no dependency on Path A.

## Context
Repo rules that shape this plan (paraphrased from the repo's own `AGENTS.md`, verified):
- Vanilla JS only, no frameworks/bundlers/npm. GitHub Pages hosts static files only — **no custom backend
  code in the repo**; Supabase (hosted Postgres + Auth, browser-reached, RLS-protected) is the only backend.
- Only the Supabase anon/publishable key is committed; the `service_role` key must never be committed or
  used client-side.
- `js/engine.js` is the single source of truth for game rules; its public API must stay stable and **no
  rules/log-format logic may be re-implemented outside it** (this directly rules out constructing a
  character's event-log envelope in SQL — see A4).
- The DB stores only raw character data; derived values are computed at runtime, never stored. `ap` is
  server-authoritative and DM-only; a local client push must never overwrite it.
- Neither `characters.ap` nor `characters.campaign_id` may be set via a direct client write — both are
  excluded from every column-level grant, so a `SECURITY DEFINER` RPC is the only path (a prior migration
  closed a bypass where `campaign_id` was directly player-writable).
- After any migration/RLS/RPC change, run the Supabase security advisor and skim recent logs before the PR
  — this project has shipped grant/RLS drift twice (its decision log names REV-04 and the REV-07/function-
  grant lockdown). New RPCs get extra scrutiny.
- Engine-parity tests must stay at the current expected pass count (20/0).

## Assumptions vs. verified facts

**Verified (read directly in the code during planning + a dedicated review-verification pass):**
- **Auth is email/password only — NO OAuth.** `js/auth.js` exports a programmatically-callable
  `login(email, password)` whose only sign-in call is `supabase.auth.signInWithPassword({email,password})`
  — an in-page async call, no page redirect, so URL query params (`?invite=`) survive login. There is no
  `signInWithOAuth` anywhere. (Registration/password-reset *do* use `emailRedirectTo`/`redirectTo` — see
  the redemption-survival note in A4.)
- **`join_campaign(p_code)` already enforces one-character-per-player-per-campaign** via
  `if exists (select 1 from characters where campaign_id=v_campaign.id and owner_id=auth.uid()) then raise…`
  It inserts only `(owner_id, campaign_id, name='New Character')`; `stats`, `ap`, `kind` fall to table
  defaults (`'{}'::jsonb`, `0`, `'livesheet'`).
- **`characters` column facts:** `name text not null default 'New Character'` (no length CHECK);
  `stats jsonb not null default '{}'::jsonb`; `ap integer not null default 0`;
  `kind text not null default 'livesheet' check (kind in ('chargen','livesheet'))`;
  `campaign_id uuid references campaigns(id) on delete set null` (nullable). **No insert-time trigger** on
  `characters` — the client is fully responsible for the stats shape (the only trigger is a BEFORE UPDATE
  `updated_at` stamp).
- **CharGen persists a LOG-envelope, not a flat build.** The cloud `stats` column holds
  `{schema, rules, name, LOG, SEQ, id}`; on load CharGen replays it (`if(d.LOG&&Array.isArray(d.LOG)){ const
  b=foldBuild(d.LOG);…}`). A raw `stats={budget:N}` matches **neither** load branch, so it would NOT
  reconstruct as a real character (though `compute()` itself defensively coerces missing fields and would
  not hard-crash). **This invalidates the original plan's `stats={budget:N}` approach** — corrected in A4.
- **Player membership is derived solely from `characters.campaign_id`** (co-DMs live in `campaign_dms`).
  `listMyCampaigns()` and `dm.js getRoster()` both key off `characters.campaign_id` with no separate
  player-membership table — so once the RPC sets `campaign_id`, the DM roster shows the player with no
  extra wiring (R1 #10 / R3 #6 satisfied).
- `js/engine.js` exports `validate(b, rules) → { ok, violations:[{code,message}] }` — pure, never throws on
  a malformed/empty rules object. Exactly the non-blocking check Path B needs.
- Migration files follow `sql/migrations/YYYY-MM-DD-slug.sql`, applied by hand via the Supabase SQL editor;
  `sql/schema.sql` is the cumulative source of truth kept in sync alongside each migration.
- **CharGen's budget is a singleton `award` event (the #1 spike, now RESOLVED).**
  `foldBuild(LOG).budget = economy(LOG).earned = Σ (award.amount)` (+ drawback earnings, 0 for a fresh
  character). CharGen represents the budget field as exactly one `award` event in the LOG, shape
  `{type:'award', amount:N, note:'Budget', noLock:true, label:'Award — budget (N AP)', seq, ts, rules}` —
  and the engine reads **only** `type` + `amount` (the rest is cosmetic ledger metadata). A blank CharGen
  character's LOG is **not empty**: it already carries one seed award event (default `amount=DATA.level1AP`).
  So seeding a starting budget of N is a single award event. **Crucial loader constraint:** the cloud
  envelope must have `schema:'pact-character/1'` (`CHAR_SCHEMA`) + a `LOG` array or `readCharacterEnvelope`
  rejects it (returns null) — so `stats='{}'` is **not** CharGen-loadable, which shapes the recovery story
  in A4.

**Assumed (not yet confirmed — flagged for implementation):**
- **Starting-AP vs. starting-budget semantics.** This plan maps the token's two values to the engine's two
  AP sources: `starting_budget` → the build's own player AP (`b.budget`, seeded as the award event) and
  `starting_ap` → the DM-awarded `characters.ap` column (`dmAp`). If the DM actually means them as a single
  pool, collapse to one. One-line product confirmation, not a code risk.
- That a brand-new player must create/hold a Supabase Auth account before redeeming; the token identifies a
  *campaign slot*, claimed by whichever authenticated user redeems it first (token-possession = authz — see
  Design decisions).

## Design decisions resolved from review (document these in DECISIONS.md)
These were open questions all three reviews flagged; resolved here so implementation isn't ad-hoc:
1. **One character per player per campaign — enforced server-side**, mirroring the verified `join_campaign`
   guard. `redeem_player_invite` and `bind_character_to_campaign` both reject if the caller already owns a
   character in the target campaign. (Not a front-end-only check.)
2. **Rebind contract for `bind_character_to_campaign`:** allow only when the character's `campaign_id IS
   NULL`; already-bound-to-the-same-campaign → friendly no-op success; bound to a *different* campaign →
   reject (no "transfer/leave campaign" feature in v1). Owner check required (`auth.uid()` owns the row).
3. **Token possession = authorization.** Whoever holds the token and is authenticated may redeem it; the DM
   controls sharing. No per-recipient email binding in v1 (would need an `intended_email` column — out of
   scope). Accepted risk, documented.
4. **`kind='chargen'` for redeemed characters** (vs `join_campaign`'s `'livesheet'` default) because a
   Path-A player builds in CharGen. This is *why* the LOG-envelope shape in A4 matters.
5. **`join_campaign` retained, not deprecated.** It stays the "quick join with the shared code, blank
   livesheet character, no preset budget" path; Path A is the "DM-curated single-use token with preset
   budget/AP, chargen character" path. To avoid confusing duplicate UI, Path A's DM-Console action is
   labeled distinctly ("Invite new player") and `join_campaign` gets no new UI here. Document the three
   distinct mechanisms (shared `invite_code` → `join_campaign`; `dm_invite_code` → `join_as_dm`; per-player
   token → `redeem_player_invite`).
6. **No token expiry/revocation in v1** (accepted risk, documented). The migration adds a nullable
   `expires_at` column now (cheap future-proofing, avoids a later migration) but redemption does not yet
   enforce it. Invite listing/revoke/audit are a named backlog follow-up.
7. **Backwards compatibility:** existing campaigns, existing `invite_code`/`dm_invite_code`, and existing
   characters are unaffected and need no data migration — this is purely additive.

## Proposed approach

### Deliverable 1 — Path A
**A1. Migration** `sql/migrations/2026-07-11-player-invite-tokens.sql` (+ mirror into `sql/schema.sql`):
- Table `campaign_invites`: `id`, `campaign_id` FK, `token` unique (CSPRNG via the repo's existing
  `gen_random_bytes` pattern, **not** `random()`), `starting_ap int`, `starting_budget int`,
  `created_by` FK profiles, `created_at`, `expires_at` (nullable, not yet enforced), `redeemed_by` FK
  profiles nullable, `redeemed_at` nullable.
- RLS: DM/co-DM of the campaign may `select`/`insert` their rows (mirror the existing `is_campaign_dm`
  helper); no direct client `update`; redemption only via the SECURITY DEFINER RPC.
- RPC `create_player_invite(p_campaign_id, p_starting_ap, p_starting_budget) → text` — caller must be
  DM/co-DM; returns the token.
- RPC `redeem_player_invite(p_token, p_name) → uuid` — **single function body = one implicit transaction**,
  so a failed character insert auto-rolls-back the token claim (no orphaned-consumed-token failure mode).
  Steps: (a) atomic claim `update campaign_invites set redeemed_by=auth.uid(), redeemed_at=now() where
  token=p_token and redeemed_by is null` then check row-count — **if already redeemed by *this* user, treat
  as idempotent recovery: return the existing character id instead of erroring**; if redeemed by someone
  else, reject. (b) enforce one-per-player-per-campaign. (c) validate/coalesce `p_name` (trim; empty/null →
  `'New Character'`; cap length since there's no DB CHECK). (d) insert a character `owner_id=auth.uid(),
  campaign_id, name, kind='chargen', ap=starting_ap` and **stats = the DB default `'{}'::jsonb`** (see A4 —
  the budget is seeded client-side, NOT inserted here as `{budget:N}`). (e) return the new character id AND
  `starting_budget` (so the client seeds immediately). RLS on `campaign_invites` must let the redeemer
  `select` their own redeemed row (for crash recovery — see A4).
- Grant `execute` to `authenticated` only; revoke from `public`.

**A2. `js/campaign.js`** — thin wrappers `createPlayerInvite(campaignId, startingAp, startingBudget)` and
`redeemPlayerInvite(token, name)`, matching existing RPC-wrapper style.

**A3. `tools/DM-Console.html`** — "Invite new player" action near `#campCodes`: inputs for starting AP +
starting budget, calls `createPlayerInvite`, shows the **canonical URL**
`https://chompy78.github.io/PACT/tools/PACT-CharGen-Webtool.html?invite=<token>` with a copy button (reuse
the existing invite-code copy UX).

**A4. `tools/PACT-CharGen-Webtool.html`** — redemption + budget seeding (the corrected core):
- On load, detect `?invite=<token>`. Persist the token to `sessionStorage` **before** any auth step, so it
  survives (i) an unauthenticated player registering via email-confirm redirect and (ii) a page
  reload/crash. (Login itself doesn't redirect, but registration's `emailRedirectTo` does — hence storage,
  not reliance on the query param alone.)
- If unauthenticated, prompt sign-in/register (reuse `js/auth.js login`), then resume from the stored token.
- Call `redeemPlayerInvite(token, name)` → new character id (idempotent: a repeat call by the same user
  returns the same id, so double-click / crash-recovery is safe).
- **Seed the starting budget client-side, in the engine's own format** (keeps LOG/rules logic in JS, per the
  hard rule — spike now RESOLVED). Concretely: build `LOG = [{type:'award', amount:starting_budget,
  note:'Budget', noLock:true, label:'Award — budget ('+starting_budget+' AP)', seq:1, ts:Date.now(),
  rules:DATA.version}]`, wrap via `buildCharacterEnvelope({name, rules:DATA.version, LOG, SEQ:2, id})` (which
  stamps `schema:'pact-character/1'`), and `saveCharacter` that as the character's `stats`. On load
  `foldBuild(d.LOG)` then yields `budget=starting_budget`. Keep it a **singleton** award (a second would sum).
- **Recovery nuance (refined by the spike):** a redeemed-but-not-yet-seeded character has `stats='{}'`, which
  CharGen's loader REJECTS (`readCharacterEnvelope` requires `schema==='pact-character/1'`) — so it is NOT a
  "valid blank character." Recovery: on opening a redeemed character whose `stats` don't parse as a
  `CHAR_SCHEMA` envelope, re-read `starting_budget` from the still-readable redeemed `campaign_invites` row
  (RLS must let the redeemer `select` their own redeemed invite) and seed as above. The `redeem` RPC returns
  `starting_budget` (+ `starting_ap`) so the happy path seeds immediately without the extra query.
- After load: select the new character, populate the campaign `<select>` from `listMyCampaigns()` and select
  the matching campaign so rule-filtering (`_cloudCampaign`) is active; confirm `ap`/budget reflect the token.

### Deliverable 2 — Path B
**B1. Migration** (can share the same file or a second dated one): RPC
`bind_character_to_campaign(p_character_id, p_code) → void` — SECURITY DEFINER; verify `auth.uid()` owns the
character; look up the campaign by the existing shared `invite_code`; enforce the rebind contract (bind only
if `campaign_id IS NULL`; same-campaign = no-op success; different-campaign = reject); enforce
one-per-player-per-campaign; set `campaign_id`. Grant to `authenticated`, revoke from `public`.

**B2. `js/campaign.js`** — wrapper `bindCharacterToCampaign(characterId, code)`.

**B3. `tools/PACT-CharGen-Webtool.html`** — "Join campaign" action beside the campaign selector: enter code,
call `bindCharacterToCampaign`, fetch the campaign `rules`, run `validate(build, rules)`, show violations as
**non-blocking warnings**; the character stays bound unless the server rejected the bind. Re-run `validate()`
whenever the character is subsequently opened in that campaign context (rules can change; cost is negligible
and it matches CharGen's existing live rule-filtering behavior).

### Shared closeout (both deliverables)
Run `engine-parity.html` (expect 20/0 — no engine changes); run the Supabase security advisor
(`get_advisors`) + skim `get_logs`; update `CHANGELOG.md` / `DECISIONS.md` (record decisions 1–7 above) and
graduate the item from `docs/PACT_ROADMAP.md`.

## Files involved
- `sql/migrations/2026-07-11-player-invite-tokens.sql` (new) + `sql/schema.sql` (mirror) — table + RPCs +
  grants/RLS.
- `js/campaign.js` — 3 new wrapper functions.
- `tools/DM-Console.html` — "Invite new player" UI (Path A).
- `tools/PACT-CharGen-Webtool.html` — `?invite=` redemption + budget seeding (Path A); "Join campaign" bind
  + `validate()` warnings (Path B).
- `CHANGELOG.md`, `DECISIONS.md`, `docs/PACT_ROADMAP.md` — bookkeeping per the repo checklist.

## Out of scope
- Live Sheet's Path-B UI (binding an already-built *event-sourced* character) — the RPC works for it, but
  the UI is a follow-up. (Verification confirms Live Sheet can *open* a campaign-bound character since it
  already reads `campaign_id` for rules — it just can't create the binding yet.)
- Token expiry enforcement, revocation, invite listing/audit (named backlog follow-up; column reserved).
- Per-recipient (`intended_email`) token binding, campaign transfer/leave, kicking players, un-binding.
- Rate-limiting invite generation (documented absence, backlog).
- Any `engine.js`/`compute()` change — `validate()` is used as-is.

## Alternatives considered
- **Reuse the shared `invite_code` for Path A** (skip the new table) — rejected: Path A needs single-use,
  per-player state + preset AP/budget, which a shared reusable code can't express.
- **Construct the CharGen LOG-envelope inside the redeem RPC (SQL)** so the character loads fully-formed —
  rejected: that re-implements the engine's log/rules format in SQL, violating the "no rules logic outside
  engine.js" hard rule and is brittle. Client-side seeding (A4) keeps that logic in JS.
- **A dedicated `join.html` interstitial** for redemption instead of doing it in CharGen — considered; a
  `sessionStorage` token stash inside CharGen achieves the same auth/crash survival without a second entry
  point, and CharGen already owns "build from a budget."
- **One combined PR** — rejected in favor of the Path A / Path B split (two reviewers; smaller PRs).

## Risks / open questions
- **CharGen budget-seed primitive (#1 spike — RESOLVED):** confirmed to be a singleton `award` event in the
  LOG (`budget = Σ award.amount`); the concrete seed + envelope is specified in A4. Residual care: keep it a
  singleton and stamp `schema:'pact-character/1'`, or the character loads wrong / not at all.
- **Double-redemption / double-submit:** covered by the atomic `update … where redeemed_by is null` +
  row-count check, made idempotent so a same-user retry returns the existing character. Highest-value thing
  for a reviewer to sanity-check.
- **Token guessability:** must use the existing CSPRNG pattern, not `random()`.
- **Grant/RLS drift:** this class of change bit the repo twice — the advisor step is non-negotiable.
- **Registration email-confirm round-trip:** whether the Supabase project requires email confirmation (a
  redirect) is environment-dependent; the `sessionStorage` stash makes Path A robust either way.

## Verification
- `testing/tests/engine-parity.html` → still **20/0** (no engine changes).
- Supabase `get_advisors` (Dashboard Security-Advisor-equivalent) after the migration; resolve new findings;
  skim `get_logs`.
- **Prerequisite spike — RESOLVED (no longer blocking):** the budget-seed primitive is confirmed (singleton
  `award` event; envelope needs `schema:'pact-character/1'`) and specified in A4. Remaining test: seed a
  character with `starting_budget=N` and confirm CharGen loads it with `budget=N` and rule-filtering active.
- **Authorization regression tests (explicit):** a non-DM cannot `create_player_invite`; a co-DM can; one
  player cannot `bind_character_to_campaign` another player's character; double-redemption is rejected
  (verify the atomic claim + row-count, not just the UI message); existing `join_campaign` + shared
  `invite_code` still work; direct REST/PostgREST writes to `characters.campaign_id` / `characters.ap`
  still fail.
- **Path A success (full journey):** DM creates invite (non-zero AP+budget) → copies canonical link → player
  opens it in a fresh session → signs in/registers → token redeems → new character created, campaign-bound,
  `ap`=invite AP, budget=invite budget, loads in CharGen with campaign pre-selected and rule-filtering active.
- **Path A race / double-submit / interrupted recovery:** same token in two tabs/accounts → one character
  only, later attempts fail cleanly; double-click redeem → one character; redeem succeeds then browser
  closes/refreshes before UI completes → token stays consumed, the created character remains accessible and
  re-openable, budget re-seedable.
- **Path B success + existing-campaign cases:** built character violating campaign rules enters code → binds
  → `validate()` warnings shown non-blockingly → stays bound; then test `campaign_id IS NULL` (binds),
  already-same-campaign (no-op success), already-different-campaign (rejected) — behaviour matches decision 2.
- **Live Sheet compat:** confirm Live Sheet can open a character bound via CharGen.

## Done when
- Deliverable 1: `create_player_invite` + `redeem_player_invite` migrated and advisor-clean; DM-Console
  generates a canonical invite link; CharGen redeems it end-to-end into a campaign-bound chargen character
  with the preset budget/AP correctly seeded and loadable; race/double-submit/recovery all behave.
- Deliverable 2: `bind_character_to_campaign` migrated and advisor-clean; CharGen binds an existing character
  by code, shows `validate()` warnings non-blockingly, and enforces the rebind contract (decision 2).
- `engine-parity.html` still 20/0; authorization regression tests pass.
- `CHANGELOG.md`/`DECISIONS.md` (decisions 1–7)/roadmap updated.

---

## Reviewer instructions
You are reviewing this plan **cold, with no access to the codebase** — only the text above. You are a
general reasoner, not a code analyzer: judge the plan's **logic, clarity, scope, and risk — not code
correctness you cannot verify.** If the plan relies on knowledge you don't have, that itself is a finding.
Find gaps, unstated risks, and better alternatives — including structural/redesign suggestions, not just
"missing detail" — but do not implement anything. Specifically:
1. Does the proposed approach actually achieve the stated goal?
2. Which of the plan's **assumptions** look shaky, and what happens if one is wrong?
3. Is anything in "Alternatives considered" actually better, or is the plan overcomplicated for the goal?
4. What's missing — an edge case, a risk, a dependency, a **verification step** the plan doesn't mention?
5. Are "Verification" and "Done when" objectively checkable, or do they hide ambiguity?
6. Should this task be split? Is anything in "Out of scope" actually load-bearing?

Write your findings as a plain list (gaps found, suggested improvements, verdict) — don't rewrite the plan
yourself unless asked. **If a section is genuinely solid, say so briefly rather than inventing concerns** —
false findings cost the implementer a wasted cycle.

---

## Review outcome (three cold reviews, triaged 2026-07-12 against the actual code)
- **Reviewers:** 3 independent cold reviews. **~30 distinct findings** → **accept ~19 / reject 1 /
  defer-to-backlog 4 / verified-already-satisfied ~6.**
- **Rejected (1):** Review 2's "critical blocker: OAuth redirect loses the `?invite=` token." Verified moot
  — the app uses email/password only (`signInWithPassword`, in-page, no redirect), so login preserves the
  query param. The *mechanism* it recommended (sessionStorage token stash) was still adopted, but on
  different grounds (registration email-confirm redirect + crash recovery), not OAuth.
- **Materially changed the plan? YES.** (a) The character-creation shape was corrected — `stats={budget:N}`
  is verified wrong (CharGen uses a LOG-envelope); redemption now inserts the default `'{}'` and seeds the
  budget client-side in engine format. (b) Split into two deliverables/PRs. (c) Added explicit server-side
  policies for one-char-per-campaign, the rebind contract, idempotent recovery, `p_name` validation, and
  token-possession authz. (d) Expanded verification with authorization-regression + recovery tests.
- **Without the review:** the implementer would have shipped a `redeem_player_invite` that creates
  characters CharGen can't load (the `stats={budget:N}` bug), and left the already-bound-character and
  duplicate-membership behaviours undefined — both real defects the reviews caught before any code was written.
