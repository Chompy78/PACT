# Plan: Campaign join/invite UI (Path A: new-player token invite, Path B: bind existing character)

## Goal
PACT is a static tabletop-RPG character tool suite (vanilla JS, GitHub Pages, Supabase backend). Right
now a DM can create a campaign and a player can *technically* join one via a Postgres RPC, but **no
production UI calls that RPC anywhere** — joining a campaign is currently only exercisable from a
developer test harness. This plan adds the missing front-end for two flows:
- **Path A** — a DM invites a brand-new player: DM generates a single-use, per-player token that
  pre-sets a starting AP amount and a starting build-point budget; the player redeems it to create a new
  character already bound to the campaign with those starting values.
- **Path B** — an existing player with an already-built character binds that character to a campaign via
  invite code, sees non-blocking rule-violation warnings if their build conflicts with the campaign's
  rules, but can bind regardless (DM sorts it out later).

## Context
Repo rules that shape this plan (paraphrased from the repo's own `AGENTS.md`):
- Vanilla JS only, no frameworks/bundlers/npm. GitHub Pages hosts static files only — **no custom backend
  code in the repo**; Supabase (hosted Postgres + Auth, reached from the browser, protected by
  row-level-security) is the only backend allowed.
- Only the Supabase anon/publishable key is ever committed; the `service_role` key must never be
  committed or used client-side.
- `js/engine.js` is the single source of truth for game rules and its public API must stay stable;
  nothing outside it may re-implement rules logic.
- The DB stores only raw character data; derived values (HP/AC/AP/warnings) are computed at runtime, never
  stored. `ap` (DM-awarded bonus AP) is server-authoritative and DM-only — a local client push must never
  overwrite it.
- After any migration/RLS/schema change, the repo's process requires running the Supabase security
  advisor and skimming recent logs before opening a PR — this project has already shipped grant/RLS
  drift bugs twice (its own decision log calls these out by name: REV-04 and a follow-up around
  REV-07/function-grant lockdown), so new RPCs get extra scrutiny.
- Engine-parity tests must stay at the repo's current expected pass count (20/0) after any change.

## Assumptions vs. verified facts

**Verified (read directly in the code):**
- `sql/schema.sql` already defines the full membership model: `campaigns` (with a shared, DM-visible
  `invite_code` and `dm_invite_code`), `campaign_dms` (DM/co-DM membership), `characters` (has a nullable
  `campaign_id` FK, `on delete set null`), `ap_awards` (award ledger).
- Two `SECURITY DEFINER` RPCs already exist and are wired to `authenticated`-only grants:
  `join_campaign(p_code)` — looks up a campaign by its shared `invite_code`, blocks re-joining, and
  **inserts a brand-new** `characters` row (`name='New Character'`, `campaign_id` set). `join_as_dm(p_code)`
  — the co-DM equivalent, inserts into `campaign_dms`.
- `characters` has **no** blanket INSERT/UPDATE grant to `authenticated`; only column-restricted grants
  (`insert (id, owner_id, name, kind, stats)`, `update (name, kind, stats)`). Both `ap` and `campaign_id`
  are excluded from every direct grant — the only way to set either is through a `SECURITY DEFINER`
  function. A migration (`2026-06-30-rev04-campaign-rls.sql`) explicitly closed a prior bypass where
  `campaign_id` was directly player-writable.
- **Neither existing RPC can do Path B.** `join_campaign()` only creates a brand-new character row; there
  is no existing RPC that binds an *already-existing* character (one a player already built) to a
  campaign by code. This is a genuine gap, not just missing UI.
- **Path A's "single-use per-player token carrying starting AP + build budget" also does not exist yet.**
  The existing `invite_code` is a shared, reusable, campaign-wide code with no per-player state and no way
  to attach starting AP/budget values — it is a different mechanism from what Path A asks for.
- `js/engine.js` exports `validate(b, rules)` (already in the file's own export-list comment) —
  "check a build against a DM's campaign rules... Pure and side-effect-free... Returns
  `{ ok, violations: [{code, message}] }`... never throws on a malformed/empty rules object." This is
  exactly the non-blocking check Path B needs.
- `b.budget` is the build's own starting-AP-budget field — `compute()` reads it directly
  (`const playerAp=b.budget||0`) and `baseBuild()` initializes it to `budget:0`. This is the field Path A's
  "build budget" should set on the new character's `stats`.
- `js/campaign.js` has `createCampaign`, `joinCampaign`, `joinAsDm`, `promoteToDm`/`removeDm`,
  `regenerateInviteCode`/`regenerateDmInviteCode`, `setIgnorePlayerAp`, `setCampaignRules`,
  `getCampaignDms`, `listMyCampaigns`, `getCampaign` — no invite-token or bind-existing-character function.
- `tools/DM-Console.html` has a campaign panel (`#campPanel`/`#campSel`/`#campCodes`) that *displays*
  existing invite codes read-only — there is no "create campaign" or "invite new player" button anywhere
  in it today.
- `tools/PACT-CharGen-Webtool.html` already imports `listMyCampaigns, getCampaign` and populates a
  campaign `<select>` used purely for **live rule-filtering** (species/boons/drawbacks pickers) — but that
  select only shows campaigns the player has *already* joined, and nothing in CharGen ever calls
  `joinCampaign()`. `tools/PACT-Live-Char-Sheet.html` separately has a "House rules code" feature that its
  own code comment says is explicitly **not** the cloud campaign system — a distinct, older, local-only
  mechanism not to be confused with this feature.
- Migration files follow `sql/migrations/YYYY-MM-DD-slug.sql`, one file per change, applied by hand via
  the Supabase SQL editor (no migration-runner tooling in-repo).

**Assumed (not yet confirmed — flagged for the reviewer):**
- That `sql/schema.sql` is meant to be hand-kept in sync with each new migration file (both exist in the
  repo and look duplicative of each other) — this plan updates both, but the exact intended relationship
  between them wasn't independently confirmed.
- That a brand-new player redeeming a Path-A token must already have (or create) a Supabase Auth account
  before redemption — i.e. the token identifies a *campaign slot*, not a pre-provisioned user. The token
  is claimed by whichever authenticated user redeems it first.
- That Path A's redemption flow should hand the player into CharGen (to actually spend the preset budget
  building a character) rather than creating a fully-blank character — this seems like the natural fit
  given CharGen already owns "build a new character from a budget," but it's a design choice, not a fact.
- That Path B should be exposed in **both** CharGen and Live Sheet eventually, but this plan scopes the
  first implementation to CharGen only (see Out of scope) since that's where the existing campaign-select
  and rule-filtering UI already lives.

## Proposed approach
1. **New migration** `sql/migrations/2026-07-11-player-invite-tokens.sql`:
   - New table `campaign_invites` (`id`, `campaign_id` FK, `token` unique CSPRNG-generated — reuse the
     `gen_random_bytes`-based pattern the repo already uses for `invite_code`/`dm_invite_code`, not
     `random()` — `starting_ap` int, `starting_budget` int, `created_by` FK profiles, `created_at`,
     `redeemed_by` FK profiles nullable, `redeemed_at` nullable).
   - RLS: DM/co-DM of the campaign can `select`/`insert` their campaign's rows; no direct client
     `update`; nobody gets a blanket grant — redemption goes through a `SECURITY DEFINER` RPC only.
   - RPC `create_player_invite(p_campaign_id, p_starting_ap, p_starting_budget) returns text` (the token)
     — caller must be a DM/co-DM of the campaign (mirror the existing `is_campaign_dm` check pattern).
   - RPC `redeem_player_invite(p_token, p_name) returns uuid` (new character id) — atomically claims the
     token (`update campaign_invites set redeemed_by=auth.uid(), redeemed_at=now() where token=p_token and
     redeemed_by is null`, checking the row-count to reject a race/double-redeem), then inserts a
     `characters` row with `campaign_id`, `ap=starting_ap`, `stats={budget:starting_budget}`,
     `kind='chargen'`, `owner_id=auth.uid()`, `name=p_name`.
   - RPC `bind_character_to_campaign(p_character_id, p_code) returns void` (Path B) — verifies
     `auth.uid()` owns the character, looks up the campaign by its existing shared `invite_code`, sets
     `campaign_id` on that character row. No new state needed since it reuses the existing `invite_code`.
   - Grant `execute` on all three to `authenticated` only, explicitly revoke from `public` (mirrors every
     existing RPC in the file).
   - Mirror the same table/functions into `sql/schema.sql` (cumulative source of truth).
2. **`js/campaign.js`**: add thin wrappers `createPlayerInvite(campaignId, startingAp, startingBudget)`,
   `redeemPlayerInvite(token, name)`, `bindCharacterToCampaign(characterId, code)` — same pattern as the
   existing RPC wrappers in this file.
3. **`tools/DM-Console.html`**: add an "Invite new player" action in the campaign panel (near `#campCodes`)
   — a small form for starting AP + starting budget, calls `createPlayerInvite`, displays the resulting
   token/link with a copy button (same UX pattern as the existing invite-code display).
4. **`tools/PACT-CharGen-Webtool.html`**:
   - On load, detect an `?invite=<token>` URL param; if present and the user isn't signed in, prompt
     sign-in/register first (reuse `js/auth.js`), then call `redeemPlayerInvite`, load the resulting
     character, and open the build flow with `budget` already set from the token (Path A).
   - Add a "Join campaign" action (enter invite code) next to the existing campaign `<select>` for an
     already-built character, calling `bindCharacterToCampaign`; on success, re-run `validate()` against
     the campaign's `rules` and show any violations as non-blocking warnings (character stays bound
     regardless) — this is Path B, scoped to CharGen for v1.
