# D-GH-2026-10-11-unique-character-names — the database refuses two active characters with the same name for one player

Status: Active once `sql/migrations/2026-10-11-unique-character-names.sql` is applied to live (see *Applying*).

## Context

A player (Christen) had two active cloud characters both named "Caspian" — the campaign one in CharGen and a stale
solo copy in Live Sheet — and could not tell which to load (2026-10-08). A duplicate-name guard already existed
(`_lsRenameGuard`, #545, 2026-09-18) but only in the browser and only on Live Sheet's **Rename** button: saving,
importing a file, switching tools and all of CharGen never checked, and the two Caspians predated it anyway.

## Options

- **G1 — run the browser check on every save, import and load in both tools.** Catches the common routes; a stale
  device or an old cached build can still slip past.
- **G2 — the database refuses it.** A unique index, with the tools translating the refusal into plain words.
- **G3 — leave it.** Real duplicates had been rare (one pair on the live DB).

**Decision: G2** (owner, 2026-10-10).

## Decision

1. `uq_characters_owner_active_name`: unique on `(owner_id, lower(btrim(name)))` where `archived_at is null`, exempting
   `'new character'`, `'character'` and names ending `' (dm copy)'`.
2. `redeem_player_invite()` and `redeem_character_claim()` now tell a name clash apart from "already in this campaign"
   (`get stacked diagnostics … constraint_name`) and raise `PACT: you already have a character named "…"`.
3. `js/sync.js`: `isDuplicateNameRejection()` + `DUPLICATE_NAME_MESSAGE`; `saveCharacter()` returns
   `{duplicateName:true}` and leaves the record dirty. Both tools show the message once per name on autosave and on every
   manual save; Live Sheet's clone, CharGen's character-claim banner and the characters page's Unarchive each say it plainly.
4. CharGen gains the early, advisory half Live Sheet already had: leaving the name field warns if another active
   character has that name (`_cgNameClashCheck()`, same exemptions as the server).

## Why

- **The index, not a trigger.** A `BEFORE` trigger that counts same-named rows races two simultaneous saves; a unique
  index cannot. The cost is that the error is a generic `23505`, so the client matches it by **index name** — the
  one-character-per-campaign index (`idx_characters_owner_campaign_unique`) raises `23505` too and means something else.
  The invite/claim RPCs previously caught *every* `unique_violation` as "already in this campaign"; left alone they
  would have turned a name clash into that wrong message.
- **Active rows only.** Archiving is the app's "put away" action, so an archived character must not hold its name
  hostage; un-archiving into a clash is refused instead (the characters page explains why).
- **The exemptions match how the tools actually name things.** Every fresh draft is "New Character"; a nameless save
  falls back to "Character"; a DM copy is "<source> (DM copy)", and two players' same-named characters would otherwise
  collide on the DM's account for a throwaway snapshot.
- **Not blocked like a seal.** A name clash, unlike a sealed history, is fixed by the player's own next edit (a rename),
  so the record stays dirty and the very next save retries; nothing is lost and nothing has to be reloaded.

**Blast radius (live, 2026-10-11):** 0 active pairs violate the index. The last real pair (Christen's) was resolved the
same day by renaming the stale copy "Caspian (old copy)" with a proper `name` event; one other account's two "Character"
rows are exempt. 0 archived rows share a name with an active one; 10 active DM copies, all exempt. Live definitions of
both RPCs were confirmed byte-identical (normalised) to `sql/schema.sql` before editing.

**Known limits.** CharGen's name-field check is advisory and needs the cloud list (signed in, online); the server is the
real rule. A clone or DM-copy attempt that fails on the name still leaves its local copy dirty, retried silently in the
background like any failed save.

## Applying

1. Apply `sql/migrations/2026-10-11-unique-character-names.sql` (re-count duplicates first — it fails if any exist).
2. Run the Supabase advisors and check the logs.
