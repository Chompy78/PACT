# 2026-07-16 — Advancement tracks: real-browser e2e verification

Companion to `DECISIONS.md` `D-GH-2026-07-16-advancement-tracks-e2e`. This note preserves *how* the
verification was actually done — since it's the first PACT task to deliberately create and delete live
rows in the real Supabase project as part of testing, and a future agent doing similar work shouldn't have
to rediscover the approach or the schema bug it ran into.

## Why real Supabase, not the stubbed harness
`testing/scripts/random-manual-e2e.mjs` (the existing headless CharGen/Live Sheet regression) deliberately
stubs the Supabase CDN import so it never touches the network. That's the right call for a CI regression
gate, but it's the wrong call here: the whole point of this task was to prove `campaigns.rules`
persistence and cross-account behavior (a bound player's `Track-Level` genuinely differing from an unbound
one), and a stub can't prove either — it would just echo back whatever the client optimistically assumed.
So this run used the real `piuprrrnaotrtxucrtsb` project, real `auth.signUp`, and real DB round-trips.

## The account/campaign lifecycle used
- Two throwaway accounts, easy to identify and safe to bulk-match: `e2e-dm-<unix-ts>@pact-test.invalid` and
  `e2e-player-<unix-ts>@pact-test.invalid`. The `.invalid` TLD is deliberate — guarantees no real inbox
  could ever receive mail for these addresses.
- Confirmed the project auto-confirms email (matches a pre-existing `claude@claude.com` row's
  near-instant `confirmed_at`), so no manual confirmation step was actually needed once tested for real.
- Everything created was deleted afterward, in FK-safe order (`characters` → `campaign_invites` →
  `campaign_dms` → `ap_awards` → `campaigns` → `profiles` → `auth.users`), matched only by the exact
  throwaway identifiers, with a final SELECT confirming zero rows remained. The three pre-existing real
  accounts (`rhysmyself@gmail.com`, `claude@claude.com`, `jrc.chow@gmail.com`) and their data were never
  touched or queried beyond a read to know to leave them alone.

## The schema bug that got in the way
`createCampaign()`'s underlying RPC, and `createPlayerInvite()`'s, both call bare `gen_random_bytes(...)`
inside a `SECURITY DEFINER` function pinned to `search_path = public` — but `gen_random_bytes` lives in the
`extensions` schema. Result: **campaign creation and player-invite creation are currently broken in the
live app**, full stop. This was caught directly (`SELECT count(*) FROM campaigns` returned 0 before this
run started, and clicking the real "Generate invite link" button in DM Console reproduced the exact
Postgres error). It's not an emergency — no `tools/*.html` page currently calls `createCampaign()` at all
(verified by grep), so nothing user-facing is silently failing today — but it does mean this task's own
campaign had to be seeded with a direct SQL insert (supplying the invite codes the broken function
would've generated) rather than through the app's own signup flow, so the *rest* of the flow
(`redeem_player_invite`, the real invite-accept UI, Live Sheet's cloud-rules fetch) could still be
exercised unmodified and for real.

Fixing this is a `sql/migrations/` change against the live project — bigger blast radius than a
browser-verification task should take unilaterally, so it's filed as a roadmap follow-up rather than
folded into this PR.

## The bug that *was* fixed here
`tools/DM-Console.html`'s `onAuthChange` callback took one parameter and used it as the session — but
`js/auth.js`'s `onAuthChange` calls back with `(event, session)`, session second. Live Sheet and CharGen
had already hit and fixed this exact shape of bug at their own call sites; DM Console's campaign-auth
wiring was the one copy still wrong, and it crashed `updateAuth()` on literally every auth-state event
(`SIGNED_IN`, `INITIAL_SESSION`, `TOKEN_REFRESHED`, …). Without this fix, driving DM Console signed-in at
all was unreliable — this was found and fixed early in the run, not as an afterthought.

## What wasn't folded into the CI harness
The task text suggested folding reproducible parts into `testing/scripts`/`character-gen-e2e.yml` "if
practical." It wasn't done here: a CI-safe version would need to either stub Supabase (defeating the
purpose, see above) or provision dedicated CI-only test credentials/project, which doesn't exist yet
(see also `D-GH-2026-07-15-wire-audit-py-into-ci`'s note that no dedicated test Supabase project exists
for its `--rls` live-proof mode either — same gap, different task). Left as a possible future roadmap item
rather than invented here.
