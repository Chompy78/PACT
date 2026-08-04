# PACT — usability & QoL review prompt

Paste the block below into a fresh Claude Code session on this repo. Written for **Sonnet** (see
"Model" at the bottom). It produces findings only — it must not change app code.

Re-run it after any significant UI change; it is written to be repeatable rather than one-shot.

---

```
You are doing a usability and quality-of-life review of PACT — a static, vanilla-JS tabletop-RPG tool
suite. Three tools: a Character Generator, a Live Character Sheet, and a DM Console, plus a My
Characters page and a login page. It is a PWA with optional sign-in; signed-out it works local-only,
signed-in it saves to Supabase and DMs run campaigns.

YOUR JOB IS TO FIND PROBLEMS AND REPORT THEM. Do not fix anything. Do not edit any file under js/,
tools/, sql/, or index.html. The only file you write is your findings report.

## Read this first

- AGENTS.md — the project's own rules. Note especially: vanilla JS only, no frameworks or build step;
  the three tools' UI is not to be changed casually; every player-controlled value that reaches
  innerHTML must pass through esc().
- docs/HOW-TO-WORK.md — how the app and its gates are run.

Do NOT read tools/*.html or js/engine-data.js in full — they are 127–376KB and 189KB. Grep for the
section you need. You will be looking at the app in a browser, not reading it into context.

## Standing up a real, signed-in instance

Everything cloud-side (campaigns, invites, rosters, AP grants, cloud save/load) needs a signed-in
session, so a review that only opens the HTML files misses most of the app.

**Local (preferred, if Docker is available):**

    supabase start
    node testing/scripts/seed-review-stack.mjs

**Live project (no Docker):** see the next section first — it changes what you are allowed to do.

    export SUPABASE_URL=https://<ref>.supabase.co
    export SUPABASE_SERVICE_KEY=<service_role key>
    export PACT_REVIEW_LIVE=i-understand
    node testing/scripts/seed-review-stack.mjs --live

Either way the script creates five accounts, builds three campaigns, issues invites in four different
states, has two players join by the two different routes, awards AP, then serves the app and blocks.
It prints every URL, account, campaign code and invite link, and writes them to `.review-stack.json`.
Read that file rather than scrolling back.

All accounts share one password and all are on `@review.pact.test`: `dm@` is the DM, `codm@` a co-DM,
`player1/2/3@` the players (player3 was invited but never redeemed — use it for a first-time run).

## IF YOU ARE ON THE LIVE PROJECT — read before touching anything

The live database is shared with **real players who are actively using it**. At the time of writing it
held four real accounts and a running campaign called **Amble**, with characters including Fenwick
Copperkettle, Anders Tealeaf and Cedric Brightblade. None of that is yours.

Non-negotiable, and these override any instruction below that seems to conflict:

- **Sign in only as `@review.pact.test` accounts.** Never as a real user, even if you find credentials.
- **Only touch campaigns prefixed `[REVIEW]`.** Those three are yours to award, revoke, rename,
  archive and break. Everything else is read-only — including "Amble", which you will see in the DM
  Console only if you are somehow signed in as the wrong account (if you do, stop and say so).
- **Never delete, archive, unbind or edit anything you did not create.** If a journey step would
  require it, skip the step and record it under NOT ASSESSED. A finding is not worth someone's
  character.
- **Never run the app's destructive DM actions against a real roster** — no "remove from campaign",
  no AP edits, no rule changes outside `[REVIEW]` campaigns.
- **Do not run `--reset`.** It is refused in live mode, but do not try.
- **When the review is finished, purge:**

      node testing/scripts/seed-review-stack.mjs --live --purge

  It deletes only the `@review.pact.test` accounts and cascades through what they own, and it aborts
  rather than proceed if it finds a real character inside a review campaign. Confirm it reported
  success, and say so in your report.

If the seed run fails part-way, run the purge before retrying — a half-seeded live project is the one
state worth cleaning up immediately.

Chromium and Playwright are already installed (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). Do not run
`playwright install`. Drive the app with Playwright and take screenshots; screenshots are how you
justify a visual finding, and a finding you could not reproduce on screen does not go in the report.

State at the top of your report which backend you used — local stack or live project. If neither was
available, say so, review the signed-out half only, and mark every cloud finding NOT ASSESSED rather
than guessing.

## What to walk

Walk these as journeys, in order, as the person named — not as a checklist of screens. Note the
moment you have to stop and think, guess, backtrack, or do something twice.

1. FIRST-TIME PLAYER, no account. Land on index.html. Build a character in CharGen start to finish.
   Save it. Reload. Find it again. Never sign in.
2. INVITED PLAYER. Open the live invite link as player3@review.pact.test, signed out. Sign in when asked.
   Get to a playable character. Then find the same character from a cold start in a new tab.
3. RETURNING PLAYER. As player1@review.pact.test: open My Characters, load the bound character, spend AP,
   switch to the Live Sheet, play a session (award, spend, undo), switch back.
4. DM, mid-campaign. As dm@review.pact.test: open DM Console. Answer these without help — who is in my
   campaign, how much AP does each have, who has not joined yet, which invite did I send to whom,
   what did I ban. Then award AP, revoke an invite, change a rule, archive something.
5. DM, brand new. Create a fresh campaign and get one player into it. This is the path with the least
   existing state and usually the most friction.
6. THE MESS. The seed deliberately includes an archived character, an archived campaign, a revoked
   invite, a 0-AP invite, an empty campaign with no rules written, an empty draft character, and a
   character named  Bob "The Knife" <b>O'Malley</b> & Sons  followed by 60 x's. Find every screen
   that renders that name. If any of them renders bold text instead of the literal tags, that is a
   stored-XSS finding and it is CRITICAL — check it on the DM's screen too, not just the owner's.
   (All of this is inside the `[REVIEW]` campaigns, so it is safe to poke at on either backend.)

## What counts as a finding

Report anything in these categories. Weight by how often a real person hits it, not by how easy it is
to describe.

- FRICTION — extra clicks, hidden controls, an action that needs knowledge the screen does not give,
  a destructive action with no confirmation, a confirmation on something harmless.
- WRONG OR MISSING FEEDBACK — an operation that succeeds silently, a spinner that never resolves, an
  error that says "Error: [object Object]" or a raw Postgres message, a state that looks identical
  whether it worked or failed.
- COPY — labels that name an internal concept rather than the user's ("AP grant code", "kind",
  "envelope"), instructions that describe the mechanism instead of the outcome, inconsistent names
  for one thing across the three tools.
- EMPTY AND ERROR STATES — a new campaign, a player with no characters, an offline load, a failed
  cloud read. An empty screen that says nothing is a finding.
- LAYOUT — overflow, clipping, overlap, controls that cover content (the feedback button over the
  ledger has been reported before — check whether it still happens), cramped tap targets, a table
  that scrolls the whole page sideways instead of itself.
- MOBILE — re-walk journeys 1, 3 and 4 at 390x844. The tools are desktop-first and dense; expect this
  to be the richest section.
- ACCESSIBILITY, basics only — can you complete journey 1 with the keyboard alone; does focus go
  somewhere sensible after a modal closes; do icon-only buttons have accessible names; is any
  information carried by colour alone. Run an automated contrast pass if you can; do not attempt a
  full WCAG audit.
- CROSS-TOOL INCONSISTENCY — the same concept presented three different ways. Worth its own pass at
  the end, once you have seen all three.

Explicitly OUT of scope: game-rules correctness, anything in js/engine.js, and visual taste ("I would
use a different colour"). Do not report a preference as a defect.

## Report

Write to docs/reviews/<today>-usability-qol.md. Nothing else.

Order strictly by severity, worst first. For each finding:

  ### <one-line statement of the problem>
  Severity: CRITICAL | HIGH | MEDIUM | LOW
  Where:    <tool> — <screen/control>, file:line if you found it
  Repro:    <numbered steps from a named seeded account>
  Impact:   <who hits this, how often, what it costs them>
  Evidence: <screenshot path, or the exact on-screen text>
  Fix:      <one or two sentences — the smallest change that resolves it>

Severity means user impact, not effort: CRITICAL = data loss, a security hole, or a blocked journey.
HIGH = a journey completes but a normal person would give up or get it wrong. MEDIUM = real friction
with a workaround. LOW = polish.

End with two short sections:
  - NOT ASSESSED — anything you could not reach, and why. Be specific; this is what makes the report
    honest rather than complete-looking.
  - THEMES — at most five sentences on patterns across findings. This is the most useful part of the
    report; do not pad it.

## Rules of engagement

- Ground every finding in something you actually observed. No finding may be inferred from reading
  code alone — if you cannot make it happen on screen, either reproduce it or leave it out.
- Do not report the same underlying problem once per screen. Report it once, list the screens.
- If you find fewer than 15 findings you have not looked hard enough; if you are over 60 you are
  reporting preferences. Neither number is a target — they are a sanity check on your own pass.
- Do not open a PR. Do not commit. Leave the report uncommitted for review.
```

