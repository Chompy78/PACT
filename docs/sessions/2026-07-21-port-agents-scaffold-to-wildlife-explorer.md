# 2026-07-21 — port the AGENTS.md/skills scaffold to a fourth repo, wildlife-explorer

## What happened

Same session as `docs/sessions/2026-07-21-port-agents-scaffold-to-family-hub.md`, immediately after
that port: the user asked to do "the same" for `chompy78/wildlife-explorer`, a child-friendly React/
TypeScript wildlife-exploration game, currently at Milestone 5. Done via direct local access to the
target repo's clone (`C:/Users/user/dev/wildlife-explorer`).

Reading the target's real state first (the same discipline both prior ports established) surfaced that
"the same" wasn't actually the right outcome — this repo's shape was closer to `homelife`'s (mature,
existing real conventions) than `family-hub`'s (docs but no governance), the opposite of what "do the
same" might have suggested taken literally. Said so plainly before proceeding, rather than either
blindly replicating family-hub's build-fresh approach or silently deciding unilaterally — the user
confirmed the adapted plan before it was executed.

## The target repo's shape — confirms the "three independent axes" pattern

This repo already had a real, working governance file (`AI.md` — Canon, Scope boundary, verification
command), a genuinely functioning test/build/encoding-audit gate (`npm run check`, 18 passing tests),
and an established narrative `docs/sessions/` convention already in active use. None of that existed in
`family-hub`. This is the case that confirms the observation family-hub's own port note made in passing:
the shape space isn't a single "blank slate ↔ mature" spectrum — it's at least three independent axes
(governance layer present/absent, product-planning docs present/absent, a real automated verification
gate present/absent), and this repo is the first case where a strong verification gate existed
independently of any AI-workflow scaffold at all.

## Decision: additive, not build-fresh

Rather than creating a competing `AGENTS.md` as the primary entry point (family-hub's approach, correct
there because no equivalent file existed), `AI.md` was left completely untouched and `AGENTS.md` was
scoped narrowly — its own first line tells the reader to read `AI.md` first, and it only adds the
process layer (task format, decision logging, communication conventions) `AI.md` doesn't cover. Full
reasoning logged in wildlife-explorer's own `DECISIONS.md` (`D-2026-07-21-scaffold-port`), not
duplicated here. Also logged there: the branch-model decision (commit straight to `main`, same as
family-hub) explicitly notes this repo is *closer* to being ready to reverse it than family-hub is,
since `npm run check` already exists — wiring it into CI would be a small lift, not a redesign.

Other conventions respected rather than overridden: `docs/TASK_BOARD.md` was seeded from
`CURRENT_CODE_REVIEW.md`'s real open items (not invented); the new session note used this repo's own
`WILDLIFE_EXPLORER_SESSION_LOG_<date>...` naming and narrative style rather than PACT's terser
`<date>-<topic>.md` format; `CHANGELOG.md` existed as a completely empty file and was filled in with a
real backfill rather than left empty or silently ignored.

## Why this is worth a note

Fourth port total (`petdetective`, `homelife`, `family-hub`, now this one), and it's the strongest
evidence yet that "read the target's real state before choosing build-fresh vs. additive" isn't
optional caution — a literal "do the same as last time" would have been actively wrong here, not just
suboptimal, because it would have either duplicated or silently ignored a governance file this project
genuinely depends on. Worth carrying forward for a fifth port: check specifically whether a real
automated verification gate already exists, independent of whether `AGENTS.md`-shaped docs exist — this
repo had one without the other, which nothing before it had shown.

## Status

Live and committed in wildlife-explorer's own repo (see that repo's own session note and `git log` for
the commit). Nothing in PACT itself changed as a result of this session beyond this note and the sibling
family-hub one.
