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

## Addendum (2026-08-22) — "Gold & downtime economy is set to off and I can't change [it]"; "the tick boxes are still too hard to read"
Two more reports on the same thread, both real.

**The economy dropdown genuinely was unreachable, and the reason wasn't obvious.** Campaign Rules (and
Advancement/Custom fields) land locked by default on every campaign switch (`_setRulesLocked(true)`,
existing, deliberate — "stop a scroll-past or a stray click from silently toggling a ban"). The ONLY
unlock control (`ruleLockBtn`, "🔒 Locked" next to "Save rules") sits at the very BOTTOM of a long panel
— species/origin/class bans, weapon masteries, boons, drawbacks, arts, the drawback cap, the economy
band, house-rule toggles — while "Gold & downtime economy" sits roughly in the middle. A DM opening
Campaign Rules sees the economy `<select>` visibly greyed out with nothing nearby explaining why or
where to fix it. Confirmed live (Playwright, dark theme): the select renders disabled from the moment
the panel opens; nothing above or beside it says so. Fixed by adding **`#ruleLockHint`** — a clickable,
always-visible banner right under the "Campaign Rules" summary (top of the panel, above every setting
it covers) that states the lock is on and toggles it directly, no scrolling required. Reuses the exact
same `_setRulesLocked`/`ruleMultiDisc.disabled` state `ruleLockBtn` already drives — not a second lock,
a second door into the same one. It had to be explicitly excluded from `_ruleLockEls()`'s own disable
scan (else it would disable itself the moment it's needed — the same "cannot climb inside your own
hole" bug the original `ruleLockBtn` avoids by living outside `campRulesTile` entirely; this control
can't, since it needs to render inside the tile to be visible at the top of it) while staying covered
by the SEPARATE archived-peek lock (`campRulesTile` was already in `_PEEK_SCOPES`) — verified directly:
`ruleLockHint.disabled === true` while peeking an archived campaign, same as `ruleLockBtn`.

**The Banned-* checkbox labels (and the new Award AP tick-list, same `.rulegrid` class) really were
lower-contrast than CharGen's equivalent.** Not a WCAG failure — `.rulegrid label{color:var(--muted)}`
already cleared AA (5.37–5.96:1 across all five themes) — but CharGen's own checkbox labels
(`.ck .c{color:var(--ink);font-weight:700}`) are bold and full-strength `--ink`, roughly 2–3× higher
contrast (11.69–16.36:1) and visibly heavier. Matched it: `.rulegrid label` now uses `color:var(--ink)`
+ `font-weight:700`, the same declaration shape CharGen uses, rather than inventing a new style — this
was a "look like CharGen's" request specifically, so the fix is literally CharGen's own rule copied onto
DM Console's equivalent selector. Covers every `.rulegrid` in the file (all the Banned-* lists AND the
Award AP tick-list from the base decision above) in one change, not a special case for the new list
alone. Verified visually across dark and dnd themes.

`dm-console-ui-e2e.mjs` re-run clean (96/96) after both changes.

## Addendum (2026-08-22) — the three-card lock made into an actual supercard; custom fields 1/2 on the default Card view
Direct follow-up question: *"does all the fields the lock button applies to need to be in its own
sub-supercard?"* Yes — and the previous addendum's `ruleLockHint` fix was itself incomplete because of
this: it lived inside `campRulesTile`'s own `<details>`, so it was invisible unless that ONE of the
three locked cards (`campRulesTile`/`campAdvancementTile`/`campCustomFieldsTile`) happened to be the one
a DM opened first — a DM who opened "Level budget curve…" directly would still see greyed-out fields
with zero explanation. Restructured: the three cards, plus the "Save rules / Locked" row that used to
float as a bare, uncontained row after them, are now wrapped in one outer **`campRulesGroup`**
("supercard" — new `.subtile-group` class, border-only/no fill so the `.subtile`s nested inside still
read as a distinct layer against it, same relationship they already have against `.panel`).
`ruleLockHint` moved to the top of that wrapper, outside all three `<details>` — now visible immediately
on scroll, with zero clicks, and its one click unlocks all three (verified: economy band, starting-tier
AP, and a custom-field-definition input all flip `disabled` together). `_ruleLockEls()`/`_peekLockEls()`
needed no change to their tile-ID scanning (`getElementById` finds a node regardless of nesting depth);
`ruleLockHint` only needed moving from "excluded from `_ruleLockEls()`'s scan" (dead code once it left
those tiles) to "swept by `_peekLockEls()`'s extras" (same treatment as `ruleLockBtn`, unaffected by the
move) — verified `ruleLockHint.disabled === true` while peeking an archived campaign, still.

