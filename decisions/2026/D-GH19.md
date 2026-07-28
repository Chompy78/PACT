# D-GH19 — Live Sheet mobile CSS: `!important` to fix a silent cascade-order shadowing bug

Status: Active

- **Context:** While fixing the "Live Sheet unusably cramped on small mobile screens" roadmap task,
  found that most of the existing `@media(max-width:600px)` mobile-tuning block (`.abrow`/`.kpis`
  ability-score columns, `.ib`/`.cath` font/padding bumps) had **no visible effect at all** — verified
  live with a headless browser: at a 375px viewport, `.abrow`'s computed `grid-template-columns` was
  still 6 equal columns, not the intended 3. Root cause: that `@media` block is declared near the top of
  `tools/PACT-Live-Char-Sheet.html`'s `<style>`, **before** several unconditional base rules for the same
  selectors (`.abrow`, `.kpis`, `.ib`, `.cath`) that appear later in the file. CSS resolves equal-specificity
  conflicts by source order — the later rule wins regardless of whether it's the "general" or "specific"
  one conceptually — so the later, unconditional desktop rule silently beat the earlier mobile override at
  every width, including mobile. This is a pre-existing, previously-undiagnosed bug, not something
  introduced by this task; the "M1" comment on that block reads as though the 3-column mobile override was
  already working.
- **Options:** (i) reorder the whole `<style>` block so all `@media` overrides come after every
  unconditional rule they need to beat; (ii) raise specificity of the shadowed mobile declarations with
  `!important`, touching only the specific properties proven to be shadowed; (iii) leave the pre-existing
  breakage alone and only guard the new `.slotgrid`/`.spcols`/`.shabrow`/`.shkpis` rules added by this task.
- **Decision:** (ii), for both the new CSS added by this task **and** the pre-existing `.abrow`/`.kpis`/
  `.ib`/`.cath` overrides directly relevant to "text and tap targets are legible" (the task's own
  Done-when). Added `!important` only to the specific declarations verified shadowed (`grid-template-columns`
  on `.abrow`/`.kpis`/`.shabrow`/`.shkpis`/`.slotgrid`/`.spcols`; `font-size`/`padding` on `.ib`/`.cath`) —
  not blanket-applied across the block.
- **Why:** (i) is the textbook-correct fix but means reordering ~250 lines of CSS in a 2700-line file with
  at least one other later, overlapping `@media(max-width:880px)` block touching some of the same
  selectors (`.top`, `.top h1`) — verified the specific overlap is low-risk (a 15px-vs-16px `.top h1` font
  difference) but a full audit of every possible downstream interaction was out of scope for this task.
  (iii) would leave the task's own Done-when condition failing for a reason the roadmap task's diagnosis
  never anticipated. `!important` here matches an existing convention already used in this same file's
  `@media print` overrides for these exact selectors (`.spcols`/`.slotgrid`), suggesting a prior author hit
  the identical shadowing problem and reached for the same fix.
- **Status:** DONE. Verified live (headless browser, 375px viewport): `.abrow`/`.kpis` now compute 3 equal
  columns, `.ib`/`.cath` now compute the intended larger font-size/padding, `.slotgrid`/`.spcols`/
  `.shabrow`/`.shkpis` compute the new small-phone column counts, desktop (1280px) unchanged. A full
  reordering of the stylesheet (option i) is left as a follow-up if this class of bug resurfaces elsewhere
  in the file.

---