5. Run `testing/tests/engine-parity.html` (expect the repo's current pass count, 20/0) — no `engine.js`
   changes are planned, this just confirms nothing broke.
6. Run the Supabase security advisor against the new migration before opening the PR, per the repo's own
   process (grant/RLS drift has bitten this project twice before).
7. Update `CHANGELOG.md` / `DECISIONS.md` per the repo's own per-change checklist, and graduate this item
   out of `docs/PACT_ROADMAP.md`.

## Files involved
- `sql/migrations/2026-07-11-player-invite-tokens.sql` (new) — table + 3 RPCs + grants/RLS.
- `sql/schema.sql` — mirror the new table/functions.
- `js/campaign.js` — 3 new wrapper functions.
- `tools/DM-Console.html` — "Invite new player" UI in the campaign panel.
- `tools/PACT-CharGen-Webtool.html` — `?invite=` redemption handling + "Join campaign" (bind existing)
  action.
- `CHANGELOG.md`, `DECISIONS.md`, `docs/PACT_ROADMAP.md` — doc bookkeeping per the repo's checklist.

## Out of scope
- Live Sheet's Path-B UI (binding an already-built *event-sourced* character) — same RPC works for it,
  but the UI work is deferred to a follow-up task to keep this change reviewable.
- Any change to co-DM invites (`join_as_dm`), the existing shared `invite_code`/`dm_invite_code` system,
  or `award_ap` — all already work and are untouched by this plan.
- Kicking/removing a player from a campaign, or un-binding a character's `campaign_id`.
- Retroactively binding characters created before this feature shipped.
- Any `engine.js` or `compute()` change — `validate()` already exists and is used as-is.

## Alternatives considered
- **Reuse the existing shared `invite_code` for Path A too** (skip the new token table) — rejected: the
  roadmap item specifically calls for a *single-use, per-player* token carrying starting AP/budget, which
  a shared reusable code structurally can't express (no per-redemption state, no way to attach values).
- **Do the AP/budget bind server-side automatically on first login via a magic link**, instead of a
  visible token/code — rejected as unnecessary complexity; the existing invite-code UX (DM shares a short
  code, player types it in) is already the repo's established pattern and this plan keeps it consistent.
- **Put Path A redemption in a new standalone `join.html` page** instead of CharGen — considered, but
  CharGen already owns "start a new character from a budget," so redeeming into it avoids building a
  second character-creation entry point.

## Risks / open questions
- **Double-redemption race**: two browser tabs or two people racing the same token. Mitigated by the
  atomic conditional-update-then-check-rowcount pattern in `redeem_player_invite`, but this is the
  highest-value thing for a reviewer to sanity-check.
- **Token guessability**: must use the same CSPRNG approach as the existing invite codes, not a
  predictable sequence — flagged explicitly in the migration step above so it isn't missed.
- **CharGen's "load a character that only has `{budget:N}` set, nothing else"** path hasn't been traced
  end-to-end — need to confirm `compute()`/CharGen's load path handles a minimal stats object gracefully
  before considering Path A done (see Verification).
- **Grant/RLS drift**: this repo has shipped two prior incidents from exactly this class of change (new
  grants/RLS on `characters`/campaign tables) — the Supabase advisor step is non-negotiable here, not
  a nice-to-have.
- Whether unauthenticated players should be able to preview *which* campaign they're joining before
  creating an account (open UX question, not answered by this plan).

## Verification
- `testing/tests/engine-parity.html` → still passes at the repo's current expected count (no engine
  changes expected).
