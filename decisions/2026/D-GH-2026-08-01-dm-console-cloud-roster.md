# D-GH-2026-08-01-dm-console-cloud-roster — Cloud roster gets full character cards, a real "remove" path, and DM-private per-character notes

Status: Active

- **Context:** Live user report on the DM Console: "I can't see the cloud characters in the grid or
  card. I also have no way to remove them. I also want to be able to add some fields to each such as
  the player's name. or per character notes." Investigation found three separate, real gaps:
  1. Locally-imported `.json` characters render as rich cards (`#grid` → `cardHTML()` →
     `buildSections()`, built from `dmAnalyze()`/`analyzeAug()`) with full stats, skills, spellcasting,
     etc. Cloud (campaign) characters rendered through a completely separate, much thinner path —
     `#campRoster`'s `loadRoster()` built a plain `<table>` with only Player / Character / DM AP /
     Award AP / History columns, because `js/dm.js`'s `getRoster()` never selected `stats` at all —
     there was nothing to run through the engine even if the UI had wanted to.
  2. `characters.campaign_id` had no "unset" path anywhere in the schema. It's set by
     `join_campaign()` and `bind_character_to_campaign()` (both `SECURITY DEFINER`), but no function
     ever clears it, and `characters_update`'s row policy is owner-only
     (`owner_id = auth.uid()` in both `USING`/`WITH CHECK`) — a DM removing a *player's* character
     can't touch that row via a plain grant, the same reason `award_ap()` needed a `SECURITY DEFINER`
     bypass for `ap`. There was no equivalent for `campaign_id`.
  3. No per-character DM annotation existed at all — not even a place to note "this is Jess's second
     character" or a memorable player label when a player's account `display_name` is blank/unhelpful.
- **Options considered (three independent decisions, bundled because they landed in the same
  investigation):**
  - **Remove semantics** — asked the user directly (AskUserQuestion): (A1) unbind from the campaign
    only, character and data survive untouched vs. (A2) permanently delete the character record.
    Chose **A1** — deleting a *player's* character from a DM-facing console is far more destructive
    than the phrase "remove them" implied, and nothing about the request called for permanent data
    loss. A1 also composes cleanly with the existing `archive_campaign` reversible-soft-delete pattern.
  - **Notes visibility** — asked the user directly: (B1) DM-only/private (mirrors the DM Notes tile
    already added at the campaign level this same session) vs. (B2) visible to the player too. Chose
    **B1** — these read as DM bookkeeping ("owes me a recap"), not player-facing communication.
  - **Where do DM-only fields live, given B1?** Not asked separately (implementation detail, not a
    product decision): (i) new columns on `characters` — rejected, `characters` has a blanket
    `grant select ... to authenticated` (rls-policies.sql) with only *row*-level filtering; Postgres
    RLS cannot hide one column within a row a policy already allows through, so any new column would
    be visible to the character's own owner the instant their `owner_id = auth.uid()` row-select
    passes — directly violating the B1 choice. (ii) **a new `character_dm_notes` table** with its own
    RLS policy (chosen) — clean isolation, and permission is evaluated via a live join to the
    character's *current* `campaign_id` (`is_campaign_dm_of_character()`, a new `SECURITY DEFINER`
    helper) rather than a cached/denormalized `campaign_id` on the notes table itself — so notes
    automatically stop being visible to a DM the moment a character is unbound (option A1) or later
    re-bound to a different campaign, instead of leaking a stale campaign association forever.
  - **Card-grid merge strategy** — (i) merge cloud rows into the same `roster` array/`#grid` used by
    local imports — rejected: `roster` is persisted to `localStorage` and drives drag-drop/"Clear
    party" semantics that don't apply to live cloud data (always re-fetched, never cached locally).
    (ii) **keep `#campRoster` as its own container/array (`cloudRoster`), but render through the exact
    same `cardHTML()`/`buildSections()`/`analyzeAug()` functions** (chosen) — one card-rendering
    implementation, two independent data sources, matching how the codebase already treats "local
    import" and "cloud campaign" as parallel-but-separate concerns elsewhere in this file.
- **Decision / what shipped:**
  - `js/dm.js`: `getRoster()` now also selects `stats` (so cloud rows can be analyzed like an import)
    and left-joins `character_dm_notes(player_label, notes)`. Added `unbindCharacter()` (calls the new
    RPC) and `setCharacterDmNotes()` (plain upsert — no RPC needed, the table's own RLS scopes it).
  - `sql/migrations/2026-08-01-dm-remove-character-notes.sql` (mirrored into `schema.sql` /
    `rls-policies.sql`): `dm_unbind_character(p_character)` RPC (`SECURITY DEFINER`, checks
    `is_campaign_dm()` on the character's current campaign, same shape as `award_ap()`); the
    `character_dm_notes` table + `is_campaign_dm_of_character()` helper + its own `for all` RLS policy
    (never the character's owner). Applied directly to the live Supabase project (with the user's
    explicit go-ahead) via `apply_migration`; `get_advisors` (security + performance) showed no new
    issues beyond the app's existing, already-accepted `SECURITY DEFINER`-callable-by-`authenticated`
    pattern shared by every other RPC in this file.
  - `tools/DM-Console.html`: `cardHTML(r, dm)` gained an optional second argument — cloud cards get an
    extra "DM tools (private)" section (`dmToolsBody()`: player-name label, notes, Save button, Award
    AP mini-form, History button, "Remove from campaign" button with a confirm dialog explaining the
    character/data survive) and skip the local-only corner "×" entirely (deliberately a *different*,
    more deliberate affordance than the local grid's trivially-reversible one-click remove). Fixed a
    latent `roster.map(cardHTML)` bug on the way: `Array#map` also passes `(index, array)` to its
    callback, which would have silently fed every local card's numeric index into the new `dm` param
    as a truthy value for every card past index 0 — now an explicit `roster.map(r => cardHTML(r))`.
    `#campRoster`'s render + interaction logic lives in the same IIFE as the local grid's (so it can
    reuse `cardHTML`/`buildSections`/`analyzeAug`/`dmToolsBody` directly); the separate `campaign-ready`
    script (a different `<script>` tag/closure) calls the one exposed entry point,
    `window._dmRenderCloudRoster(container, rows)`, after `B.getRoster()` resolves.
- **Why:** each of the three sub-decisions has a concrete failure mode if inverted — deleting instead
  of unbinding destroys another user's data over what read as a UI/visibility complaint; notes-as-a-
  `characters`-column would have silently broken the "DM-only" choice the user explicitly made, only
  visible in Supabase's own RLS semantics, not obviously wrong from the client code alone; and
  denormalizing `campaign_id` onto the notes table would have let a departed campaign's DM keep reading
  notes on a character that moved on. Worth a full record (not just a changelog line) because a future
  session touching `characters` RLS, campaign membership, or "what can players see," should know this
  table exists and *why* it's separate, before assuming a quick column-add is equivalent.
- **Status:** IN FORCE. Verified via a headless Playwright drive of the real DM Console code
  (`window._dmRenderCloudRoster` + the real click-delegation) with `window._campBridge`'s network
  methods stubbed at the same interface `js/dm.js` exports — confirmed: full stats render on a
  cloud card with real LOG data; the "no character data yet" placeholder for a roster row with no
  saved stats; player-label chip + notes fields pre-filled and editable; Save/Award/History/Unbind all
  invoke the correct backend calls with correct arguments; the confirm-dialog text; and the card
  disappearing from the roster after a successful unbind. `engine-parity-ci.mjs` still 20/0 (no
  `js/engine.js` change in this record). Live migration applied and advisor-clean.
