# D-GH-2026-08-01-dm-console-listcharacters-leak — CharGen/Live Sheet's "load saved character" cloud menu leaked other players' characters to a DM

Status: Active

- **Context:** Live user report: "why can i see 4 characters. i should only have 1 visible when i
  select cloud" — the ☁ Cloud → "Load saved character" list in CharGen (and the mirrored list in Live
  Sheet) showed four "New Character" rows instead of one. Confirmed live against the production
  Supabase project (`piuprrrnaotrtxucrtsb`): the four rows belonged to **four different Google
  accounts**, all players who had redeemed invites into a campaign the reporting user DMs — not four
  characters the reporting user had created.
  - Root cause: `js/sync.js`'s `listCharacters()` (used by both tools' cloud menu) selected from
    `characters` with **no `owner_id` filter**, relying entirely on RLS. `characters_select`'s policy
    is (deliberately, for DM Console's roster view) `owner_id = auth.uid() or is_campaign_dm(campaign_id)`
    — correct for DM Console, but this menu is a personal "characters I've saved" switcher, not a
    roster view, so the DM-visibility half of that OR silently leaked into it.
  - A sibling function, `listMyCharacters()` (added later for `tools/characters.html`'s "My
    Characters" page), already does this correctly — it explicitly filters `.eq('owner_id', user.id)`
    — but the two cloud-menu call sites were never migrated onto it when it was added, leaving
    `listCharacters()` in place as a live footgun.
- **Options considered** (fix-depth choice per AGENTS.md; asked the user via `AskUserQuestion`, which
  failed to return an answer twice — proceeded on the stated Recommended option per AGENTS.md's
  documented handling of a failed `AskUserQuestion` call, not as a silent default):
  - **A1 (shallow):** swap the two call sites to `listMyCharacters()`, leave `listCharacters()` in
    `sync.js` unused/exported.
  - **A2 (deep, chosen):** delete `listCharacters()` entirely; point both call sites at
    `listMyCharacters()`. Verified via grep that no other caller existed anywhere in the repo before
    removing it.
- **Decision / what shipped:** Removed `listCharacters()` from `js/sync.js`. `tools/PACT-CharGen-
  Webtool.html`'s and `tools/PACT-Live-Char-Sheet.html`'s `sync-ready` cloud-menu code (`renderCgCloudMenu()`
  / the equivalent Live Sheet block) now import and call `listMyCharacters()` instead — same return
  shape (`id, name, kind, ap, campaign_id, updated_at, hasData`, plus `archived_at` which the menus
  don't currently use), so no other change was needed at either call site beyond the rename.
- **Why:** the deep fix (delete, don't just stop calling) closes the vulnerability class, not just
  today's instance of it — with `listCharacters()` still present and exported, any future feature
  (a new "recent characters" widget, a debug panel, a copy-pasted pattern from an older commit) could
  trivially reintroduce the exact same cross-user leak by picking the wrong-but-similarly-named
  function. Deleting it removes that choice entirely. Low risk: confirmed zero remaining callers
  before removal, and `listMyCharacters()` is already production-proven (it's what `characters.html`
  has used since its own addition). Worth a full record, not just a changelog line, because this is a
  trust-boundary bug (an RLS policy correctly scoped for one legitimate purpose — DM Console's roster
  read — leaking through an unrelated code path that never intended to grant that visibility) of the
  same class AGENTS.md already flags around `characters` RLS (see the companion
  `D-GH-2026-08-01-dm-console-cloud-roster` record) — a future agent adding ANY new query against
  `characters` should default to `listMyCharacters()`'s explicit-filter pattern, not bare RLS
  reliance, unless the DM-inclusive read is the actual intent (as it correctly is in `js/dm.js`'s
  `getRoster()`).
- **Status:** IN FORCE. Verified: a direct SQL query against the live production DB confirmed the
  four rows' distinct `owner_id`/`auth.users.email` before the fix (root-causing the report, not
  guessing); headless Playwright confirmed both tools' `window._syncBridge` now exposes
  `listMyCharacters` and no longer exposes `listCharacters`, with no page errors on load;
  `grep -rn "\blistCharacters\b"` repo-wide returns zero remaining references outside
  `listMyCharacters`; `node --check` on every extracted classic and module `<script>` block in all
  three tools; `engine-parity-ci.mjs` 20/0; `random-manual-e2e.mjs` 4/4 (no `js/engine.js` change in
  this record).
