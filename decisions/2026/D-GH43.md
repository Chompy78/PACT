# D-GH43 — D-GH numbering: verify against the live remote before claiming, and treat renumber-on-merge as the accepted collision fallback

Status: Active

- **Context:** three separate D-GH decision-number collisions have already happened — D-GH19/D-GH20,
  D-GH25/D-GH27, D-GH26/D-GH28 — each because a session computed "next number = highest + 1" from a local
  snapshot read earlier in the session, then a concurrent session independently claimed the same number
  before either landed. Squash-merges hide the collision (git auto-merges the duplicate header cleanly, no
  conflict), so it's only ever caught by a human/agent noticing after the fact. This matches a general
  lesson now indexed in the cross-project `ai-lessons-learned` repo (H-022): "highest + 1" IDs computed from
  a local snapshot collide under concurrency — check against live remote state, or accept
  renumber-on-merge as policy.
- **Options considered:** (A) leave the convention as-is and keep fixing collisions ad hoc after they're
  noticed; (B) switch to a non-colliding ID scheme (date-suffixed or UUID) for all future entries; (C) keep
  the sequential `D-GH<N>` format — it's cross-referenced across `AGENTS.md`, the roadmap, and ~30 existing
  entries, so renumbering the scheme would be disruptive for no real gain — but (i) require checking the
  **live** remote `DECISIONS.md` immediately before claiming the next number, not a stale local read from
  earlier in the session, and (ii) explicitly document renumber-on-merge-collision as the accepted fallback
  rather than an ad hoc scramble each time it happens.
- **Decision:** (C). Before claiming a new `D-GH<N>` number, fetch the live default branch and re-derive the
  highest in-use number directly from it, e.g.:
  `git fetch origin preview && git show origin/preview:DECISIONS.md | grep -oE 'D-GH[0-9]+' | sort -t H -k2 -n -u | tail -1`
  — not from an earlier read in the session. If a collision still happens after merge (two sessions claimed
  the same number before either pushed — the live check narrows this window but can't fully close it), the
  fix is: keep the earlier-merged entry's number, renumber the later one to the next free number, and add an
  addendum note under the renumbered entry (the exact pattern already used for all three prior collisions) —
  no debate needed, this is now expected, documented behavior. Recorded in `AGENTS.md`'s "Multiple sessions"
  section.
- **Why:** (A) keeps paying the same recurring cost with no fix. (B) was rejected — the sequential format is
  cross-referenced by dozens of existing entries, the roadmap, and `AGENTS.md`; swapping formats doesn't
  eliminate the underlying race (a fresh scheme still needs a live check to avoid *other* kinds of drift) and
  adds churn for no proportionate benefit given collisions are rare (3 in 29 entries) and cheap to resolve
  post-hoc once the fallback is a known, documented step rather than a fire drill. (C) fixes the actual root
  cause named in every prior collision's addendum — a stale, non-live number check — while keeping the
  fallback that's already been proven to work three times.
- **Status:** DONE.
- **Addendum (2026-07-10, docs-consistency audit):** originally logged as `D-GH30`, colliding with two
  other same-day entries also claimed as `D-GH30` — including, ironically, this decision's own live-check
  policy: the collision happened anyway because the other `D-GH30` (the "Cloud/campaign status badge"
  entry) merged only ~8 minutes earlier, inside the window this decision's own Why already acknowledged
  the live check "narrows... but can't fully close." Kept the earlier-merged "Live Sheet's 'AP left' reads
  the frozen ledger" entry at `D-GH30`; renumbered this one to `D-GH43` (next free at time of fix, after
  `D-GH42` above). `AGENTS.md`'s numbering note and `CHANGELOG.md`'s "fix the recurring D-GH
  decision-number collision" entry updated to match; the four-collision count now reads D-GH19/20,
  D-GH25/27, D-GH26/28, D-GH30/42/43.

---
