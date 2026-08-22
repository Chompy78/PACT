# 2026-08-22 — Amble: "New Character" → "Archer" rename, and Chapter 3 AP split

All work in this session was direct Supabase data edits on the live PACT project
(`piuprrrnaotrtxucrtsb`), requested by the owner in chat. No `js/engine.js`/`DATA` change, no
`tools/*.html` behaviour change other than the one bug fix noted at the bottom.

## 1. Renamed "New Character" → "Archer"

Character `d686f6e9-7b42-44cf-8c7e-20b09f86e58e` in the Amble campaign
(`a6687e29-7c12-46b2-a9a3-711586a9ca12`).

- Updated `characters.name` directly.
- **Also** had to replace the singleton `{type:'name', name:'New Character', ...}` event inside
  `characters.stats.LOG` with `{type:'name', name:'Archer', ...}` — filter-out-and-append, the exact
  pattern CharGen's `_cgSyncSingletonEvent('name', ...)` and the Live Sheet's own rename button use
  (`js/engine.js` foldBuild: `if (e.type === 'name') { b.name = e.name; }`). This was the actual gap:
  the DM Console roster card for a character with real build data (`hasData: true`) reads
  `summary.name` off the *replayed LOG*, not the `characters.name` column — the column only backs the
  "no character data yet" placeholder card. Renaming only the column left the DM Console (and any
  other engine-derived name display) still showing "New Character" until this second edit.
  `SEQ` bumped 19→20 to match; no economic/protected events touched, so neither
  `trg_pact_ap_budget_consistency` nor `trg_pact_locked_history` (both keyed off `stats` changing) had
  anything to object to.

## 2. Archer's DM AP ledger

Owner asked to replace Archer's single `ap_awards` row (+33, "Kendal join") with three itemized
entries:

| Amount | Note |
|---|---|
| +30 | Creation budget |
| +3 | Chapter 1 bonus |
| +17 | Chapter 3 set |

`characters.ap` set to 50 to match. DM attribution (`dm_id`) carried over from the original entry —
the Amble campaign's only DM. No `Date`/`DM` values were given for the new rows, so `created_at`
defaulted to `now()`.

**Follow-up correction:** owner then asked to change the Chapter 3 set entry from 17 → 16 (a
clarifying question was asked first, since Archer has no separate "Chapter 2" entry and the only +17
was on "Chapter 3 set" — confirmed that's what was meant). `characters.ap` dropped to 49 to match.

**Also asked** to remove Archer's "Chapter 3 bonus" — checked first: Archer never had a separate bonus
entry (unlike the other 6 players below), only "Chapter 3 set" alone. No-op, reported back rather than
deleting something that didn't exist.

## 3. The other 6 Amble characters — split "Chapter 3 set + bonus"

Anders Pipeleaf, Caspian, Fenwick Copperkettle, Kaelen Dawnbreaker, Moss Stormspud, Skylar all had one
`ap_awards` row combining "Chapter 3 set + bonus" at +17 or +18. Owner asked to split each into:

- "Chapter 3 set" — always **+16**
- "Chapter 3 bonus" — the original amount minus 16 (so +1 for a +17 original, +2 for a +18 original)

so each character's running AP total is unchanged. Verified after the edit: for every one of the 7
Amble characters, `characters.ap` still equals `sum(ap_awards.amount)` for that character. Each split
row kept the original entry's `created_at` (11:58:58 for five of the six; Kaelen Dawnbreaker's original
award was actually timestamped 11:09:15 that same day — kept as-is rather than forced to match the
others).

## 4. DM Console bug found along the way

Owner reported: removing a character from a campaign roster doesn't visually disappear from DM
Console until a manual page reload. Root cause: the unbind-success handler
(`tools/DM-Console.html`, delegated click handler on `#campRoster`) patched the closure-local
`cloudRoster` array correctly, but re-rendered by calling `renderCloudRoster(el)` directly —
which only repaints the card-grid container (`#campRoster`), not `#tableRoot` (Table view) or the
Customisable card view. A DM on either of those views kept seeing the removed character. Fixed by
calling the shared `render()` dispatcher instead (same function the view-toggle and initial load use),
which re-checks the active view (`view==='table'|'custom'|else`) and repaints whichever one is
actually on screen. See `CHANGELOG.md` for the matching entry; `testing/tests/engine-parity.html` is
unaffected (52 passed / 0 failed, unchanged by a DM-Console-only UI fix).
