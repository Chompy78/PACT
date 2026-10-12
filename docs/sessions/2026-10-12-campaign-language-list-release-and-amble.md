# 2026-10-12 — a campaign's own language list: build, release v1.641, Amble set up

Decision: `decisions/2026/D-GH-2026-10-12-campaign-language-list.md` (and its addendum).
PRs: #632 (feature), #640 (changelog tidy-up), #641 (promotion, `v1.631` → `v1.641`, tag `v1.641` on `2f45a2e`).

## What was built
Owner request: a campaign can replace the standard language list (Amble drops Common). Owner chose A1 (campaign list as
suggestions, off-list names marked) plus an A3-style DM switch, "Only allow languages on this list". The engine owns the
list (`STANDARD_LANGUAGES`, `campaignLanguages(rules)`); strict mode refuses only newly entered off-list names, so a
language already locked into a character never strands it.

## Collisions and surprises
- **The promotion went out without the feature.** The owner merged promotion PR #631 from GitHub while #632 was still
  waiting on CI, so `main` got v1.631 without the language list. GitHub kept showing #631's head as the old preview
  commit, which looked like a stuck PR rather than a merged one. Checking `state` first would have shown MERGED
  straight away. Fixed by a second promotion, #641 (v1.641).
- **The changelog had picked up duplicates** from parallel sessions' rebases: two v1.631 release lines (one wrongly
  claiming #632), a duplicate #633 line, and an earlier draft of #636's line. These were removed in #640.
- **CI wait loops kept exiting early.** Background `until`/`grep -v` loops reported "done" while checks were still
  running, probably because `grep` behaves differently in this shell. Counting unfinished checks in the API query
  itself (`jq` on `/check-runs`) worked. One sw-cache job failed on a 5-minute Chromium install timeout under runner
  backlog; it passed on a re-run.

## Amble data change (owner request, after release)
- `rules.languages` has eight languages, with Orcish (Kaldrunic) left out at the owner's request, and `strict: true`.
- All 10 characters got an appended `names` event setting Haldeni as their first language. Only Wren Ashdown Ch8-12
  ever had Common. Her old event stays in history because `names` is protected. Dry-run in a rolled-back transaction
  first, then committed and verified (10 Haldeni events).
- The earlier "replace Common with Haldeni" request (owner D3, "leave for now") is closed by this.
