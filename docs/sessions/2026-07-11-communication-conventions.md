# 2026-07-11 — Fixing how the agent asks questions and presents options

## What happened
Partway through an otherwise roadmap-task-focused session, the user raised three separate process
complaints about working with this repo's skills, all at once: (1) `/pick-task`'s `AskUserQuestion`
selection sometimes isn't respected — it "gets confused and does something," or picks for itself; (2)
`/close-session` ends with a flat list of possible actions with no indication of which ones are actually
recommended, or why; (3) a personal response-format preference (tiered `A`/`A1`/`A2` lettering, stated
recommendations with reasoning) that the user has evidently asked for before "keeps getting lost."

This was treated as a genuine scope pivot, not a quick aside — the rest of the session became about
diagnosing and fixing the agent-tooling itself (`AGENTS.md`, `.claude/commands/*.md`), not PACT app code.

## Diagnosis
- **`/pick-task`'s `AskUserQuestion` issue had a live example this same session:** the very first
  `AskUserQuestion` call earlier tonight failed outright (`Tool permission request failed: ... stream
  closed before response received`) before any answer was captured. It was noticed and retried manually —
  but nothing in `pick-task.md` required that retry, or forbade silently treating the failure as if the
  Recommended option had been chosen. That gap matches the user's reported symptom exactly.
- **`/close-session`'s flat list was working exactly as written**, not a bug: its Output format section
  literally instructed "list every possible further action as a flat, numbered set (`A1`, `A2`, `A3`...)"
  with no recommend/don't-recommend distinction anywhere in the file. Any "(Recommended)" tagging seen in
  earlier turns tonight was ad hoc improvisation, not something the skill required — which is exactly why
  it was inconsistent.
- **The response-format preference had nowhere durable to live.** Checked `~/.claude/CLAUDE.md` in this
  environment — it doesn't exist. A preference that only ever gets stated in conversation survives exactly
  as long as it stays salient in context, and loses to anything actually *written down* and in-context —
  which is precisely what happened: `close-session.md`'s own committed, specific "flat A1/A2/A3" instruction
  was directly competing with, and beating, an unwritten personal preference every time that skill ran.

## Decisions made (walked through as a lettered Q&A, per the format being fixed)
- **Where the preference persists:** committed into `AGENTS.md` (repo-scoped, git-tracked, guaranteed to
  survive container resets, auto-loaded every PACT session) rather than `~/.claude/CLAUDE.md` — that file
  doesn't exist in this environment, and whether this remote/web execution model's home directory even
  persists between sessions at all is genuinely unresolved (the system prompt only guarantees git-tracked
  content survives). **Open question, deferred to the user's next-session test:** if they also use Claude
  Code locally, `~/.claude/CLAUDE.md` would be the right mechanism for a preference that should apply
  everywhere, not just on PACT — worth revisiting once/if that's confirmed.
- **`AskUserQuestion` reliability rule:** general, in `AGENTS.md` (not `pick-task.md`-only), so any future
  skill using the tool inherits it automatically. Retry is silent unless it fails twice — but explicitly
  must be a *genuine* re-ask, never a silent substitution of a default/Recommended option as if it were the
  real answer (the user's specific correction: that substitution, not retry noise, was the actual bug).
- **`close-session`'s recommendation bar:** recommend by default; withhold only for destructive/irreversible
  actions, judgment calls only the user can make, or missing information. Explicitly rejected a stricter
  "never auto-recommend merges" carve-out — that would have recreated the exact over-cautious deferral
  pattern the user was pushing back on ("I'd rather get things done there and then").
- **Still report-only:** recommending an action never means running it unprompted; `close-session` still
  waits for an explicit go-ahead even on Recommended items. Tonight's own merge-without-explicit-approval
  incident on PR #152 (see the earlier session note) was a live argument for keeping that boundary.
- **`pick-task`'s native `AskUserQuestion` options** also now require a one-line reason per option (not
  only the recommended one) in the tool's own `description` field — extending the same "state the
  reasoning" discipline to a native-UI decision, not just prose lists.

## What landed
PR #160 → `preview`: a new "Communication conventions" section in `AGENTS.md` (tiered lettering format,
`AskUserQuestion` error handling, the recommend-by-default bar), plus matching updates to `pick-task.md`
Step 4 and `close-session.md`'s Output format, both pointing back at `AGENTS.md` rather than duplicating
the rules. `DECISIONS.md` gets `D-GH46`.

## Why this note exists
Two triggers: the plan changed mid-session — not a nice-to-have, the user explicitly redirected effort
toward fixing the tooling itself — and several of the decisions above (especially where the preference
should live, and the recommendation bar) were genuine judgment calls with more than one defensible answer
that a future agent could reasonably have made differently.

## Not yet done
- **Live-testing** that `/pick-task` and `/close-session` actually behave as intended now — deliberately
  left for the user to do in a fresh session (the whole point being to test whether the fix holds without
  the same context that produced it).
- **Five branches from tonight's work are still on GitHub** with merged PRs but no local ref anymore
  (`docs/batch-pre-release-qa-checklist-plus2`, `docs/close-stale-scroll-position-roadmap-entry`,
  `docs/update-session-note`, `docs/dgh45-followup-fixes`, `docs/communication-conventions`) — remote
  branch deletion 403'd from this session's credentials (no GitHub MCP tool covers it either), matching
  the already-logged `ai-lessons-learned` lesson `H-020` (push access ≠ delete access for remote-session
  creds). Left for manual cleanup via GitHub's UI.
