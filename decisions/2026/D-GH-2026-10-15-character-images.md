# D-GH-2026-10-15-character-images — up to two pictures per cloud character, in private storage keyed by character id

**Status:** in force once merged — the client half ships disabled-in-practice until the owner applies
`sql/migrations/2026-10-15-character-images.sql` (**NOT APPLIED** at the time of writing) and runs `get_advisors`.
Owner decisions AI2 (2026-10-14) settle access and limits; the remaining choices below were taken by the
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
5. **NPC pictures.** "Other players of the campaign" could be read to include NPCs (the DM's characters in the campaign).
   **Conservative: an NPC's pictures are readable by the DMs only** — an NPC is the DM's prep, and
   `is_campaign_member()` already refuses to treat NPC rows as membership. A DM who wants players to see an NPC can show
   it at the table.

## Decision
- Bucket `character-images`: **private**, `file_size_limit` 2 MB, `allowed_mime_types` webp/jpeg/png.
- Object names must match `^<lower-case uuid>/[12]$` (`character_image_character()`; anything else → NULL → refused).
- `select`: owner, or `is_campaign_dm(campaign)`, or (`not is_npc` and `is_campaign_member(campaign)`).
  `insert`/`update` (USING and WITH CHECK)/`delete`: the current owner only. All `to authenticated`; never `anon`.
- Client (`js/character-images.js`, loaded by each tool through its own dynamic `import()` so a failure costs only the
  pictures): validates type, shrinks to ≤ 1600 px WebP (JPEG fallback) under 2 MB — re-encoding also strips EXIF/GPS
  metadata — uploads with `upsert` (Replace), deletes (Remove, after a confirm), refuses a third. Pictures are shown only
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
  in the bucket but are readable and deletable by **nobody** through the API (no row → no policy passes). Cost ≤ 4 MB
  each. A cleanup sweep (service role / dashboard) is a follow-up, not built.
- **Restore from `character_backups`** with the same id brings any kept pictures back automatically (path = id).
- **NPC duplicate** (`duplicateNpc`, #665): the copy starts with **no pictures** (not copied) — copying would need a
  Storage copy per slot and the DM can re-upload; nothing is lost.
- **Ownership transfer** (character claim): pictures **travel** with the character (path has no owner).
- **Appearance copy/paste (#662), Undo, Randomise, time travel:** pictures **never travel and never change** — they are
  not in `appearance` or the LOG.

## Why
- Nothing derived or duplicated is stored on the character (AGENTS.md data rule); the bucket is the single source.
- The limit and the access rules are enforced where they cannot be bypassed: object names and RLS, not the UI.
- Keyed on the character id, every existing lifecycle operation (move, unbind, claim, restore) already does the right
  thing without new server code — tested in `run-images.sh` (45 cases; BEFORE 17 fail, AFTER all pass, idempotent re-run,
  rollback back to BEFORE).

## Not covered / follow-ups
- The Storage API's size and MIME limits are not exercisable in the Docker harness (they live outside Postgres); they
  should be spot-checked once after applying (upload a > 2 MB file and an SVG with the REST API — both must be refused).
- Orphan sweep for offline / DM deletes (above).
- The DM Console's Customisable card view and the "no character data yet" card show no thumbnails (the regular Card
  view does).

## Status
NOT APPLIED — needs the owner to apply `sql/migrations/2026-10-15-character-images.sql` and run `get_advisors`
(security + performance). `sql/rls-policies.sql` / `schema.sql` are deliberately not changed until then (per
`sql/migrations/README.md`, the fold follows the apply); storage policies are not part of the fresh-install baseline
anyway, so the fold should add a short "Storage" section that loads this migration's statements. No `DATA.version` bump
(no rules change).