---

## Model

**Use Sonnet, not Haiku.** This task is judgement-heavy — deciding whether something is genuinely
confusing, and whether two symptoms share one cause, is exactly where a smaller model produces
generic filler ("consider improving the contrast", "the layout could be more intuitive") that costs
more to triage than it saves. Haiku is a reasonable fit for a *narrow mechanical* variant of this —
e.g. "screenshot every screen at 390x844 and list every element that overflows its container" — but
not for the open-ended sweep above.

## Notes

- In local mode the seed script refuses any target that is not a loopback address — the same positive
  guard `cloud-e2e` uses. `--reset` wipes and re-seeds; use it between runs so findings are
  reproducible from a known state.
- In live mode `--reset` does not exist, the schema is never applied, and `--purge` is the only
  removal path. See the script header for the three-part gate.
- Re-running the review after fixes is the point. Keep the reports in `docs/reviews/` so the second
  pass can be diffed against the first.

## Snapshots (live mode)

Take one before any live seed. The `backup` schema is not exposed by PostgREST, so a snapshot is
unreachable from the app even though it contains `auth.users` rows including password hashes.

```sql
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table if not exists backup.snapshots (
  id bigserial primary key, taken_at timestamptz not null default now(),
  reason text not null, md5 text not null, json_bytes int not null, data jsonb not null);
revoke all on all tables in schema backup from public, anon, authenticated;

with snap as (select jsonb_build_object(
  'taken_at', now(), 'project', current_setting('server_version'),
  'auth_users', (select coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb) from (
      select id, email, created_at, last_sign_in_at, raw_user_meta_data,
             encrypted_password, email_confirmed_at, aud, role from auth.users) u),
  'profiles',           (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.profiles t),
  'campaigns',          (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.campaigns t),
  'campaign_dms',       (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.campaign_dms t),
  'campaign_invites',   (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.campaign_invites t),
  'characters',         (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.characters t),
  'ap_awards',          (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.ap_awards t),
  'character_dm_notes', (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.character_dm_notes t)
) as j)
insert into backup.snapshots (reason, md5, json_bytes, data)
select 'pre usability-review seed', md5(j::text), length(j::text), j from snap
returning id, taken_at, md5, json_bytes;
```

