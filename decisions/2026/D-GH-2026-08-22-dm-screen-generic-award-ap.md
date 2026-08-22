# D-GH-2026-08-22-dm-screen-generic-award-ap — generic Award AP tile, banned-drawback grid staleness fix, disabled-item contrast fix

## Context
Three requests bundled into one DM Console session:
1. A "generic" Award AP control on the master card, near the top under the campaign selector, in its
   own sub card (Owner settings already lived in one — `campOwnerTile` — so this mirrors that pattern).
2. Some of the 21 drawbacks added 2026-08-19 (`DATA.drawbacks` 69 → 90) were reported missing from the
   DM Console "Banned drawbacks" checklist.
3. Disabled/banned/already-owned boon-drawback items ("greyed out" checkboxes and item-buttons) are hard
   to read across all five themes (default, dark, dnd/parchment, royal, forest).

## Options
**(1) Award AP shape.** A1 quick-award to one picked character (a dropdown replacing the scroll-to-card
step). A2 bulk-award the same amount+note to every character at once, no per-character choice. A3
tick-list — every roster character shown as a checkbox, DM ticks who earned it, one amount/note, one
Award action fires the same amount to every ticked character independently. Asked the user directly
(genuinely ambiguous, changes the implementation significantly); **A3 — tick-list — was requested.**

**(2) Banned-drawback staleness.** Audited `js/engine-data.js` directly: `DATA.drawbackList` and
`Object.keys(DATA.drawbacks)` are in full agreement (90/90, no set difference) as of this branch's base —
so the *data* is not missing anything, and DM-Console.html's grid (`RULE_GRIDS` in the Campaign Rules
panel) already derives its option list dynamically from `Object.keys(_D.drawbacks)`, not any hardcoded
array. B1 leave the (already-correct) render logic alone, treat the report as already resolved by
whichever PR landed the 21 drawbacks. B2 harden `renderRuleGrids()` so the class of bug the report
describes becomes structurally impossible, regardless of root cause. **B2 chosen** — the existing guard
(`if(!el || el.childElementCount) return` — "render the option list once, ever") means any code path that
renders a grid before `DATA` carries a newly-added option leaves that grid frozen at the old option set
for the rest of the page's life, even after `DATA` itself is corrected. That is exactly the reported
symptom's shape (a real change on the *engine* side, but the already-rendered DOM never picks it up), and
B1 leaves it able to recur on the next data addition.

**(3) Disabled-item contrast.** C1 leave opacity-based dimming alone, only add stronger textual markers
(the codebase already has `.barredtag`, a red "BARRED" pill, for the CharGen banned case). C2 raise the
opacity value(s) used for "disabled"/"barred"/"owned" boon-drawback-item styling app-wide. C3 replace
opacity-based dimming with an explicit muted text color (`var(--grey)`) instead of translucency. **C2
chosen** — measured WCAG contrast (relative-luminance ratio) of the *existing* opacity values against
each theme's own `--ink`-on-`--card` pair: at the shipped 0.5/0.55, EVERY theme fails WCAG AA's 4.5:1
minimum for normal text (range 3.08–4.68 across all five). This is an objective, measurable bug, not a
subjective read. At 0.7, every theme clears AA comfortably (5.58–6.63). C2 fixes exactly the reported
problem with a one-line-per-site change and no new colors to keep in sync per theme; C3 is a larger,
riskier surface change for a problem C2 already resolves within the existing idiom.

## Decision
- **DM Console** (`tools/DM-Console.html`): new `#campAwardApTile` sub card, inserted as the first
  subtile inside the Campaign panel (right under `#campSel`, above the existing `#campOwnerTile`).
  Renders a checkbox per `cloudRoster` entry (name resolved the same way roster cards already do:
  `playerLabel` → analyzed `summary.name` → `rowName` → `'New Character'`), a Select all / Select none
  pair, one AP-amount + note form, and an Award button. On click, awards independently
  (`Promise.allSettled` over `B.awardAp(id, amt, note)` per ticked id — same "one write per character,
  a partial failure doesn't block or roll back the others" reasoning the existing per-character award
  form already uses) and reports `<ok>/<total> awarded`. Added to `_PEEK_SCOPES` so an archived-campaign
  peek locks it exactly like every other campaign-scoped control — no separate lock mechanism invented.
  The checkbox-list renderer lives in the *other* closure (the one that already owns `cloudRoster`) and
  is invoked from `window._dmRenderCloudRoster`, the existing cross-boundary repaint hook; the button
  handler lives in the campaign-ready closure (where `currentCampId`/`B`/`_peekBlocks`/`loadRoster` are
  already in scope) and reads the ticked ids back through a small `window._dmAwardApChecked()` bridge —
  same cross-boundary pattern as `window._campBridge`/`window._dmPeekBlocks`/`window._dmReloadRoster`
  elsewhere in this file, not a new one.