Separate ask in the same message (clarified as "fields" not "buttons"): show the campaign's two NUMBER
custom fields ("Custom 1"/"Custom 2" — `num1`/`num2` under Custom character fields) on the **default**
Card view, not only inside the collapsed "DM tools" section where `customFieldValuesBody()` already
lets a DM edit them. Added two more cells to `cardHTML()`'s stat strip (alongside AP left/HP/AC/…),
read-only display of `dm.customFields.num1`/`.num2` under whatever label the campaign gave them, only
when the campaign actually defined that slot's label (`window._dmCampaignApRules.customFields`, the
same source `customFieldValuesBody()` already reads — no new plumbing). Deliberately NUMBER fields only,
not the two TEXT ones — a stat cell reads naturally as a number the way HP/AC/Prof already do, and
freeform text doesn't fit that shape; the two text slots stay DM-tools-only, unchanged. A local
(non-campaign) roster card or a campaign with no custom fields defined falls through both guards to "no
cells added" — verified live (no extra stat cells rendered when `window._dmCampaignApRules` is null).

`dm-console-ui-e2e.mjs` and `economy-ui-e2e.mjs` both re-run clean (96/96, 155/155) after these changes.

## Addendum (2026-08-22) — party downtime moved next to Award AP; a history added; found "Declare for the party" has never actually worked
Follow-up request: move the "🕐 Party downtime window" control (previously a bare `.ruleblock` above
`#campRoster`, inside `#campSection`) down to sit with the Award AP tile, and add a history view — the
per-character award/AP-history precedent already existed, this control had nothing equivalent.

**The history was straightforward.** `declareDowntime()`'s own header already said why: "Deliberately an
INSERT-only ledger... the full history stays visible for the story record" — `campaign_downtime_declarations`
is append-only and its `select` grant/RLS already allow any campaign member to read it (verified in
`sql/schema.sql`/`sql/rls-policies.sql`), so no migration was needed. Added `getDowntimeHistory(campaignId)`
to `js/dm.js`, mirroring `getGoldHistory()`'s exact shape (a plain `.from(...).select(...)`, not an RPC) —
including the `profiles!<table>_<column>_fkey` join for the declaring DM's display name, using Postgres's
auto-generated FK-constraint-name convention (`campaign_downtime_declarations_declared_by_fkey`), the same
convention `getGoldHistory`/`getAwardHistory` already rely on for their own tables. Wired a "📒 History"
button next to "Declare for the party", reusing the same `.hist-modal` (already fixed for dark-mode
contrast, see the first addendum above) — each row shows date/days/DM/note, plus who it was for: `<b>Party
base</b>` for a `characterId`-null row, or the resolved character's name + "(bonus)" for a per-character
bonus row (resolved against `cloudRoster`, same pattern `.hist-btn`/`.unbind-btn` already use).

**The move surfaced a real, pre-existing bug.** `#campDowntime` was a SIBLING of `#campRoster` (both
direct children of `#campSection`), but its only click handler — `.declare-btn`, inside
`wireCloudRosterDelegation()` — was delegated on `#campRoster` itself. A click inside a sibling never
bubbles through a listener on another sibling; DOM event delegation only reaches a listener on an
ancestor of the clicked element. Verified directly (Playwright, monkey-patched `declareDowntime` to a
call-tracking stub): clicking "Declare for the party" never invoked it, either before or after this
move — **this was already broken in the shipped app**, structurally, since the control was written; no
test ever simulated the click (`economy-ui-e2e.mjs` only asserted the button's presence in rendered
HTML, never fired it), which is exactly the shape of gap that lets a dead button ship. My first attempt
at moving the control (relocate the HTML, add the history button, leave the handlers where they were)
would have shipped the SAME bug relocated, plus a brand-new unreachable history button next to it — caught
by testing the actual click, not just checking the button rendered.

**Fix:** pulled `.declare-btn` and `.downtime-hist-btn` handling OUT of `wireCloudRosterDelegation()`
entirely into their own small `wirePartyDowntimeDelegation()`, delegated on `#campDowntimeTile` — a
stable parent that survives `_renderPartyDowntime()`'s `innerHTML` rebuilds (unlike `#campDowntime`
itself, whose children get replaced every render). Replicated the same peek-write-guard shape
`wireCloudRosterDelegation` already applies to `.declare-btn` (a write, must refuse independently of the
disabled attribute) — `.downtime-hist-btn` gets no such guard, matching `.hist-btn`'s own precedent (a
read). `campDowntimeTile` was already in `_PEEK_SCOPES` from the move itself, so the visual
disabled-during-peek state already worked via the existing `_paintRoster()` → `_renderPeekState()`
re-sweep that runs after every roster repaint (verified: calling the render+re-sweep pair in the same
order `loadRoster()` uses correctly disables both new buttons; calling the render test-seam alone,
bypassing that re-sweep, does not — a test-harness-only distinction, not a real gap, confirmed by
matching `loadRoster()`'s actual call order).

Verified end-to-end (Playwright, monkey-patched `declareDowntime`/`getDowntimeHistory`): declaring now
actually calls `declareDowntime(campaignId, days, null, note)` with the right arguments, and the History
button renders real declaration rows correctly labeled Party base vs `<character> (bonus)`.
`dm-console-ui-e2e.mjs` (96/96) and `economy-ui-e2e.mjs` (155/155) both re-run clean.
