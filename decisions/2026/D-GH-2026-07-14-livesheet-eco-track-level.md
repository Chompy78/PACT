# D-GH-2026-07-14-livesheet-eco-track-level — Live Sheet `#eco` line unified onto the header's tuned Track-Level curve

Status: Active

- **Context:** roadmap follow-up from `D-GH-2026-07-14-advancement-tracks` (PR #206). That change replaced
  the header's earned-AP `apLevel` chip with a spent-AP `trackLevel` chip read against the campaign's
  DM-tuned `levelBudgetCurve`, but deliberately left Live Sheet's separate `#eco` economy line
  (`tools/PACT-Live-Char-Sheet.html`, the `$('eco').innerHTML` block) computing its own "Lv L" from
  `eco.earned` against the fixed default `DATA.levelAP` ladder — a leftover of the pre-#206 mechanism. The
  two chips could show different numbers for the same character purely because they read different curves,
  not because "earned" and "spent" genuinely diverged.
- **Options:** (a) keep the `#eco` line as a pure earned-AP pace readout (it answers a different question
  than Track-Level — "how close am I to unlocking the next level's budget", independent of the campaign's
  tuning), but relabel it so it can't be mistaken for the header's number; (b) move it onto the tuned curve
  for full consistency with the header; (c) show both, clearly labelled.
- **Decision:** effectively (c), but with the curve mismatch fixed as part of it — extracted a shared
  `_levelCurve()` helper out of `trackLevel(spent)`, and had the `#eco` line call `trackLevel(eco.earned)`
  instead of its own inline fixed-ladder loop. Relabelled "Lv" → "Earned Lv" with a tooltip explaining the
  distinction from Track-Level.
- **Why:** keeping both readouts (earned pace vs spent Track-Level) is genuinely useful — a player who's
  been awarded AP but hasn't spent it yet wants to see that they're "ahead" on the pace metric even before
  spending. But the two readouts must draw from the *same* curve so they only ever disagree for the
  legitimate reason (spent vs earned), never because one silently ignores the campaign's DM tuning while
  the other honours it. Plain relabelling alone (option a) would have fixed the confusing label but left the
  latent curve-mismatch bug in place for any DM who tunes `levelBudgetCurve`.
- **Status:** Shipped. `testing/scripts/engine-parity-ci.mjs` unaffected (20/0 — no `js/engine.js` or
  `compute()` change, display-only). Manually verified in a local browser preview: fresh character with 50
  AP earned/0 spent showed "Earned Lv 0 · 29 AP to reach Earned Lv 1" (79-50=29, standard curve) alongside
  header "≈ Track-Level 0"; confirmed `trackLevel(79)===1` and `trackLevel(103)===2` via console against
  the loaded `{l1:79,inc:24}` standard curve.
