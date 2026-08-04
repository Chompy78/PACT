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
session, so a review that only opens the HTML files misses most of the app. Use the seeded local
stack — it is a throwaway Supabase instance, never production:

    supabase start
    node testing/scripts/seed-review-stack.mjs

That applies the schema, creates five accounts, builds three campaigns, issues invites in four
different states, has two players join by the two different routes, awards AP, and then serves the
app and blocks. It prints every URL, account, campaign code and invite link you need, and also writes
them to .review-stack.json. Read that file rather than scrolling back.

All accounts share one password. dm@pact.test is the DM, codm@pact.test a co-DM, player1/2/3@pact.test
the players (player3 was invited but never redeemed — use it for a first-time-player run).

Chromium and Playwright are already installed (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). Do not run
`playwright install`. Drive the app with Playwright and take screenshots; screenshots are how you
justify a visual finding, and a finding you could not reproduce on screen does not go in the report.

If `supabase start` is unavailable (no Docker), say so explicitly at the top of your report, review
the signed-out half only, and mark every cloud finding as NOT ASSESSED rather than guessing.

## What to walk

Walk these as journeys, in order, as the person named — not as a checklist of screens. Note the
moment you have to stop and think, guess, backtrack, or do something twice.

1. FIRST-TIME PLAYER, no account. Land on index.html. Build a character in CharGen start to finish.
   Save it. Reload. Find it again. Never sign in.
2. INVITED PLAYER. Open the live invite link as player3@pact.test, signed out. Sign in when asked.
   Get to a playable character. Then find the same character from a cold start in a new tab.
3. RETURNING PLAYER. As player1@pact.test: open My Characters, load the bound character, spend AP,
   switch to the Live Sheet, play a session (award, spend, undo), switch back.
4. DM, mid-campaign. As dm@pact.test: open DM Console. Answer these without help — who is in my
   campaign, how much AP does each have, who has not joined yet, which invite did I send to whom,
   what did I ban. Then award AP, revoke an invite, change a rule, archive something.
5. DM, brand new. Create a fresh campaign and get one player into it. This is the path with the least
   existing state and usually the most friction.
6. THE MESS. The seed deliberately includes an archived character, an archived campaign, a revoked
   invite, a 0-AP invite, an empty campaign with no rules written, an empty draft character, and a
   character named  Bob "The Knife" <b>O'Malley</b> & Sons  followed by 60 x's. Find every screen
   that renders that name. If any of them renders bold text instead of the literal tags, that is a
   stored-XSS finding and it is CRITICAL — check it on the DM's screen too, not just the owner's.

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

- The seed script is destructive to the **local** stack only; it refuses to run against anything that
  is not a loopback address, on the same production guard cloud-e2e uses.
- `--reset` wipes and re-seeds. Use it between review runs so findings are reproducible from a known
  state.
- Re-running the review after fixes is the point. Keep the reports in `docs/reviews/` so the second
  pass can be diffed against the first.
