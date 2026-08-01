# D-GH-2026-08-01-dm-console-ui-improvements — CharGen's cantrip picker didn't honour DATA.noCantrip; fixed in the UI, not the engine

Status: Active

- **Context:** Live user report mid-session: "the add discipline cantrip under the chargen sheet doesn't
  work — it doesn't add a line to the ledger or deduct AP's." Reproduced with a headless Playwright drive
  of the real CharGen UI (Supabase CDN import stubbed so `engine-ready` fires offline): opening a Divine
  tradition, picking the Paladin discipline, and selecting "2 (+7 AP)" in its cantrips `<select>` left the
  widget showing "2" with zero effect on the ledger or AP total. Root cause: `js/engine.js`'s LOG replay
  (`_replay()`, "half-casters can't hold cantrips") force-zeroes `d.cantrips` on every fold for any
  discipline in `DATA.noCantrip` (currently `["Paladin","Ranger"]`) — correct rules enforcement, and
  Live Sheet already respects it by never rendering the Cantrip buy button (`ib(...)`) for those
  disciplines at all (`tools/PACT-Live-Char-Sheet.html`, the `(DATA.noCantrip||[]).indexOf(d.name)<0?...`
  guard). CharGen's `.disc-cant` `<select>` (`tools/PACT-CharGen-Webtool.html`, built in `addDisc()`,
  priced/capped in `_cgRenderInner()`'s per-discipline block) had no equivalent guard: it showed priced,
  clickable options with only a *cap* check (`n>info.cantripCap`), so a half-caster's selection was
  silently discarded by the engine with no error, no warning, and no visual correction — the DOM kept
  showing the picked value even though the folded build state was 0.
- **Options:** (i) relax `js/engine.js`'s normalization so a half-caster's cantrip patch is honoured
  (rejected outright — half-casters genuinely cannot take cantrips per the ruleset; this would be a rules
  change disguised as a bug fix, and would also silently un-fix whatever prompted the normalization to be
  added in the first place); (ii) leave the engine alone and add a matching UI guard in CharGen, disabling
  the `.disc-cant` select and forcing its displayed value back to 0 whenever the current discipline is in
  `DATA.noCantrip`, with a tooltip explaining why (mirrors Live Sheet's existing hide-the-control
  behaviour, just realized as disable-in-place since CharGen always renders the full discipline card
  rather than conditionally omitting controls); (iii) same as (ii) but hide the control entirely instead
  of disabling it (rejected — CharGen's discipline card layout is a fixed grid of controls per discipline,
  not an assembled list of conditionally-included buy tiles like Live Sheet's buy panel; hiding one cell
  would leave a layout gap in every non-half-caster row for no benefit over a disabled, tooltipped one).
- **Decision:** (ii). Added a `noCant` check in `_cgRenderInner()`'s per-discipline block: when the
  current `.disc-name` is in `DATA.noCantrip`, `.disc-cant` is disabled, its displayed value is reset to
  `0` if it wasn't already, its options are relabeled to `—` (nothing purchasable), and it gets a
  `title="Half-casters can't take cantrips"` tooltip. The guard re-evaluates on every render, so it also
  self-corrects the case where a discipline is *switched into* a half-caster mid-edit (e.g. Wizard with
  cantrips=2 → changed to Paladin): the display snaps back to 0/disabled immediately rather than lying
  until the next unrelated edit. No `js/engine.js` change; `compute()`/`foldBuild()` untouched.
- **Why:** the bug wasn't the rules enforcement (that was already correct and had been since whenever the
  `noCantrip` normalization was added to `_replay()`) — it was that CharGen is the one tool of the three
  that didn't visually agree with the engine's own silent override, so a player would burn time picking a
  value that was quietly discarded with no error and no on-screen explanation. This is exactly the kind of
  tool-parity gap AGENTS.md's Architecture section already flags as a recurring risk class (CharGen has
  historically been the tool most likely to drift, e.g. D-GH33/D-GH37's bridging work) — worth recording
  because a future session touching `DATA.noCantrip`, the cantrip pricing path, or CharGen's discipline
  card should know this guard exists and *why* it lives in the UI layer, not the engine, so it doesn't get
  "simplified" away as redundant with the fold-time normalization it's actually compensating for.
- **Status:** IN FORCE. Fixed in `tools/PACT-CharGen-Webtool.html` only. Verified via a headless
  Playwright reproduction (before: silent no-op on Paladin/Ranger cantrip selection; after: select
  disabled + relabeled + tooltipped, value forced to 0, both on direct half-caster selection and on
  switching an existing discipline into one) and `testing/scripts/engine-parity-ci.mjs` (20/0, unaffected
  since no engine change). If a fourth tool or a new noCantrip-gated field is ever added, check it against
  this same class of "engine silently overrides, does the UI say so" gap before assuming parity.
