# 2026-07-16 — AI-workflow reconciliation batch (rename + agents rules + close-session + dev-status)

Reconciled this repo against the human's cross-project "AI Workflow Standard" (handed over as
`PACTcopilotonlystandardreconciliation.md`, written for a chat session, not a code one). Shipped as four
stacked PRs (#228–#231) into `preview`, reviewed twice, then promoted `preview` → `main` (#232, CI green).

## What actually happened

The reconciliation doc read as a big build list, but auditing the repo first showed **~70% was already
done** (canonical `AGENTS.md` + stubs, structured `DECISIONS.md` with the collision-proof
`D-GH-<date>-<slug>` scheme, `docs/sessions/`, NOW/NEXT/LATER bands + `Done when`, a git-aware
`/close-session`). So the work was a **delta**, not a rebuild — and in two places the doc would have been a
regression here. Key point for a future agent: *don't implement a cross-project standard literally against
a repo that seeded it; compute the delta first.*

## Decisions worth remembering (full rationale in DECISIONS.md)

- **Rename `PACT_ROADMAP.md` → `TASK_BOARD.md` (#228).** I *recommended against* it (churn, no functional
  gain, content already reshaped); the human chose to rename anyway for cross-project naming consistency.
  Scoped it to **file + live pointers only** — historical records (`DECISIONS.md`, past `CHANGELOG` lines,
  `docs/sessions/*`, `docs/plans/*`) were deliberately left naming the old file, since rewriting them would
  falsify history. Verified `roadmap.html` is a hand-regenerated baked-in snapshot (no runtime fetch, no
  committed generator), so the rename broke nothing functional — only the footer *label*.
- **`/close-session` → write + propose, not stage (#230).** Two calls: (a) the repo's single-writer rule
  beat the doc's "log new tasks onto the board" — the skill only *removes* finished items; (b)
  propose-don't-stage, because a skill running `git add` in a shared checkout could sweep in another
  session's work. (This very run is the first exercise of the new behavior.)
- **`dev-status.html` fetches live, doesn't bake (#231).** Opposite of `roadmap.html` on purpose — a glance
  page's value is being current. Documented so nobody "fixes" the inconsistency later.
- **`dev-status.html` gated to signed-in users** — added late, on the human's request. Important honesty
  note recorded in DECISIONS: this is a **UX/visibility gate, not a security boundary** — the three source
  docs are public on GitHub Pages, so the data is readable by anyone with the URL regardless. There is no
  per-account player/DM role in this app (DM-ness is per-campaign), so "any signed-in user" is the honest
  scope.

## The one real bug (why the review mattered)

`/code-review` (max, then high) on the dev-status page caught a genuine defect I'd missed: `parseChangelog`
required the closing `**` on the *same line* as `- **`, so it **silently dropped every changelog entry
whose bold title wraps** — the "Recent changes" card showed a wrong, non-contiguous set. My own headless
verification had actually *shown* the symptom (a jump from one 2026-07-16 entry to a 2026-07-15 one,
skipping two) but I didn't cross-check against file order. Fixed by splitting on entry boundaries and
matching the title across newlines; re-verified. Lesson: when verifying a "show the newest N" feature,
assert the result *equals the true newest N from the source*, not just that N non-empty items rendered.

## Process notes

- Stacked PRs merged cleanly but needed **manual base-retargeting** to `preview` at each step — GitHub only
  auto-retargets a child PR when the parent branch is *deleted*, and we kept the branches. `update_pull_request`
  base=preview before each merge kept every diff clean.
- Promotion to `main` is a PR from `preview` (the repo's `chore(release): promote preview → main` pattern),
  gated on two CI checks (`audit`, `e2e`); waited for both green before merging to production.

## Follow-ups left open (for the single-writer human)

- The LATER task **"Rename docs/TASK_BOARD.md + DECISIONS.md to a new naming convention"** now partially
  overlaps #228 (the roadmap half is done under a different rationale). Reconcile or close it.
- The human's external local `for-copilot` mirror script needs its input path updated
  `PACT_ROADMAP.md` → `TASK_BOARD.md`, or the task-board mirror silently stops updating.
- Remote PR branches (#228–#231 heads) still exist on GitHub — local copies were cleaned up via
  `/cleanup-branches`; the remotes are optional to prune.