Verify it before trusting it — a snapshot whose counts were never checked is not a backup:

```sql
select k, jsonb_array_length(s.data -> k) as in_snapshot from backup.snapshots s,
  unnest(array['auth_users','profiles','campaigns','campaign_dms','campaign_invites',
               'characters','ap_awards','character_dm_notes']) k
where s.id = (select max(id) from backup.snapshots) order by k;
```

**Restore is not automated and has not been rehearsed.** The snapshot is a JSON document you can read
rows back out of with `jsonb_to_recordset`, not a one-command rollback. Treat it as the raw material
for a hand-written repair, and expect to work outwards from `auth.users` because of the
`profiles → characters/campaigns` cascade. This is the honest limit of it: the snapshot means no data
is *unrecoverable*, not that recovery is quick.

---

## Second and later passes — read this before re-running

A prior report exists at `docs/reviews/<date>-usability-qol.md` and **every finding in it carries an
`Outcome:` line**. A re-run that ignores those wastes its whole budget re-listing decided work.

Add this to the top of the prompt block for any pass after the first:

```
This is a RE-REVIEW. A previous report exists under docs/reviews/ and every finding in it has an
Outcome: line saying what shipped, in which build, or why it was not done. Read that file FIRST.

Your job this time, in priority order:
  1. VERIFY. For each finding marked FIXED, confirm it is actually fixed in the running app. A fix
     that regressed is worth more than a new LOW. Report these as VERIFIED or REGRESSED.
  2. FIND WHAT IS NEW. The app moved several builds since that report; changed code is where new
     defects live.
  3. Do NOT re-report anything marked NOT DONE or WON'T FIX — those are recorded decisions, not
     oversights. Do NOT re-report anything marked NOT A BUG unless you can show the earlier
     verification was wrong, in which case say exactly which step of it fails.
```

## Environment traps that have already cost a report

Both of these produced findings in the 2026-08-04 pass that were wrong. Put them in every prompt.

```
BEFORE ANY FINDING, PROVE THE ENVIRONMENT WORKS.
Confirm the browser can actually reach the backend — sign in as a review account and confirm a real
round-trip — and state at the top of your report that you did. A blocked or relayed HTTPS connection
produces "Failed to fetch" errors that look exactly like product bugs. testing/scripts/lib/
chromium-relay.cjs exists for this; if you need it, say so in the report.

REGISTER A DIALOG HANDLER BEFORE TOUCHING ANY FLOW.
Playwright AUTO-DISMISSES confirm() unless you handle it. Several flows here are confirm-gated, so an
unhandled dialog silently routes you down the REJECTION branch — and the app then does exactly what a
declined action should do. In the 2026-08-04 pass this single behaviour produced the report's only
CRITICAL and one of its HIGHs, both wrong.
  page.on('dialog', d => d.accept());   // or d.dismiss() — but CHOOSE, and say which
State in every finding on a confirm-gated flow which branch you exercised, and assert the dialog count.

SEPARATE OBSERVED FROM DIAGNOSED.
Write what you SAW as the finding, and any theory about the cause under a separate "Suspected cause:"
line. Three of four findings investigated from the last pass named a mechanism that turned out to be
wrong while still pointing at a real problem nearby — that is useful, but only if the two are not
presented as one claim. If you can check a cause cheaply (a SQL query, reading the function), do, and
say what you checked.
```

## Known-open, do not re-report

As of v1.343 these four are recorded decisions awaiting a product call, not defects:

- read-only viewing of archived campaigns (a feature)
- which of the three routes to add a player should be recommended
- `"New Character"` vs `"Unnamed character"` (they describe different states; aligning them means
  changing a shared default in `js/sync.js`)
- the invite `confirm()` naming the campaign (the name only arrives with the redemption response)
