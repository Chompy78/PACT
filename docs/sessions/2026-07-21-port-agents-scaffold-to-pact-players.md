# 2026-07-21 — light-port the memory-layer scaffold to a fifth repo, PACT_Players

## What happened

Same broader effort as the `family-hub`/`wildlife-explorer` ports (2026-07-21 — see note below on a
date-labeling mistake), extended to `chompy78/PACT_Players`: a Quartz-based static site publishing TTRPG
campaign content for players, not a software project. Recognized before building anything that the full
scaffold (task board, `AGENTS.md`, Effort/Risk-tagged skills) doesn't fit content-authoring work — no
code test gate, no unit-of-work that decomposes into sweep-eligible tasks. Presented options (full port /
skip entirely / light memory-layer-only port) and the user picked the light option.

## A real collision, caught before it happened

Mid-port, the user flagged that a `TASKS.md` file should exist. Investigating found it did — a
**different, concurrent Claude Code session** had already authored and merged a real `TASKS.md`
(`e1e8886`, "Track fast-path Quartz tasks for the PACT Player Agent plan," which also touches a separate
`AI_home_server` repo's own task board) while this port was independently in progress. A placeholder
`TASKS.md` had already been drafted here and would have overwritten it. Caught by fetching/pulling fresh
before committing rather than trusting the session's own working-tree state — exactly the kind of check
`chompy78/PACT`'s own `git add -A` caution (`D-GH-2026-07-16-close-session-auto-log`) exists for, just
surfacing via a different mechanism (file authorship collision, not `git add` sweeping in unrelated
changes).

## A self-caught date-labeling mistake — corrected in a follow-up

Separately, this session mislabeled every date across `family-hub`, `wildlife-explorer`, this repo's
first draft, and both of PACT's own prior port session notes as **2026-07-20**, when the actual date was
**2026-07-21**. Caught and fixed in `PACT_Players` immediately (nothing was committed yet, so cheap).
`family-hub` and `wildlife-explorer` were already pushed with the wrong date baked into filenames and
decision IDs — flagged to the user with two options (leave as cosmetic, or add correction commits); the
user chose correction. Fixed as new commits (not history rewrites) in both repos plus this repo's own
two session notes — see `family-hub`'s `62d0a1d`, `wildlife-explorer`'s `d2fb9b9`. One real near-miss
during the fix itself: an overly broad `sed` pattern briefly renamed a *different, concurrent* session's
decision ID in `wildlife-explorer` (`D-2026-07-20-branch-model-confirmed`, from an unrelated status-
review session) — caught by re-grepping immediately after and reverted before committing. Worth a
generalizable lesson: word-boundary regex isn't enough to isolate "my own" IDs from someone else's
similarly-prefixed ones in a shared file — check for accidental collateral matches after any bulk
find-replace, especially one touching content you didn't author.

## What got built (light port, then corrected mid-session)

- `CHANGELOG.md`, `DECISIONS.md` — new, three decisions logged: a formalized pre-existing content rule,
  the light-port call itself, and the `TASKS.md`-discovery correction.
- `sessions/` at **repo root**, not `docs/sessions/` — this repo's `docs/` is entirely Quartz's own
  vendored upstream documentation, not a place for project notes. Worth remembering for any future
  Quartz-based (or similarly vendored-tool-based) port.
- 4 of PACT's 8 skills: `add-task` (added in a follow-up round, once the real `TASKS.md` confirmed the
  content was genuinely task-shaped, just without Effort/Risk tags), `close-session`, `cold-plan-review`,
  `log-lesson`. **Not added:** `pick-task`/`run-task`/`sweep-tasks` — `TASKS.md`'s real content confirmed
  rather than undermined the original call: its items are one-off human-judgment decisions, not a queue
  of independently-safe, automatable work.
- `TASKS.md` itself was **not** authored by this session — adopted as-is from the concurrent session's
  real one, including its actual `## Open`/`## Done / not needed` structure and its cross-reference to
  the separate `AI_home_server` project.

## Why this is worth a note

Two generalizable lessons, both candidates for `ai-lessons-learned` (not yet drafted/pushed as of this
note): first, a "which shape is this port" question needs a prior question — "is this even the kind of
project this scaffold was built for" — which this repo's `docs/sessions/2026-07-21-port-agents-scaffold-
to-family-hub.md` note didn't yet have language for, since it's the first of five ports that needed
"skip most of it" as the answer. Second, and more general than scaffold-porting specifically: a shared
checkout can hold another session's *newly-authored* file, not just in-flight edits to an existing one —
checking `git status` on your own working tree isn't enough; fetching/pulling before authoring something
you haven't yet confirmed doesn't already exist is the actual safeguard.

## Status

Live and committed in `PACT_Players` (`7ff0da3`). The date-labeling correction for `family-hub`/
`wildlife-explorer` is still an open question for the user, not yet actioned. Nothing in PACT itself
changed as a result of this session beyond this note.
