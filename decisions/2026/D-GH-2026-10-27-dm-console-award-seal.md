# D-GH-2026-10-27-dm-console-award-seal — the campaign-wide Award AP tile locks history; the per-character form no longer awards AP

**Context.** Found 2026-10-04 (owner, after awarding session 9). DM Console had two places to award AP. The campaign-wide "Award AP" tile had
no "lock history" option; the per-character form had an "and lock history" tick that was OFF by default. The owner used the tile, so no
`sessionSeal` landed on any of the six Amble histories, even though a seal is what freezes what a player bought up to that award. Sealing was
deliberately never automatic (`D-GH-2026-09-01-session-seal`, option A1: an award event in the log as well as the server award would
double-count AP), but the tick only existed on the form most DMs do not use.

**Decisions.**

- **Q1 — the tile.** An "and lock history" tick, TICKED BY DEFAULT (owner instruction, 2026-10-04). Each ticked character goes through
  `award_ap_and_seal()`: one atomic call per character, with a fresh idempotency key per character per click, so a retry cannot award twice.
- **Q2 — the per-character form.** The AP amount and its lock tick are gone (the tile covers both, for one character or many). Kept: gold,
  bonus time, the note, and the standalone "Lock history" button (a session can end with no award). With the economy off there is no gold or
  bonus time to enter, so the form shows only the note and Lock history, plus a pointer to the tile.
- **Q3 — seal characters still in creation? PROVISIONAL — the task's recommendation, awaiting the owner.** Seal only characters that have
  FINISHED creation (`creationLockState().locked`, computed once in `cloudAnalyze()`, never re-derived); award the rest without locking them,
  since sealing a half-built character freezes it. The result line names who was locked and who was not. The alternative (seal everyone ticked)
  is a one-line change in the tile handler.
- **Q4 — failures.** `Promise.allSettled`: a failure on one character does not stop the others; each failure is reported under that
  character's name.

**What this does not change.** `award_ap_and_seal()` and the standalone `seal_character_history()` are untouched; no SQL. A negative amount still
deducts (the tile accepts one), so a single-character correction is a one-ticked-box award.

**Pinned by** `dm-console-ui-e2e.mjs`: the tile has the box and it is ticked; the roster bridge reports who is locked; ticked = finished
characters sealed and the open one only awarded, unticked = nobody sealed, and one failure does not stop the others; the per-character form has no
AP field or tick but keeps Lock history and the note. 144/144; `economy-ui-e2e.mjs` 155/155.

**Status.** Accepted pending the owner's confirmation of Q3.
