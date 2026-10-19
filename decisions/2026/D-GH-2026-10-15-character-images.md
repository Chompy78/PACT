# D-GH-2026-10-15-character-images — up to two pictures per cloud character, in private storage keyed by character id

**Status:** **APPLIED 2026-10-19** — see *Status* at the end for the checks run and the one still outstanding.
Owner decisions AI2 (2026-10-14) and AQ2 (2026-10-15, NPCs) settle access and limits; the remaining choices below were taken by the
implementing agent under standing instruction H2 (most conservative option) and are reversible.

## Context
Owner request 2026-10-14 (`feat/character-images`): a place on the character — Live Sheet Character panel / 📋 Sheet,
CharGen's appearance area — to upload character pictures, at most two, shown on the sheet and on the DM Console card.
This is the first time the app stores user files: until now the only backend data was rows, and the only cross-user
data was text (with the `esc()` rule). The task asked for a decision on storage, limits, local characters, archive /
delete, DM copies and NPC duplicates, appearance copy/paste (#662) and how pictures are served.

## Owner decisions (AI2, 2026-10-14)
- **Read:** the character's owner, the DMs of its campaign, and the other players of that campaign.
- **Write / delete:** the owner only. **Max 2** per character. **JPG / PNG / WebP**, **≤ 2 MB**, shrunk in the browser
  first (e.g. WebP ≤ 1600 px). **Signed-out / local-only characters get no pictures.**

## Options considered
1. **Where the bytes live.** (a) a data URL in `stats` / the LOG — rejected by the task itself: it bloats every save, sync,
   autosave and `character_backups` row, and the LOG is replayed everywhere. (b) a new table with a `bytea` column —
   no CDN, no size/MIME limits, and every roster read drags megabytes through PostgREST. (c) **a private Supabase
   Storage bucket** — built for this, size/MIME limits enforced by the Storage API, RLS on `storage.objects`. Chosen.
2. **What the character records about its pictures.** (a) the two object paths in `appearance` (the task's suggestion) —
   a second copy that can drift from the bucket, and `appearance` travels with copy/paste (#662) and undo frames. (b) a
   small column on `characters` — needs a grant change and still drifts. (c) **nothing: the path is derived,
   `<character id>/<slot>`** — nothing to drift, nothing in the LOG, and the slot name itself enforces the limit. Chosen.
3. **Path shape.** (a) `<owner_id>/<character_id>/<n>.webp` (the task's example; the common Supabase per-user-folder
   convention) — but `redeem_character_claim()` changes `owner_id`, which would strand the files under the old owner's
   folder or require a server-side rename. (b) **`<character_id>/<slot>`, slot `1` or `2`, no extension**, with every
   policy reading the character row live — ownership transfer and campaign moves need no file operation. Chosen. No
   extension because a browser that cannot encode WebP (older Safari) falls back to JPEG; the content type travels as
   object metadata, so the name never lies about the format.
4. **How the policies check access.** Policies on `storage.objects` querying `public.characters` directly would be subject
   to characters' own RLS (a fellow player cannot select another player's row). Two **SECURITY DEFINER** helpers,
   `can_read_character_image(name)` / `can_write_character_image(name)`, built on the existing `is_campaign_dm()` /
   `is_campaign_member()` — the same recursion-breaking pattern as `is_campaign_dm_of_character()`. EXECUTE revoked from
   `public`/`anon`, granted to `authenticated` only.
5. **NPC pictures.** First built DM-only (H2); **owner decision AQ2 (2026-10-15): NPC pictures are visible to the
   whole campaign, the same as player characters.** The read helper no longer looks at `is_npc`.
6. **Leftover files and recycled ids (review finding, deep fix).** `characters.id` is client-chosen (it is in the insert
   grant), so a deleted row's leftover pictures could be inherited by anyone who inserts a new row with the same uuid.
   Shallow fix: delete files reliably on every delete path (impossible to guarantee — offline deletes, DM deletes, SQL
   cannot delete storage objects). **Deep fix (chosen): bind each object to the row incarnation** — every policy passes
   the object's `created_at`, and the helpers require `objects.created_at >= characters.created_at`. Neither timestamp
   is client-settable (`characters.created_at` is outside the insert grant and defaults to `now()`; `storage.objects`
   is written only by the Storage API). An object older than the current row is invisible and untouchable to everyone.

## Decision
- Bucket `character-images`: **private**, `file_size_limit` 2 MB, `allowed_mime_types` webp/jpeg/png.
- Object names must match `^<lower-case uuid>/[12]$` (`character_image_character()`; anything else → NULL → refused).
- `select`: owner, or `is_campaign_dm(campaign)`, or `is_campaign_member(campaign)` — NPCs included (AQ2).
  `insert`/`update` (USING and WITH CHECK)/`delete`: the current owner only. All `to authenticated`; never `anon`.
  Every one of them also requires `objects.created_at >= characters.created_at` (option 6).
- Client (`js/character-images.js`, loaded by each tool through its own dynamic `import()` so a failure costs only the
  pictures): validates type, shrinks to ≤ 1600 px WebP (JPEG fallback) under 2 MB — re-encoding also strips EXIF/GPS
  metadata — reads the pixel size from the file header first and refuses anything over 64 MP or 16 384 px on a side before
  decoding (a decompression bomb cannot crash a phone tab), then decodes straight to the target size. **Replace** uploads
  with `upsert`; **Add** uploads with `upsert: false`, so a slot that a stale cache thought empty but was filled from
  another tab/device answers 409 — the panel refreshes and asks the player to press Add again instead of overwriting.
  Remove deletes after a confirm; a third is refused. The edit controls appear only for the character's **owner**
  (one batched `characters` lookup alongside the signing): a DM editing a player's character, a fellow player, or a
  uuid never saved to the cloud see pictures without controls (the last gets a "save to the cloud" hint). Pictures are shown only
  through **10-minute signed URLs**, checked to be this project's storage sign route before use, set as `img.src` /
  `a.href` through DOM properties; no user-controlled string reaches `innerHTML` (the placeholder's character id
  attribute is `esc()`-ed). Signed URLs are cached ~8 minutes per character so a tool repaint costs no request; the DM
  Console signs a whole roster in **one** request.
- **Signed out or a non-cloud (non-uuid) id:** a hint in the edit views ("sign in and save … to the cloud"), nothing in
  read-only views; no request is made. A character not yet saved to the cloud gets the owner-only message on upload
  (the policy needs its row).
- **Missing bucket (migration not applied):** the first upload answers "Bucket not found"; the module turns that into a
  plain "pictures aren't switched on for this server yet" message and hides the add controls for the session.

## Lifecycle decisions (H2 — conservative, reversible)
- **Archive:** files are **kept** (archive is reversible; access still follows the row's policies).
- **Permanent delete by the owner** (`tools/characters.html`): the pictures are deleted **first**, best effort, while the
  row still proves ownership; then the row. A failure never blocks the delete.
- **Leftovers** — a delete made offline (tombstone replay in `js/sync.js` deliberately not touched: its CI harnesses
  rewrite its imports textually), or a character deleted by a campaign DM (the DM may not touch the owner's files) — stay
  in the bucket. While no row has that id, no policy passes. If a row is later **recreated with the same uuid**, it has a
  newer `created_at` than the leftover, so the leftover stays unreadable, unreplaceable and undeletable through the API —
  for the new owner too (tested). Only the service role can remove them. Cost ≤ 4 MB each. A cleanup sweep is a board
  entry (`chore/character-images-orphan-sweep`), not built. One consequence: a recreated row cannot reuse a slot still
  occupied by a leftover until the sweep removes it (the upload is refused); the other slot works.
- **Restore from `character_backups`**: a restore that keeps the row's original `created_at` brings the pictures back
  (path = id); one that inserts a fresh row does not (see above).
- **NPC duplicate** (`duplicateNpc`, #665): the copy starts with **no pictures** (not copied) — copying would need a
  Storage copy per slot and the DM can re-upload; nothing is lost.
- **Ownership transfer** (character claim): pictures **travel** with the character (path has no owner).
- **Appearance copy/paste (#662), Undo, Randomise, time travel:** pictures **never travel and never change** — they are
  not in `appearance` or the LOG.

## Why
- Nothing derived or duplicated is stored on the character (AGENTS.md data rule); the bucket is the single source.
- The limit and the access rules are enforced where they cannot be bypassed: object names and RLS, not the UI.
- Keyed on the character id, every existing lifecycle operation (move, unbind, claim, restore) already does the right
  thing without new server code — tested in `run-images.sh` (55 cases; BEFORE 20 fail, AFTER all pass, idempotent re-run,
  rollback back to BEFORE).

## Live post-apply spot-check (the Docker harness cannot reach the Storage API)
After applying the migration, signed in as a test player who owns a cloud character in a test campaign:
1. **Before applying** (or on a project without the bucket): Add a picture — the panel must say pictures "aren't
   switched on for this server yet" (the "Bucket not found" path), not a raw error.
2. Add a picture — it shows; then **Replace** it — the upsert succeeds and the new picture shows (needs the owner's
   SELECT + INSERT + UPDATE policies together).
3. Upload a **> 2 MB** file straight to the Storage REST API (bypassing the browser shrink), e.g. `curl -X POST
   $SUPABASE_URL/storage/v1/object/character-images/<id>/2 -H "Authorization: Bearer <player JWT>" -H "apikey: <anon>"
   -H "Content-Type: image/jpeg" --data-binary @big.jpg` — must be refused (413 / "maximum allowed size").
4. The same with a small **SVG** (`Content-Type: image/svg+xml`) — must be refused (mime type not supported).
5. A fellow campaign player sees the picture; a signed-in outsider gets nothing.

## Not covered / follow-ups
- Orphan sweep for offline / DM deletes (above; board entry).
- The DM Console's Customisable card view and the "no character data yet" card show no thumbnails (the regular Card
  view does).

## Status
**APPLIED 2026-10-19** (owner, `apply_migration`, ~01:11 UTC; the file verbatim minus its header comments) and folded into
`sql/rls-policies.sql` the same day as a guarded "Storage" section (it runs only where `storage.objects` exists, i.e. on
Supabase; `testing/sql/rls-baseline-test.sql` loads a storage stub so the section is built and drift-checked there). Bucket row
live: private, `file_size_limit` 2097152, `allowed_mime_types` webp/jpeg/png. Live spot-check as real users inside a
rolled-back transaction (nothing persisted; 0 objects afterwards), 8 of 8 passed: owner inserts `<id>/1`; `<id>/3` refused;
owner update of `/1` (1 row); the DM reads 1; a fellow campaign player reads 1; a fellow player's insert of `/2` refused; an
outsider reads 0; an outsider's direct delete blocked (Supabase's "Direct deletion from storage tables is not allowed" guard).
Advisors: the only new items are 2 WARN "authenticated can execute SECURITY DEFINER" for `can_read_character_image` /
`can_write_character_image` — intentional (the storage policies call them, same pattern as `is_campaign_dm`; each returns only
a boolean about the caller's own access); performance nothing new; no Postgres errors after the apply. **NOT yet run:** the
browser-level checks 2–5 above with a real JWT through the Storage REST API — 3 and 4 (> 2 MB and SVG refused) are verified
only at the config level (the bucket row's limits); the owner runs them once with a real account (board:
`chore/character-images-orphan-sweep`). No `DATA.version` bump (no rules change).
