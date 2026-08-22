# 2026-08-20 — Premium autogrowth to stepped: implementation, owner design pass, and a guide-data course correction

Started as "review `pact-guide`'s D-2026-08-19-premium-autogrowth-to-stepped and its task board" and grew
into a full implementation session with a live design conversation on top of the source decision.

## The cold-review-plan loop, twice

Before touching code, drafted a self-contained plan for external cold review (the "big/risky, multi-file,
engine-touching" trigger in `AGENTS.md`). v1 promised finalized step tables and never included them — all
4 reviewers (DeepSeek, Copilot/Claude Opus 4.8, M365 Copilot/GPT-5, GPT-5.6 Luna) caught it independently,
plus a "checked by hand for one step" claim over-generalized to "every step." v2 fixed both: full tables
added, and all 13 originally-planned post-unlock steps re-verified by hand against the real `MASTER`
pricing table (all matched a `round_half_up(0.5×)` relationship exactly). v2 also resolved a block-vs-warn
ambiguity three reviewers flagged as potentially fatal to the goal, by reading `compute()` directly:
today's prerequisite mechanism is warning-only, full stop, for every feature that uses it.

## Live design conversation, owner-directed

Once v2 landed, the owner walked through the actual numbers interactively — asking for the existing
`rep:true` stepped features (Sneak Attack, Martial Arts die, Unarmored Movement, discovering Metamagic
shares the flag but is a different mechanism entirely and should be un-conflated later), comparing full
tables under different band assignments, and settling on:
- Wild Shape's Capability track: At-Will → **Passive** (a live change from mid-conversation).
- Unarmored Movement's post-unlock steps: Passive → **Situational**, unlock kept Passive.
- The prerequisite check becomes an actual **hard block**, scoped per track (confirmed explicitly: Rage's
  Damage track never gates on its Uses track, and vice versa for Wild Shape).
- All 6 features (not just the original 3) get the same "Premium/ordinary unlock, then half-price named
  steps" shape — a real, explicit scope decision, made after seeing full-career cost tables for all six
  side by side and an explicit warning that the other 3 are already-shipped, not pre-launch-only.

This produced plan v3, folding in the owner direction with the same rigor as the cold-review findings —
including naming a real side effect: widening the shared prereq check also hard-blocks the 8 existing
Warlock invocation prerequisites, previously warn-only.

## The course correction

Implementing Sneak Attack/Martial Arts die/Unarmored Movement's steps started with invented placeholder
labels ("tier 2", "tier 3", …) at consecutive tiers, reasoning no verified breakpoint data existed for
them — `AGENTS.md`'s own "verify before writing an absence claim" rule, under-applied. Running
`testing/scripts/guide-price-check.mjs` mid-session (initially just to confirm the guide hadn't drifted)
surfaced that the guide's own Rogue and Monk class tables **already had real, correct 5e breakpoints** for
all three — Sneak Attack scales at 10 points not 7, Martial Arts die has only 3 real upgrade tiers (L5/
L11/L17), Unarmored Movement skips T3 entirely (L2/L6/L10/L14/L18) — just never wired into
`engine-data.js`, whose `rep:true` auto-formula produced different numbers than what the guide had been
describing all along. Replaced the placeholder data with the guide's real breakpoints before landing
anything — the guide's own price table was the missing verification step this repo's rule calls for.

## `/code-review ultra` caught two real bugs

1. The "Invocation breadth surcharge" counted a hard-blocked invocation toward the breadth of genuinely-
   owned ones (`_invN` wasn't filtered against the new `_blockedFeat` set) — overcharging AP for
   something the engine itself now declares unowned. New fixture CG-032 is a permanent regression guard.
2. Two guide callouts I'd just written self-contradicted the guide's own Section 11 tables, describing
   Martial Arts die and Unarmored Movement as "full price, no discount" when they're half price like
   everything else in this change — an error caught by re-reading my own prose against my own data, not
   by anyone else's oversight.

Both fixed in the same session, with `guide-price-check.mjs` re-run to confirm 0 mismatches (was 17
price-mismatches before the class-table numbers were corrected, all in Sneak Attack/Martial Arts die/
Unarmored Movement rows — nothing in Rage/Wild Shape/Bardic Inspiration, whose unlock prices never moved).

## What's still open

The `pact-guide` project's canonical guide **master** (not this repo's served copy) still needs the
identical transfer, per `docs/VERSION-SYNC.md`'s manual, verified procedure — this repo cannot perform or
confirm that from here. `pact-guide`'s own `D-2026-08-19-premium-autogrowth-to-stepped` record's Status
section should be updated once that transfer lands. Metamagic's `rep:true`-shared-with-stepped-abilities
flag conflation (discovered, deliberately deferred by the owner) is a separate future task, not part of
this change.

## Net result

`js/engine.js` widens the prerequisite check to a hard block; `js/engine-data.js` (`DATA.version`
v0.357→v0.358) converts 6 features to stepped-Premium/half-price pricing across 22 new step entries;
12 new regression fixtures; `docs/PACT-Players-Guide.html` rewritten throughout on Premium/stepped
pricing with 0 verified price-mismatches; `tools/PACT-CharGen-Webtool.html` and `DM-Console.html` wire
the new "Blocked purchases" ledger line into their existing category groups. Full decision record:
`decisions/2026/D-GH-2026-08-20-premium-autogrowth-to-stepped.md`.

## Follow-up, same day: unbarring Rage/Wild Shape/Bardic Inspiration die (PR #441)

Once PR #438 merged, the owner asked to lift the 2026-08-19 `bar:true` flag on these three features
(`D-GH-2026-08-19-bar-blocked-features`) now that the pricing defect it existed to contain is fixed.
Straightforward in principle — remove the flag from 3 `DATA.features` entries, no `DATA.version` bump —
but the first attempt hit a real trap worth recording: `git pull origin preview` failed with a
"divergent branches" error (local `preview` was 275 ahead / 81 behind `origin/preview`), and a branch was
cut directly from that stale local ref instead of resolving the divergence first. The stale branch's copy
of `js/engine-data.js` predated 2026-08-19 entirely, so a grep for `"bar":true` came back empty — which
looked exactly like "someone already fixed this," not like "this branch is missing 81 commits." Caught
only by deliberately re-fetching and diffing against `origin/preview` before trusting that result. The
branch was discarded and recreated from `origin/preview`'s true tip (the PR #438 merge commit), where the
flag was confirmed still present; the actual fix — a one-line removal per entry — then proceeded normally.
Landed as PR #441, `CHANGELOG.md`/`DECISIONS.md`/the bar-blocked-features record all updated. General
lesson (candidate for `ai-lessons-learned`, not project-specific): a `git pull` "divergent branches"
error means don't trust further work on that local ref at all — re-fetch and re-derive from the remote's
actual tip before drawing any conclusion from what is or isn't present on the branch.

## Second follow-up, same day: the CI path-filter gap, the preview→main promotion, and a mispointed tag

While checking PR #441's CI status before merging, only 2 of the repo's 11 real workflow gates had run
(`Lighthouse CI`, `Service-worker staleness e2e`) — none of `engine-parity`, `tool-pricing`,
`static-audit`, `chargen-flows`, `dm-console-ui`, `character-gen-e2e`, or `cloud-e2e` triggered. Reading
each workflow's `on: pull_request: paths:` list directly showed why: all seven watch `js/engine.js` but
none watch `js/engine-data.js` — the file REV-14a split `DATA` out into. PR #441 touched only
`engine-data.js`, so it silently skipped every gate meant to catch a `DATA`-driven `compute()`
regression; it merged green only because nothing red ever ran, not because the relevant checks passed
(they were verified manually instead — 52/52 parity, 29/0 audit — matching what CI would have shown).
Logged as a NEXT task (`ci/engine-data-path-filters`) rather than fixed inline, since it's a repo-wide
config gap outside either PR's own scope.

With #440 and #441 both merged (standing approval: "merge both once CI is green"), the owner asked to
promote `preview` → `main`. Opened PR #442, set `BUILD` to `v1.442` (major carried forward from
`v1.439`) in `js/engine.js` and mirrored it in the three tools per `docs/VERSION-SYNC.md`'s procedure,
and merged once all 11 CI checks went green.

**The tagging step surfaced two separate problems, not one.** First, the owner pushed back on being
asked to tag *every* promotion: `git tag -l` showed only 13 tags across far more than 13 real
promotions, so "tag every promotion" (what `VERSION-SYNC.md` step 6 said unconditionally) was never
the actual practice — just an unstated literal reading of a doc line nobody had been following. Second,
checking that same tag list turned up a tag already named `v1.442` — pointing at `f6b44ef`, the
**v1.439** merge commit, not any real v1.442 content, since PR #442 hadn't even merged yet at the time
it was found. Both `git push origin --delete v1.442` and the GitHub MCP tool surface (no
`delete_ref`/`delete_tag` mutation exists there, only read-only `get_tag`/`list_tags`) failed with the
same platform 403 already documented for tag *creation* — confirming the cloud-session restriction
covers deletion too. `docs/VERSION-SYNC.md` step 6 rewritten to say "tag only a meaningful promotion,"
and a decision record (`D-GH-2026-08-20-tag-only-meaningful-promotions`) captures both findings so the
next session doesn't have to rediscover either. The owner fixed the tag from their own machine —
`git tag -f v1.442` on the real merge commit, confirmed matching `effd08c` (the actual PR #442 merge,
current tip of `main`) before this session closed.