- Run Supabase `get_advisors` against the new migration; resolve any new findings before merging.
- Manual QA (Path A): DM generates an invite with a non-zero starting AP + budget in DM-Console → a second
  (unauthenticated) browser/account opens the link → is prompted to sign in/register → lands in CharGen
  with the campaign pre-selected, rule-filtering active, and the starting budget already reflected in the
  build's remaining-AP display.
- Manual QA (Path A, race): attempt to redeem the same token twice (two tabs) → second attempt is
  rejected, only one character is created.
- Manual QA (Path B): an existing player with a built character (some of whose choices violate the target
  campaign's `rules`) enters the invite code → character's `campaign_id` is set → non-blocking violation
  warnings are shown → character remains usable/bound.
- Regression QA: confirm a direct REST/PostgREST write attempting to set `campaign_id` or `ap` on a
  `characters` row (bypassing the RPCs) still fails, per the existing RLS/grant lockdown.

## Done when
- Both RPCs (`create_player_invite`, `redeem_player_invite`, `bind_character_to_campaign`) exist, are
  migrated, and pass the advisor check.
- DM-Console can generate a Path-A invite; CharGen can redeem one end-to-end into a new campaign-bound
  character with the preset budget/AP.
- CharGen can bind an already-built character to a campaign via invite code and shows `validate()`
  warnings non-blockingly.
- `engine-parity.html` still passes at the current expected count.
- `CHANGELOG.md`/`DECISIONS.md`/roadmap updated per the repo's checklist.

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

## Review outcome (fill in after the review + implementation — not part of the cold review)
- Reviewer findings: TBD
- Materially changed the plan? TBD
- Without the review, what would have happened: TBD
