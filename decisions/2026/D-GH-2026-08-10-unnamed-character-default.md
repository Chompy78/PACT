# D-GH-2026-08-10-unnamed-character-default — a real stored default name wins everywhere

Status: **Active**, 2026-08-10.

## Context

CharGen (via `js/sync.js`'s `saveCharacter()`) sets a real default NAME of `'New Character'` when a
character is saved with no name — matching `sql/schema.sql`'s own `characters.name text not null
default 'New Character'` column default and `redeem_player_invite`'s `v_name` fallback. DM Console,
independently, special-cased that exact string back to blank (`cloudAnalyze()`) and then substituted a
*different* literal, `'Unnamed character'`, at display time (`cloudCardHTML()`). Separately, CharGen,
the Live Sheet, and DM Console's local-file-import path each carried their own placeholder text
(`'Unnamed Hero'`, `'Unnamed hero'`, `'Unnamed'`) for the live, pre-save, in-memory state where
`baseBuild()`'s `name:''` has never been set at all. Filed from the 2026-08-04 usability review as LOW,
recorded NOT DONE at the time because resolving it means changing a shared default, not a display string.

## Options

- **A — Keep a real stored default name everywhere.** One write path (`js/sync.js`), no blank-string
  edge cases to handle at every display site; every surface simply renders the stored/live name field,
  whatever it is. (Chosen.)
- **B — Store blank, fallback text at each display site.** Matches DM Console's old behavior; requires
  auditing every render path for one consistent fallback string instead of relying on the data itself.

## Decision

**A real default name, `'New Character'`, wins everywhere** — both as the value actually stored
(unchanged: `js/sync.js`, `sql/schema.sql`, `redeem_player_invite` already agreed) and as the single
placeholder string shown at every point a name is genuinely absent, replacing every other literal
(`'Unnamed Hero'`, `'Unnamed hero'`, `'Unnamed'`, `'Unnamed character'`) across all three tools.

Two changes, in one place each:
1. **DM Console's `cloudAnalyze()`** no longer converts the stored `'New Character'` back to blank —
   the roster now shows the same string CharGen and the Live Sheet would show for that character. The
   defensive last-resort fallback in `cloudCardHTML()` (for the case `row.name` is somehow still empty)
   was changed from `'Unnamed character'` to `'New Character'` too, so even that edge case can no longer
   diverge.
2. **Every live/pre-save placeholder literal** across CharGen, the Live Sheet, DM Console's local-import
   path, `tools/characters.html` ("My Characters"), and `index.html`'s recent-characters cards was
   unified to `'New Character'` — these are a different layer (the in-memory `b.name`/`baseBuild()`
   state before anything is saved, or a defensive fallback for data that should never actually be blank
   given the DB's `not null default`) from the DB column default itself, but describe the same
   user-facing situation ("this character has no name yet"), and the task's own instruction was
   explicit: apply the convention in one place and leave no second literal in the codebase. (Left
   deliberately untouched: two unrelated `'(unnamed)'` fallbacks for fighting-style-granted *cantrip*
   names in both tools' printable sheets — a different domain, not a character name.)

No migration needed: characters already stored as `'New Character'` are unaffected — this changes only
what gets displayed for that state, not what gets written for it.

## Why

**The player and the DM must read the same word for the same character.** Before this, a freshly
redeemed, never-named invite showed `'New Character'` to the player (in CharGen/the Live Sheet) and
`'Unnamed character'` to the DM (in the roster) — for the exact same underlying row. Two different words
for one state reads as a bug even though, as the original review noted, they technically described
different code paths (a stored default vs. a display fallback). Collapsing them onto the storage layer's
already-existing convention was simpler than inventing a new shared fallback string: `js/sync.js` already
had the right answer, `sql/schema.sql` already agreed with it, and DM Console was the one surface
fighting it.

**Unifying the live placeholder strings too, not just the DM Console one, is what "one convention"
actually requires.** Leaving `'Unnamed Hero'` on the Live Sheet's printable sheet and `'Unnamed hero'` on
CharGen's own header while fixing only DM Console would have traded a two-tool divergence for a
still-real four-way one, just less visible because none of those four is the specific pair the original
report named.

## Verification

Display-only; no `DATA.version` change. Existing characters unaffected (verified: the fix touches only
what renders for the `'New Character'`/absent-name state, never what gets written). Gated in
`testing/scripts/tool-pricing-ci.mjs`'s new DM Console section — `window._dmRenderCloudRoster()` is a
pure DOM-render entry point over synthetic rows, reachable via the same zero-dependency CDP harness this
file already uses for Live Sheet and CharGen, so no Supabase sign-in is needed for this specific check.
Confirmed red against the original bug (both the `cloudAnalyze()` strip and the `'Unnamed character'`
literal reverted together) before trusting it, then green again. `dm-console-ui-e2e.mjs` (the project's
Playwright-based DM Console gate, which would also exercise this) could not run in this session —
Playwright is an npm dependency and AGENTS.md forbids npm in this repo. `testing/scripts/engine-parity-ci.mjs`
is unaffected (no engine code touched) and still reports 0 failed.

## Related

- 2026-08-04 usability review — original finding, recorded NOT DONE pending this decision.
- `D-GH-2026-08-10-add-player-hierarchy` — same session, same DM Console panel area, unrelated decision.
