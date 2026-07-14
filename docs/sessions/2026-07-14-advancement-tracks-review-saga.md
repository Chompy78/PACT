# 2026-07-14 — Campaign advancement dials: the multi-AI review saga

Companion to `DECISIONS.md` `D-GH-2026-07-14-advancement-tracks` (the *why* of what shipped) and the two
PRs merged this session: **#205** (campaign-join race → friendly error) and **#206** (advancement dials).
This note preserves the *messy middle* of #206 — specifically why the design pivoted and how five external
AI reviews were triaged — because a future agent revisiting advancement/AP work could reasonably
second-guess the choices without it.

## What shipped (short version)
Three DM-tunable, display/config-only campaign dials in `js/advancement.js` (`DATA.levelBudgetCurves`,
`DATA.awardPaces`, `DATA.startingTierRatios`), a DM Console rules-panel UI, and a Live Sheet header label
that **replaced** the old earned-AP `apLevel` chip with a spent-AP-vs-tuned-curve `trackLevel`. No
`compute()`/`_replay()` change, no `DATA.version` bump, parity 20/0.

## Why the plan pivoted (this is the part worth keeping)
The task started from a roadmap entry that said, in good faith, *"reuse `AP_BY_LEVEL` as the 'average'
baseline"* and *"add a D&D 2024 equivalent level label."* Both turned out to be subtly wrong, and neither
was caught by code review — they were caught by reading the **primary source** (the Players Guide) and the
**actual code**:

1. **Pace curve ≠ budget curve.** The guide defines two *different* AP-per-level curves: a *pace* curve
   (AP earned by level: 1→50…20→491 — which is exactly what `js/ap-by-level.js`'s `AP_BY_LEVEL` already is)
   and a separate, larger *budget* curve (AP a complete level-N build is expected to have *spent*: Standard
   79→535, Generous 83→615). Reusing `AP_BY_LEVEL` as the "standard track" would have silently mislabeled
   earned-AP as spent-AP-budget. `AP_BY_LEVEL` was left untouched; budget curves were authored fresh.
2. **The D&D-equivalent chip was redundant.** Live Sheet's header already shows `Level {b.hd}`, and per the
   guide's own identity rule (PACT level = Hit Dice = D&D 2024 level) that number **is** the D&D-equivalent.
   A separate "≈ D&D N" chip would have restated it one comma over. Dropped.
3. **There were already two level numbers on the sheet**, not zero. The header carried `Level {b.hd}` and
   `≈ AP-Level {apLevel(eco.earned)}`. The user's call ("building 3 replaces 2") resolved this cleanly:
   the new tuned-curve indicator *replaces* the earned-AP chip rather than adding a third number.

## The five external AI reviews — how they were triaged
The user brought five external AI outputs (via Copilot / GPT-5.5 / Kimi K2.6 / one unattributed / a later
"v3 patch-level handoff"). Every factual claim was verified against the real repo before acting. Ranked:
- **Best: Claude-via-Copilot findings doc** — the only early review that actually read the Players Guide
  and surfaced the pace-vs-budget distinction with cited numbers. Load-bearing.
- **GPT-5.5** — good generic engineering hygiene (centralize helpers, future-proof the rules shape, clamp
  ranges) but ungrounded in the source; its "derive D&D from the average track" suggestion would have
  baked in the same conflation.
- **Kimi K2.6** — most polished *artifact* (ready-to-paste diffs) but its literal numbers were fabricated:
  `average: AP_BY_LEVEL` is the exact conflation error, and its `DND_LEVEL_EQUIVALENT` was invented.
- **Unattributed "deep AP" doc** — ranked *last*: it cited section numbers and quoted the guide, but its
  own two quoted L20 figures (491 vs 535) contradicted each other, and it confidently greenlit the
  `AP_BY_LEVEL`-as-standard mistake. Citation-heavy presentation made it *more* dangerous to trust, not less.
- **v3 patch-level handoff** — much stronger; most of its engine.js line citations matched verbatim. But
  direct verification still caught (a) a DM-Console.html insertion anchor off by ~600 lines, and (b) that
  it proposed adding the redundant D&D chip *alongside* the existing labels without noticing they existed.

## Takeaways (generalized versions pushed to `ai-lessons-learned` this session)
- When multiple AI reviews disagree, weight the one grounded in primary source / independently-verifiable
  facts. Confident-but-ungrounded review — especially citation-heavy — is a real failure mode.
- Treat an AI handoff's specific line-number / code citations as *hypotheses to verify against the real
  code*, not facts. Even a mostly-accurate handoff had a 600-line-off anchor and a "add alongside" proposal
  that ignored existing on-screen state.

## Deliberately deferred (so they aren't lost)
- **`test/advancement-tracks-e2e`** (roadmap) — the DM-panel↔bound-player round-trip needs Supabase auth +
  a live campaign, impractical to drive headlessly; `trackLevel`/tier-prefill math was verified in Node
  instead. Manual in-browser pass recommended before this rides `preview`→`main`.
- **`feat/livesheet-eco-track-level`** (roadmap) — Live Sheet's `#eco` economy line still shows an
  earned-AP "Lv L · X AP to reach Lv L+1" pace readout on the fixed default table; whether it too should
  move to the tuned curve is a separate, flagged decision.
- **`DATA.level1AP` creation-lock coherence** — still hardcodes the default L1, not a campaign's tuned
  `levelBudgetCurve.l1`. That's a real `compute()`/`_replay()` mechanics change (version bump + fixture
  refresh) → its own PR.
