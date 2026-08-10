# D-GH-2026-08-10-ap-model-reconcile — Earned Lv accounts for DM AP; frozen vs repriced stays labelled

Status: **Active**, 2026-08-10.

## Context

Long-deferred from D-GH30. The card's "AP left" (frozen ledger) and the AP Ledger panel (repriced
`compute().total`) disagreeing was already decided as *expected*, not a defect (G1, owner, 2026-08-04,
shipped in PR #355) — the two answer different questions. What remained open: `apLevel`/"Earned Lv" uses
`trackLevel(eco.earned)`, which can only see the character's own log — DM AP lives only on
`characters.ap`, never in the log — so a fully DM-funded character read "Earned Lv 0" with "0 earned"
even when the DM had granted real AP. Worked example on record: Fenwick Copperkettle (Amble), DM AP 36,
frozen spend 47, repriced total 40 — card reads −11, AP Ledger reads "4 over".

## Decision — implementation (this session, per the earlier Q&A round)

1. **"Earned" is a display-time composition, not a new engine export.** New pure function
   `earnedWithDm(eco, opts)` in `js/engine.js` — `(ignorePlayerAp ? 0 : eco.earned) + dmAp`, mirroring
   `compute()`'s own `spendable` formula (`(ignorePlayerAp?0:playerAp)+dmAp`) exactly. `economy()` itself
   is untouched — keeps it pure/log-only, preserving the anti-double-count invariant. One shared
   implementation, bridged into both tools via the existing `window._engineFold` pattern (matching
   `foldBuild`/`activeEvents`/`economy`'s own bridging), not two independently-drifting local copies.
2. **Both tools now read Earned Lv / "AP to reach Earned Lv N+1" / apLevel from it.** Live Sheet's
   `render()`: the `ap` variable driving `trackLevel()` and the next-level delta. DM Console's
   `dmAnalyze()`: `apLevel` (was `trackLevel(eco.earned)`) and a new `earnedTotal` field, used wherever
   an "X earned" figure sits directly beside `apLevel` in an unlabelled context (`detailHTML`'s inline
   summary, the sortable roster table's "AP Earned" column) — so the two never show a raw-vs-composed
   mismatch next to each other. The pre-existing, explicitly-labelled `pactBuildBody` breakdown
   ("AP earned (own log)" + separate "DM-granted AP" / "Spendable total" rows) is untouched — it already
   itemises the two pools correctly and deliberately, on purpose.
3. **The raw "X earned" TEXT in the Live Sheet's header line stays log-only**, unchanged — it already
   sits beside a separate DM-AP chip (`_dmchip`) itemising the DM pool, the same "show both pools rather
   than one opaque total" philosophy DM Console's labelled breakdown already uses. Only the number that
   *drives* Earned Lv/next-level changed.
4. **Card vs AP Ledger disagreement stays allowed, now labelled on both surfaces.** DM Console's
   whole-roster "📒 AP Ledger" overlay subtitle and each roster card's "AP Available" tooltip now say
   plainly that the two figures answer different questions and can legitimately differ. The Live Sheet's
   printable-sheet "AP Ledger" heading gained the same tooltip; its header already had a "paid X AP · Y
   at today's prices" drift note for the same purpose (pre-existing, unchanged).
5. **Low starting-tier campaigns reading below-curve Track-Level is intended, not a bug** (owner
   decision, this session) — no clamping added. Confirmed directly: Amble's real 36 AP is below the
   Standard curve's L0 (55), so `trackLevel(36, …)` legitimately returns 0 even after this fix — the fix
   corrects the COMPOSITION (36 is now actually reaching the curve function, instead of 0), not the
   curve's own floor behaviour.

## Verification

`testing/scripts/tool-pricing-ci.mjs`, 116/0: `earnedWithDm`'s three campaign shapes (ignored, composed,
no-campaign) asserted directly; a fully DM-funded character (0 in their own log, 80 DM AP — chosen
because it's above the Standard curve's L1=79, so the fix is unambiguously demonstrated, unlike 36 which
reads 0 both before and after this fix for two different reasons) shows a real Earned Lv/apLevel/
earnedTotal in both tools, via the same shared engine function (a new `window._dmAnalyzeTest` test seam
exposes `cloudAnalyze()` directly for DM Console, mirroring `window._dmRenderCloudRoster`'s existing
pattern). `testing/scripts/engine-parity-ci.mjs` unaffected (30/0) — `earnedWithDm` is purely additive,
touches no fixture-driven path. **Fenwick Copperkettle's exact real numbers (36/47/40/−11/"4 over") were
NOT reproduced as a fixture** — this environment has no access to the real Amble campaign character's
LOG, and reconstructing an equivalent price-drift scenario from scratch would test the already-shipped
G1 frozen-vs-repriced mechanism (PR #355, unchanged by this task) rather than the `earnedWithDm` fix this
task actually adds. Recorded here rather than silently claiming the worked example was pinned when it
wasn't. **A real regression fluke worth naming:** an early draft of this session's tool-pricing-ci.mjs
edits briefly broke the Live Sheet's boot entirely — two separate ad-hoc string edits to add the
frozen-vs-repriced tooltips used a raw apostrophe inside an already-single-quoted JS string
(`view's`/`TODAY'S`), terminating the string early and taking the whole classic `<script>` block's
declarations down with it. Caught by re-running `tool-pricing-ci.mjs` before committing (its "Live Sheet
never became ready" failure is exactly this class of bug) and fixed with `&rsquo;` in both places,
matching the file's existing convention (`today&rsquo;s prices`, already used nearby). Left as a note for
future ad-hoc string edits into this file: prefer the `Edit` tool's literal `\'` escaping over
programmatic string replacement for HTML text destined inside a single-quoted JS string.

## Related

- G1 (`decisions/2026/D-GH-2026-08-04-*` roster-ap-model, PR #355) — the frozen-vs-repriced decision this
  task's labelling work builds on, unchanged.
- `feat/ledger-show-lost-purchases` — next in the sequence; its own decision doc should NOT re-litigate
  the compute()-vs-frozen-ledger question, per that task's own note to settle it once, here.

## Addendum (2026-08-10, pre-merge review) — the mobile card fallback missed the same fix

Found by `/code-review ultra` on the promotion PR: DM Console's table view got `earnedTotal` in its
`COLS` definition (point 2 in the Decision above), but `renderCards()` — the ≤700px fallback layout for
that SAME shared table, a different code path from the "Card view" toggle's own `#campRoster` cards —
still read the raw, DM-AP-blind `a.earned` directly. A DM viewing a fully-DM-funded character's roster on
a narrow screen would have seen exactly the "AP Earned 0" bug this task exists to fix. Fixed in the same
`kv('AP Earned', …)` call, same ternary as the table's own `get`/`disp`. New test seam
`window._dmRenderCardsTest(rows, expandIndex)` (renders the card fallback directly, bypassing the
Card-view/Table-view toggle state which a page-evaluate call can't reach into — closure-local `var`s in
DM Console's IIFE, same reason `_dmRenderCloudRoster` exists). `tool-pricing-ci.mjs` gained 1 check
(125/0 total); `engine-parity-ci.mjs` unaffected (display-only).
