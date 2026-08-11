# D-GH-2026-08-10-dm-custom-character-fields — campaign-level custom character fields + a Customisable card view

Status: **Active**, 2026-08-10.

## Context

Owner request: let a DM add their own fields to a campaign's roster — 2 numeric, 2 text — and a new
roster-card view where the DM arranges which stats/fields show in which box on each card. Before
implementing, three design ambiguities were resolved with the owner directly (a chat tool failure meant
the questions had to be asked as plain text, per `AGENTS.md`'s `AskUserQuestion` retry-then-fallback
protocol — not a design choice, noted for the record only):

- **Field scope** — campaign-level (one shared set of definitions for the whole roster), not per-character.
- **Visibility** — configurable **per field** ("show players or not"), **defaulting to OFF**.
- **Layout storage** — the Customisable view's box arrangement is **per-device**, matching the existing
  Table view hidden-columns `localStorage` pattern (`pact_dm_v3_cols`).

## Options

**A — Where do field DEFINITIONS live?**
- A1 (chosen). Inside the existing `campaigns.rules` jsonb column, under a new `customFields` key — no
  schema change, reuses the DM-authoritative rules blob (D-GH14) that already has a DM-write/member-read
  RLS grant and a single shared "Save rules" UI flow.
- A2. A dedicated `campaign_custom_fields` table. More normalized, but needs its own RLS policy pair for
  something that's really just more campaign settings, and a second save/round-trip path alongside the
  existing rules editor. Rejected — the `rules` column exists precisely to avoid this per D-GH14.

**B — Where do per-character field VALUES live?**
- B1 (chosen). A new `custom_fields` jsonb column on the existing `character_dm_notes` table (DM-only
  per-character annotations, D-GH-2026-08-01). Reuses that table's RLS as-is — no new policy needed.
- B2. A new table. Same reasoning as A2 — values are conceptually identical in access pattern to the
  player-label/notes already in `character_dm_notes` (DM-only, per character), so a second table would
  just duplicate that table's exact RLS shape for no benefit.

