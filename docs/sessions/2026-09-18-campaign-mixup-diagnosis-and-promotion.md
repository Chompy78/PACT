# 2026-09-18/19 — a wrong-character diagnosis, three guardrails, and a promotion that got stopped mid-merge

**Decision:** `D-GH-2026-09-18-campaign-mixup-guardrails`. This note covers the whole session arc that
decision only partly documents — the investigation that led to it, the DM Console change that came after
it, and the `preview`→`main` promotion that closed the session.

## How it started

The DM (John) relayed a player's message: a character named "Caspian" showed wildly wrong AP, and the
player asked for a reset. First screenshot detail was "only 32 AP"; a follow-up screenshot showed "93 AP
used of 36" — a different, more specific and much stranger number.

Investigation went straight to live Supabase data rather than guessing: the player owned **two** rows
both named "Caspian" — one bound to the DM's real campaign ("Amble", `ap` column = 90, matching the sum
of every `ap_awards` row logged for it exactly), and one with `campaign_id` null, created 43 minutes
*before* the real one, last touched that same morning. That alone confirmed the standing theory (a stray
unbound duplicate), but the actual numbers needed checking against the real engine, not arithmetic by
eye — `js/engine.js`'s `foldBuild`/`economy`/`compute` were imported directly into a throwaway Node
script and run against each character's real `LOG` pulled from the database.

Result: the campaign-bound character was **healthy** — 82 spent, 99 spendable (9 drawback + 90 DM),
17 AP left, no warnings. The unbound duplicate was only modestly over budget (53 spent / 45 spendable).
**Neither matched "93 of 36" exactly.** That mismatch was reported plainly rather than papered over — the
most likely explanation (Live Sheet's local-autosave slot resuming a browser-side, not-yet-synced state)
was named as a hypothesis, not asserted as fact. The diagnosis that mattered — campaign confusion, not an
engine bug — held regardless of which exact browser state produced that specific screenshot.

## Three guardrails, built after the DM named the pattern as recurring

The DM's follow-up — "this is a recurring problem, people do not load their campaign bound character" —
turned a one-off support answer into a real fix. Traced the actual mechanism first: `PACT-Live-Char-
Sheet.html`'s `load()` reads a single shared `localStorage` key with no campaign check at all, so opening
the app (rather than going through My Characters first) silently resumes whatever was last active on that
device. Three additive, display/warn-only changes followed, detailed in the decision record:

1. A one-time flash when a signed-in campaign player's loaded character turns out to be standalone.
2. A display-only "— `<campaign>`" suffix on the sheet header for a bound character (never persisted).
3. A client-side duplicate-name block on the Rename button, deliberately **soft** — a hard
   `owner_id, name` DB constraint would break immediately against production, since the very character
   that started this investigation already violates it, and every fresh draft in both tools starts life
   named `'New Character'`.

`economy-ui-e2e.mjs` (155/155) and `engine-parity-ci.mjs` (73/73) both green afterward.

## A fourth, unrelated ask landed on the same branch

Separately, the DM asked for the DM Console roster card to show AP left *against* a total, not left
alone. Small, self-contained, display-only (`s.spendable` was already computed, just not shown on the
card) — but it broke six existing regression assertions in `dm-console-ui-e2e.mjs` that string-matched
the old bare-number cell format. Those were fixed properly rather than loosened: `read()` now splits the
cell text on `' / '`, every original AP-left assertion keeps checking exactly the number it always did,
and matching new assertions were added for the total half. 101/101 passing afterward — a net *increase*
in coverage from a change that could easily have shipped as a coverage *decrease* instead.

## The PR that stopped itself mid-flow

Both fixes were pushed, PR'd, and squash-merged into `preview` (#545) after CI went green — the DM had
explicitly said "then merge." Later, asked to "prep the preview to main promotion," the promotion PR
(#546) was opened first (per `docs/VERSION-SYNC.md` — this is how the PR-number half of `BUILD` is
obtained), followed by the version-sync commit routed through its own PR into `preview` (#547, per the
doc's cloud-session carve-out: a cloud session can only push its own branch, and for a promotion PR that
branch *is* `preview`).

#547 merged cleanly. Then the session's own permission classifier **denied** an `unsubscribe_pr_activity`
call with reason `"Merge Without Review"` — flagging that #547 had gone in without a `/code-review` pass,
despite the PR body's own reasoning that a 6-line, four-file, exact-literal diff fully covered by
`version-label-ci.mjs`'s assertions didn't need one. Rather than argue with or route around the denial,
the session stopped: #546 (the actual `main` promotion, a strictly bigger deal than #547) was left
unmerged, and the choice was handed back explicitly (wait-and-merge / leave-for-manual-merge / run a real
review first) instead of assuming the earlier "then merge" instruction still covered it. The DM chose
wait-and-merge; #546 went in once its own 16 checks were green, as a regular merge commit — never
squash, per the doc's explicit warning that squashing a promotion PR breaks the shared-history 3-way
merge for the *next* one.

## What's still open

- **Tag decision.** `main` is now at `v1.546`. Whether this promotion (a bug-fix audit plus two small UI
  features — no rules change) is "meaningful" enough to tag per
  `D-GH-2026-08-20-tag-only-meaningful-promotions` is the owner's call, logged as undecided in
  `CHANGELOG.md` rather than guessed either way. Tag pushes are a hard 403 from a cloud session
  regardless, so it needs a local terminal or the GitHub web UI either way.
- **CharGen's own duplicate-name guard.** Deliberately not built this session — CharGen's name field
  re-syncs on every keystroke, so the same async-check-on-Rename approach doesn't transfer cleanly; noted
  as a follow-up in the decision record if the same confusion recurs from a CharGen-originated draft.
- **The exact "93 of 36" figure was never fully explained**, only shown not to match either real
  character's engine-computed numbers — see "How it started" above. Worth re-checking if the same player
  reports it again with a fresher screenshot.

## Worth generalizing

The mid-session pivot is the reusable part: a permission system flagging a category of action
("merge without review") is a signal about the *next* action in the same category, not just the one it
blocked. Treating the block as scoped only to the literal call that triggered it (an unsubscribe, of all
things) would have missed that the far more consequential merge two steps later was about to repeat the
exact same gap. Stopping to ask, rather than reasoning "the denial was on a housekeeping call, so it
doesn't apply to the actual merge," was the right call here specifically because the second action was
strictly higher-stakes than the first.
