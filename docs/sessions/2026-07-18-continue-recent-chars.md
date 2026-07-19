# Session: "Continue where you left off" — landing recent-characters (feat/continue-recent-chars)

**Date:** 2026-07-18 → 2026-07-19 · **PR:** #258 (merged into `preview`) ·
**Decision:** `D-GH-2026-07-18-continue-recent-chars`

Why this note exists: the plan pivoted twice on user correction, scope grew because the storage model
forced it, and the work collided with another merged PR (favicons) during rebase. The `DECISIONS.md` entry
captures the *design* rationale; this note captures the *process* so a future agent isn't surprised by the
gap between the roadmap task and what shipped.

## What the roadmap assumed vs. what was true
The `TASK_BOARD.md` item framed this as **"index.html reading existing storage, not a cross-tool change."**
Tracing the real storage killed that assumption:
- Each tool autosaves to a **single overwrite slot** (`pactCharGenAutosaveV2`, `pactLiveSheet`) — ≈1
  character per tool ever retained.
- The genuine multi-character store (`js/sync.js`, `pact-chars` + `pact-char-<id>`) only fills on a
  **signed-in** "☁ Save to cloud" — empty for the signed-out majority, and it partly duplicates the
  in-tool cloud-load menu.
- Neither tool reads an "open character X" URL param; the only deep-link is the 2-min one-shot `?handoff=`
  baton, and plainly navigating to a tool just restores *its own* slot.

So a useful "Continue" list needed the tools to **retain more than one recent character** — i.e. a
cross-tool persistence change, not index-only. Surfaced this as an explicit A1/A2 choice
(autosave-only vs. merge the cloud store); user picked autosave-only.

## Two course-corrections (why the shape changed mid-build)
1. First refinement: *"increase the autosave to 10 versions, or better, 5 versions per character name."*
2. Then corrected to the final shape: *"a combination of the last three characters **and** the last 10
   autosaves,"* plus the key insight that the capture trigger must consider **both** elapsed time **and**
   the difference from the previous snapshot — otherwise a keystroke burst yields 10 identical entries.

Final model (one key `pactRecentV1`): **chars** = last 3 distinct characters (resume cards); **saves** =
rolling ring of last 10 snapshots (recovery timeline). Capture: skip-if-identical; coalesce rapid
same-character edits within 2 min into the newest slot; cut a new slot only on a ≥2-min gap, a
character/tool switch, or a ≥5-event jump. Logic lives in shared `js/character-store.js`; both tools call
`recordAutosave` once, additively and guarded (never touches their own restore slot).

## Code review (high effort) → 5 findings, all fixed in the same PR
1. **Orphan handoff leak** — every `pointerdown` staged a full-LOG baton; landing never swept them. Fixed:
   sweep on load + gate staging to `e.button <= 1` (right-click no longer stages).
2. **`sameContext` keyed on raw `id`** (`null===null` true) → two id-less characters could wrongly
   coalesce. Fixed: key on `_charKeyOf` (id, else name), consistent with the `chars` dedup.
3. **Duplicated icon SVG** — Continue card now clones the icon from the matching tool card's `.card-icon`.
4. **Duplicated handoff-URL construction** — factored into one `handoffUrl()` helper.
5. **Unknown-`tool` routing** — entries with an unrecognized tool tag are filtered out, not defaulted to
   CharGen.

## Collision with another session's work (favicon PR #259)
Between the first push and the review-fix push, `preview` advanced with PR #259 (anvil favicons in CharGen
& Live Sheet). The rebase produced **one trivial, orthogonal conflict** on CharGen's `<head>`: a favicon
`<link>` (theirs) vs. my `v0.202` `<title>` bump (mine) on adjacent minified lines. Resolved by keeping
**both**; confirmed favicon + all my changes coexist in both tools before force-pushing the rebased branch.

**Git gotcha noted along the way:** a `git push` issued while a rebase is paused on a conflict pushes the
branch's *pre-rebase* tip — the branch ref isn't advanced until the rebase completes — so it silently
pushed un-rebased history. Had to finish the rebase and `--force-with-lease` afterwards.

## Verification
Store capture heuristic unit-tested (fake `localStorage`, incl. the id-less case). Browser E2E (Playwright,
pre-installed Chromium): hidden-when-empty, render/reveal, newest-first, XSS name rendered as literal text,
autosaves timeline, unknown-tool filtered, icon cloned from DOM, expired orphan swept on load, right-click
stages nothing, and a **real** CharGen-autosave → landing-card → `?handoff=` → tool-reload round trip.
Engine parity **20/0** at every step (unchanged — no engine logic touched; only the `BUILD` string bumped
v0.201→v0.202).