**C — How does the "visible to players" flag get enforced?**
- C1 (chosen). A new SECURITY DEFINER RPC, `get_character_visible_fields(character_id)`: for a campaign
  DM, returns every value unfiltered (they already have raw table access via B1's RLS); for the
  character's own owner, returns only the slots the campaign's rules currently mark `visible: true`.
- C2. Grant players a raw SELECT on `character_dm_notes` (or a subset of its columns). Rejected outright:
  `character_dm_notes`'s RLS is DM-only specifically so the player-label/notes fields stay private
  (D-GH-2026-08-01) — RLS is row-level, not per-JSON-key, so any grant wide enough to expose a *visible*
  custom field would expose every *hidden* one too, in the same row, to the same query. C1 filters
  server-side instead, so the boundary is enforced regardless of what any future UI does or doesn't check.
- C3. Don't enforce it at all yet — leave "visible" as a DM-Console-only display hint with no real
  read-path consequence. Rejected: DM Console can already see every field regardless of the flag (a DM
  has full table access), so a flag with no enforcement would be a checkbox that visibly does nothing —
  worse than not having it, since a DM ticking "visible to players" would reasonably expect it to mean
  something. C1 costs one small SQL function and makes the toggle a real, testable contract immediately,
  even with no UI consumer yet (see Scope below).

**D — Does this task also build a player-facing display?**
- D1 (chosen). No. The request was specifically a DM Console feature (definitions + a new roster card
  view); a player-facing surface (e.g. Live Sheet showing its own character's visible custom fields)
  touches a second tool's UI and roughly doubles scope for something not asked for.
- D2. Also wire Live Sheet's own-character view to call `get_character_visible_fields()`. Deferred, not
  rejected — genuinely useful, but out of scope for this task. Tracked as `feat/custom-fields-player-
  display` on `docs/TASK_BOARD_NEXT.md` so the RPC built under C1 has a concrete follow-up consumer
  rather than sitting unused indefinitely.

## Decision

- Definitions: `campaigns.rules.customFields = {num1:{label,type,visible}, num2:{...}, text1:{...},
  text2:{...}}` — four fixed slots, a blank label means "not defined" (and is how a DM removes a field).
  Edited in DM Console's Campaign Rules panel, saved by the existing shared "Save rules" button/flow.
- Values: `character_dm_notes.custom_fields jsonb`, keyed by the same four slot ids. Edited per character
  from that character's "DM tools" panel (Card view, the no-data placeholder card, and the new
  Customisable view all share one `customFieldValuesBody()` renderer / `.cf-val-save` handler).
- Enforcement: `get_character_visible_fields(character_id)` (SECURITY DEFINER), covered under Options C.
- New view: `view` grows a third state, `'custom'`, cycled by the same `#viewToggle` button
  (Card → Table → Customisable → Card). Box layout is 6 fixed boxes, each assigned a field from
  `fieldCatalog()` (every non-name `COLS` entry plus any defined custom fields), picked via a
  `#xToolbar`/`#xPanel` dropdown-per-box UI mirroring Table view's `#colBtn`/`#colPanel` Columns picker.
  Persisted as `localStorage['pact_dm_v3_customlayout']` — per-device, never synced, matching the owner's
  answer and the precedent `pact_dm_v3_cols` already set.
- Scope: campaign-scoped only. The Customisable view only changes how `#campRoster` (the cloud/campaign
  roster) renders; a locally-imported (`roster`/`#grid`) character — not bound to any campaign — has no
  custom fields to show, so it keeps rendering as an ordinary card in every non-Table view, same as it
  already does today.

## Why

The whole feature rides two already-established extension points (`campaigns.rules` for campaign-wide
DM settings, `character_dm_notes` for DM-only per-character data) rather than adding new tables, so no
new RLS policy was needed anywhere — only one new column (`character_dm_notes.custom_fields`) and one new
function (`get_character_visible_fields`). The "visible to players" flag was built to be a real,
server-enforced boundary from the start (Option C1) rather than a UI-only label that could later be
mistaken for actual protection — cheap to add now, and the alternative (adding real enforcement only once
a player-facing consumer exists) risks that consumer being built against a table-level grant instead,
which would leak hidden fields the moment it shipped.

## Status

**Active.** Migration applied to the live PACT Supabase project (`piuprrrnaotrtxucrtsb`) via
`sql/migrations/2026-08-10-dm-custom-character-fields.sql`, mirrored into `sql/schema.sql` /
`sql/rls-policies.sql`. `get_advisors(security)` run after applying — no new findings beyond the
project's existing, expected "SECURITY DEFINER callable by authenticated" pattern shared by every DM RPC
in this schema (`award_ap`, `dm_edit_character_log`, etc.). `engine-parity-ci.mjs` unaffected (30/0) —
this feature never touches `js/engine.js`.

**Addendum (2026-08-10) — `feat/custom-fields-player-display` shipped.** The Option D2 follow-up (a
player-facing display) landed same-day: `getVisibleCustomFields(characterId)` added to `js/dm.js`
(co-located with `setCharacterCustomFields`, not `js/campaign.js` — keeps the read/write pair together)
wrapping the RPC. `tools/PACT-Live-Char-Sheet.html` calls it from both cloud-load paths
(`refreshCloudCampaignRules()` on boot/refresh, `loadCloudChar()` on an explicit Load), caching the
result in `window._lsVisibleCustomFields` (reset alongside the rest of `_lsResetCloudApState()`'s cloud
state, and explicitly on the "not campaign-bound" branch to avoid a stale cross-character leak on the
same device when switching characters). `render()` renders a `From your DM:` segment only when a visible
field has both a DM-set label (from the already-cached `window._cloudCampaignRules.customFields`) and a
non-empty value — no empty section for a campaign with nothing configured. Explicitly gated off for
`VIEW_ONLY` (a DM's own `?viewChar=` read-only peek of a player's character) — that panel is framed as
"what your DM shared with you," which doesn't fit a DM looking at their own peek copy. Every label/value
pair is escaped through the shared `esc()` helper before rendering (cross-user string, same hard
invariant as everywhere else in this codebase). Verified: no new console/page errors on load (Playwright
smoke test), `engine-parity-ci.mjs` unaffected (30/0, untouched). Follow-up graduated off
`docs/TASK_BOARD_NEXT.md` into `CHANGELOG.md` in the same change.
