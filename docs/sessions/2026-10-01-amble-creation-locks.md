# 2026-10-01 — Amble creation locks: why four players were unlocked, and the reload bug behind it

## What was asked
The DM asked whether every player in the "Amble" campaign had their creation lock triggered. Only two of
six had (Anders, Moss). Caspian had been reopened by the DM on 1 Sep (correctly — the old automatic lock
had fired against the generic 79 AP default); Fenwick, Skylar and "Character" (formerly Archer) had no lock.

## How the cause was found — and the first diagnosis was wrong
- `character_backups` showed all three *had* been locked; each lost it in a save that shrank the log, with
  the DM's creation limit gone too. Every lost version was a fresh burst: renumbered from 1, CharGen's
  category order, one timestamp.
- **First diagnosis (wrong):** "CharGen rebuilds the log on every load". Reading the load paths disproved
  it — cloud/file/autosave/handoff/undo all reinstate the saved LOG verbatim.
- A stale-copy theory was also ruled out (each lost version's newest event = its save time).
- A fresh-subagent cold review of the fix plan flagged the boot path (H1). Reading `_cgBoot()` showed
  restore-verbatim **followed by** a boot seed that rebuilt the LOG from the form. **Reproduced in
  Chromium:** Finish creating → reload → lock gone, same id. Fixed the same day (PR #553) with a
  regression test that fails on the old code.

## Reconstructing where each lock should have been (G2)
- 322 snapshots (≈50 kept backups per character + DM Console "Copy to CharGen" copies) were run through
  `js/engine.js`; diffing successive saves gives purchase order at save granularity even though each log
  is in category order.
- The DM's rule: **the purchase that crosses the limit still counts as creation; the lock goes straight
  after it.** Moss's limit set to 79 + drawbacks; Archer locks at the end (history too short).
- Checked: no lock (old, interim, or proposed G2) changes any character's AP — only own-species traits
  reprice after a lock, and none were bought after a lock point. Gold/downtime impact is still to be
  measured at the sign-off step.
- Per-character sheet: `docs/plans/2026-10-01-amble-creation-lock-review.md`.

## Decisions made (owner)
- Interim: lock every Amble character now (end-of-log `creationLocked`, AP unchanged) — done.
- I2 (merge, don't rewrite), D1 (server guard: lock events append-only, DM-only reopen), G2 (backdated
  repair with DM sign-off).
- **L1:** a campaign move never clears the finished-creation lock — replaces F2, which the review showed
  could be bypassed by leaving, joining any other campaign, and returning. Recorded in
  `D-GH-2026-10-01-creation-lock-integrity`.
- Supabase read tools + `execute_sql` pre-approved in `.claude/settings.json` (owner committed it).

## Cold review
Round 1: fresh subagent — `docs/plans/cold-reviews/2026-10-01-subagent-creation-lock-integrity.md`
(6 High / 11 Medium / 9 Low; triage in the plan's "Review outcome"). The four free-API reviews (Gemini,
OpenRouter, Groq, DeepSeek) were requested but need keys added to the environment first.

## Still open
Part 1b (roll / `#b=` link / legacy-import rebuild paths → merge), Part 3 (G2 repair, DM sign-off),
Part 2 (server guard + L1). Follow-ups: `_cgSyncAward()` relocates a burst-shaped award once on load;
CharGen edits patch slots in place after the lock; `random-manual-e2e.mjs` doesn't use the shared
browser launcher; scan other campaigns for the same lock-loss pattern.