- **`renderRuleGrids()`** (same file): the once-only `childElementCount` guard is replaced with a
  content-signature guard (`el.dataset.rgSig`, the sorted-and-joined option names) — re-renders exactly
  when the available option set changed, otherwise skips (still cheap, still avoids re-render on every
  campaign switch). `loadRulesIntoPanel()` re-applies the checked state right after this call either way,
  so a re-render never drops what the DM had already ticked. Verified live (Playwright): seeded a fresh
  `DATA.drawbacks` entry mid-session and confirmed the grid picks it up on the next
  `window._dmRulesPanel.load()` call, where it previously would not have.
- **Disabled-item opacity**, raised 0.5/0.55 → **0.7** at all three sites: CharGen's
  `.gridck label.ck.barred` and the two `:disabled`-driven `.gridck label.ck` rules
  (`tools/PACT-CharGen-Webtool.html`), and Live Sheet's `.ib.dis` (`tools/PACT-Live-Char-Sheet.html`).
  These cover banned/DM-disabled boons & drawbacks in CharGen's picker and disabled/owned/banned
  item-buttons in the Live Sheet's buy list — the two player-facing "take a drawback" surfaces; DM
  Console has no analogous disabled-checkbox styling of its own (checked directly — no `:disabled`,
  `.barred`, or `.dis`-style class exists there), so no change was needed on that tool.

## Why
Bulk award as a tick-list (not a bulk-only or single-only form) matches how a DM actually closes a
session: reward everyone who showed up the same amount in one action, without forcing every award through
the per-character card. Independent per-character RPCs (not a single batched call) keep the same
partial-failure semantics the existing per-character award form relies on — one network hiccup on one
character must not silently swallow the rest. Hardening `renderRuleGrids()` rather than merely asserting
"the data already agrees" closes the actual gap: a report of "some are missing" is exactly what a stale
render looks like from the DM's chair, even when the underlying `DATA` is already correct — a guard that
can freeze against a live DATA object is a bug independent of whether it happened to be observed this
time. The opacity fix is deliberately the narrow, measured version of "make it more visible" — verified
against the shipped `--ink`/`--card` pairs of all five themes rather than picked by eye, and left at the
existing single CSS-variable idiom rather than introducing a new disabled-text color to keep in sync
per theme.

## Status
Implemented on `claude/dm-screen-award-ap-drawbacks-aniecm`. Verified: `testing/scripts/dm-console-ui-e2e.mjs`
(96/96, including a new manual Playwright check that the Award AP tile renders, Select all/none work,
validation alerts fire, and the archived-campaign peek lock disables every control in the new tile),
`testing/scripts/engine-parity-ci.mjs` (52/52), `testing/scripts/economy-ui-e2e.mjs` (155/155),
`testing/scripts/chargen-flows-e2e.mjs` (66/66). No `js/engine.js` or `DATA` changes — `DATA.version` not
bumped.

## Addendum (2026-08-22) — the per-character "📒 AP history" modal was hardcoded white
Follow-up report on the same session: the AP-history popup a DM opens from a roster card's "📒 AP
history" button (`tools/DM-Console.html`'s `.hist-modal`, built in the click-delegation handler around
`B.getAwardHistory(...)`) had a **hardcoded `background:#fff`** on `.hist-modal .inner`, plus an inline
`<h3 style="color:var(--navy)">` heading — neither followed the theme system at all. Reproduced with
Playwright: in dark theme the modal rendered as a stark white card with its table rows (inherited
`--ink`, correctly the *light* dark-theme text color, but wrong against a hardcoded white background)
nearly unreadable — text and background both technically theme-driven, just fighting each other. Fixed
by switching the background to `var(--card)` (the same token every other panel/card in this file already
uses) and the heading to `var(--heading)` (this file's own established "heading text, adapts per theme"
token — `--navy` default, `#c9d6ec` in dark — already used by `.card .cname`/`.secrow`/`.ov-h`/etc.
elsewhere in the same file). No new tokens introduced; this was two lines using the wrong
already-existing ones. Verified visually across all five themes (default/dark/dnd/royal/forest) — default/
royal/forest keep a white card (their own `--card` is white by design, unchanged), dark now shows the
dark card background with legible text, dnd now shows its cream parchment card. `dm-console-ui-e2e.mjs`
re-run clean (96/96) after the change.

Separately asked in the same message: **where are the "award gold & bonus time" fields?** They're not
missing — `awardBody()` only renders them when the campaign's economy is on
(`window._engineEcon.economySetting(rules) !== 'off'`), i.e. Campaign Rules → "Gold & downtime economy"
is set to something other than its default "off" band. No code change; this is by design (a campaign
that doesn't use the gold/downtime economy shouldn't show gold/time award fields DMs would never use),
just non-obvious enough to record here since it was raised as if the fields were missing/broken.
