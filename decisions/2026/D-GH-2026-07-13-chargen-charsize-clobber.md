# D-GH-2026-07-13-chargen-charsize-clobber — applyBuild()'s render()-before-LOG-resync ordering silently clobbers omitted DOM fields

Status: Active

- **Context:** A Tiefling round-tripped Live Sheet → CharGen lost its "Medium" size choice back to
  "Small" — found by the widened tool-switch field diff in `random-manual-e2e.mjs` during CI on the
  preview→main promotion PR (seed 29219918914), not by hand-testing. `applyBuild(b,opts)` writes DOM
  controls from `b` first, then calls `render()` — but `LOG` (the classic-script variable `readBuild()
  = foldBuild(LOG)` derives from) isn't resynced from the just-written DOM until later in the same
  function (`replaceWholeLogFromBuild(_domReadBuild())`). That intermediate `render()` call therefore
  computes `compute(readBuild())` off the *previous* build's stale `LOG`/species, which can make
  `sizeChoosable` wrongly false — and the size block's `else` branch does a one-way destructive
  `if(cs.value!=='Small')cs.value='Small'`. Nothing downstream ever restores it once species becomes
  correct again, because the block's *choosable* branch only toggles visibility/text, never re-sets
  `cs.value`.
- **Options:** (A1) reorder `applyBuild()` to resync `LOG` before the first `render()` call — fixes the
  root cause for every current and future field, but touches a function already flagged (in its own
  comments) as fragile / load-bearing for several other flows (autosave restore, hash-load, Reset),
  raising the risk of an unrelated regression for a one-field bug. (A2) add the missing field to the
  **existing** "re-assert primary selects" block that already runs *after* `render()` specifically to
  patch this exact class of clobbering for `spec`/`spec2`/`oclass`/`oclass2`/`hd`/`profBonus`/`budget`
  — `charsize` was simply omitted from that list, an apparent oversight rather than an intentional
  exclusion.
- **Decision:** **A2.** Added `set('charsize',b.size||'Small');` to the re-assert block. Minimal,
  pattern-consistent, verified via instrumented tracing and a clean re-run of the exact failing seed
  plus a 10-seed confidence sweep — all pass.
- **Why not A1:** the reorder is the more durable fix in the abstract, but `applyBuild()`'s own comments
  already document awareness of this "compute-managed fields parked in hidden controls" divergence risk
  (in `_cgApplyEnvelope()`, citing `size` by name) without previously acting on it — a sign this function
  has accumulated enough surrounding assumptions that a structural reorder deserves its own
  dedicated, reviewed change, not a ride-along in a one-field bug fix.
- **A second confirmed instance, found by `/code-review` on this same PR before merge:** `lineage`
  (line ~2535, set once before `render()`, never re-asserted) has the identical shape — a species with
  lineages (Elf, etc.) whose `_mine` allow-list is derived from stale species during that intermediate
  `render()` pass can have its just-set lineage silently blanked (`_sel.value=''`) at the render block
  guarding `#lineage`/`.linspellck`. Fixed the same way: added `set('lineage',b.lineage||'');` to the
  same re-assert block, in this PR (same file, same block, same one-line pattern already under review —
  not scope creep). Verified via a 12-seed sweep post-fix, all pass. `lineage` was already in
  `random-manual-e2e.mjs`'s portable-field diff list, so this was a real latent gap the harness could
  have caught given the right random seed, not a hypothetical.
- **Residual risk, logged for the next agent who touches `applyBuild()`:** ANY DOM field that (a) is
  written earlier in `applyBuild()`, (b) feeds a `render()`-computed *choosability*/*gating* check, and
  (c) is NOT in the re-assert block, is exposed to this exact clobber. Two instances found and fixed
  the same way within one PR is a signal this is a recurring shape, not a one-off — if a THIRD instance
  turns up, that's the trigger to stop patching individual fields and do the A1 structural reorder
  instead. A lower-confidence, differently-shaped sibling family was flagged but NOT fixed here
  (different code shape, needs its own verification): checkbox-uncheck resets driven by the same
  stale-`b` read (`.expck`/`.toolexpck` lines ~2867/2870, `.racck` ~2806-2807, cascading `.linspellck`
  ~2818) and cantrip-cap clamps (~2909, ~2989) — worth a follow-up pass if this class of bug keeps
  surfacing.
- **Status:** **In force.** UI-only; `js/engine.js`/`DATA.version` untouched, `compute()` output
  unaffected, `engine-parity.html`/`engine-parity-ci.mjs` still 20/0.

---
