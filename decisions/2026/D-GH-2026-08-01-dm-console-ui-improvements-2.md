# D-GH-2026-08-01-dm-console-ui-improvements-2 — Warn (engine-level) when a Tradition has no Discipline chosen; bump DATA.version for the new warning

Status: Active

- **Context:** Follow-up to the same session's half-caster cantrip fix, same live-testing pass. Asked
  directly for the case where "no discipline has been chosen" to surface as an issue with a warning mark
  next to it. Traced the underlying state: `js/engine.js`'s spellcasting cost loop already had
  `const discs=(t.disciplines||[]).filter(d=>d&&d.name&&d.name!=="(none)"); if(discs.length===0)return;`
  — a Tradition whose only discipline slot is left at `"(none)"` (reachable in CharGen by explicitly
  selecting `(none)` in the `.disc-name` dropdown, or by removing a discipline without removing its
  Tradition) is silently skipped: no Foundation cost, no line items, and — critically — no warning. The
  player sees a Tradition card sitting there with a picked Rank/name but zero AP spent and zero feedback
  that nothing has actually been purchased.
- **Options:** (i) CharGen-UI-only fix (flag it locally in `_cgRenderInner()`'s per-discipline block,
  same shape as the cantrip fix) — rejected as insufficient alone: `compute()`'s `warnings` array is what
  every tool's Issues/warnings tray reads live (confirmed via `tools/PACT-CharGen-Webtool.html`'s
  `$('warns').innerHTML=r.warnings.map(...)`), so a UI-only flag would show inline in CharGen but never
  register as a real "issue" in the tray the user explicitly asked for, and Live Sheet/DM Console would
  stay silent on the same state if it ever reached them (e.g. via import); (ii) **engine-level warning
  in `js/engine.js` (shared by all three tools) plus a CharGen-local inline marker** for immediate
  visibility exactly where the empty picker lives; (iii) block the state outright (force a discipline to
  be chosen, no `(none)` option) — rejected: `(none)` is a legitimate placeholder while a player is
  mid-decision on which discipline to pick, and hard-blocking it would fight the editing flow for no
  correctness gain over a clear warning.
- **Decision:** (ii). Added `W.push(t.name+": no Discipline chosen — pick one to activate this Tradition
  (nothing has been purchased for it yet)")` right where the engine used to silently `return` for a
  discipline-less Tradition. This message intentionally contains "Discipline" (capitalized) to match
  CharGen's existing `SECTIONS[i].warns` substring-routing key for the Spellcasting section, so it
  correctly counts toward that section's warning badge with no separate routing table entry needed. Also
  added a CharGen-only inline `⚠ No discipline chosen` marker on the empty `.disc-cast` hint row (same
  visual pattern as the existing "Duplicate tradition" red marker) since CharGen is the only tool where a
  player can actually reach this state through normal editing — Live Sheet's discipline buy buttons
  (`ib('Open '+t+' / '+d, 'found', ...)`) always target a specific, real discipline name, so the state is
  unreachable there through legitimate play (a state it could only inherit via imported/legacy data,
  where the engine-level warning alone is sufficient). Bumped `DATA.version` v0.336 → v0.337 per AGENTS.md
  ("bump ONLY when mechanics change... compute() output") since this adds a new possible string to
  `compute()`'s returned `warnings` array — even though no price/gate/total changed. Confirmed none of the
  20 parity fixtures exercise a discipline-less Tradition, so `testing/expected/` needed no edits; ran
  `engine-parity-ci.mjs` (20/0) and `random-manual-e2e.mjs` (4/4 iterations across two seeds) both before
  and after.
- **Why:** the engine already correctly refuses to charge for an incomplete Tradition — the gap was
  purely that it did so *silently*, and CharGen's UI didn't compensate (unlike the cantrip case, where
  Live Sheet's UI already got this right and only CharGen needed a fix — here neither tool's UI flagged
  it, so the fix had to live in the shared engine to cover all three tools uniformly). Worth recording
  because a future session might be tempted to treat this as CharGen-only (like the cantrip fix) and miss
  that the correct layer for "is this build state complete" advisories is `compute()`'s warnings array,
  not a per-tool DOM check — and because the DATA.version bump here has no accompanying `testing/expected/`
  diff, which could otherwise look like an oversight rather than a confirmed no-op for the existing fixtures.
- **Status:** IN FORCE. Changed `js/engine.js` (new warning) and `js/engine-data.js` (`DATA.version`
  v0.336→v0.337) plus `tools/PACT-CharGen-Webtool.html` (inline marker + the three hardcoded cosmetic
  version-label mirrors it documents itself as needing on a rules bump) and `docs/AI_review_prompt.md`
  (stale version string). `tools/PACT-Live-Char-Sheet.html`'s own header comment already listed a stale
  `DATA.version` ("v0.309") *before* this change — pre-existing drift, left alone as out of scope here.
