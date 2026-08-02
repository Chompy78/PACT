# D-GH-2026-08-02-listmycharacters-local-cache-leak — `listMyCharacters()`'s local-storage merge trusted any cached character as "mine"

Status: Active

- **Context:** Live follow-up report after `D-GH-2026-08-01-dm-console-listcharacters-leak` (the
  server-side `listCharacters()` owner-filter fix) had already shipped: the reporting user (a DM)
  still saw 4 characters on `tools/characters.html`'s "My Characters" page, when they should see only
  their own. Confirmed via direct SQL against the production DB that the 4 rows genuinely belong to 4
  different Google accounts (`jrc.chow@gmail.com` — the reporting DM — plus 3 real players) in a
  campaign named "Amble" the DM runs. `characters.html` already used the correctly-scoped
  `listMyCharacters()` (`.eq('owner_id', user.id)`) — confirmed by reading the live `js/sync.js` on
  `main` directly, not assumed — so the server query itself was not at fault this time.
  - Root cause: `listMyCharacters()`'s online path merges the server-scoped result with anything in
    the browser's own `localStorage` not already in that result set ("not-yet-pushed local
    characters" — a legitimate need, so offline edits still show up before they sync). That merge had
    **no ownership check at all** — it trusted any cached-by-id local record as "mine." Separately,
    `loadCharacter()`/`reconcile()` caches *any* character it can fetch by id (via `lsSet()`) with
    **also no ownership check** — by design, since DM Console and other campaign-role reads
    legitimately need to fetch characters this device's signed-in user doesn't own. `lsGet`/`lsSet`/
    `lsIndex` (confirmed by reading their definitions) are plain `localStorage` keyed only by
    character id — not scoped per signed-in account at all.
  - Combined effect: once *any* character was ever fetched on a given browser/device — most likely
    here, the reporting DM clicking one of the 4 wrongly-shown rows to investigate the *original*
    server-side leak before it was fixed — `loadCharacter()` cached it locally with `dirty: false`,
    and `listMyCharacters()`'s merge kept re-surfacing it as "mine" forever after, on that device,
    regardless of which account was signed in and regardless of the server-side fix already having
    shipped. The original fix closed the leak's *source*; this is why its *effects* persisted.
- **Options considered:**
  - **Check `owner_id` on the cached record** — rejected: neither `saveCharacter()`'s local draft
    record nor `reconcile()`'s cached server read ever stores `owner_id` locally (confirmed by reading
    both — `reconcile()`'s own `select()` doesn't even fetch that column), so there's no reliable
    per-record ownership signal to check.
  - **Filter the local-only merge to `dirty === true`, chosen.** `dirty: true` is set *only* by this
    device's own `saveCharacter()` calls (a genuine "created/edited here, not yet pushed" draft) and
    cleared to `false` the moment a push succeeds (`applyServerMeta()`) or a server read is cached
    (`reconcile()`'s `lsSet({...server, dirty:false})`). A `dirty:false` local entry absent from the
    current server-scoped list is, by construction, either stale or not owned by the signed-in
    user — never a legitimate "mine, pending sync" case either way.
  - **Leave the offline fallback path unchanged** — deliberate: when genuinely offline there's no
    server list to reconcile against at all, so the existing "show whatever's cached" behavior is the
    documented, accepted tradeoff for that mode, not the bug being fixed here.
- **Decision / what shipped:** `js/sync.js`'s `listMyCharacters()` local-merge line changed from
  `lsIndex().map(lsGet).filter(r => r && !serverIds.has(r.id))` to
  `lsIndex().map(lsGet).filter(r => r && r.dirty && !serverIds.has(r.id))`. Also fixed a stale doc
  comment on `archiveCharacter()` still referencing the deleted `listCharacters()`.
- **Why:** this is the second half of the same trust-boundary class as the prior record — that one
  fixed the *server* query, this fixes the *client* cache that let the server-side bug's effects
  outlive the fix. A future agent touching `sync.js`'s local-storage merge logic should know
  `dirty` is the only field that actually distinguishes "genuinely mine, unsynced" from "cached here
  for some other legitimate reason" — anything read via `loadCharacter()`/`reconcile()` for a
  character this device doesn't own is real, by-design behavior (DM/campaign-role reads), not a bug
  to prevent at the fetch layer; the leak is only in blindly re-surfacing that cache as "my characters"
  later.
- **Status:** IN FORCE. Verified via a headless-Playwright unit test against the real `js/sync.js`
  with `js/auth.js`/`js/supabase-client.js` stubbed at import time: seeded `localStorage` with one
  genuine unsynced draft (`dirty:true`) and one foreign read-only cache (`dirty:false`), called the
  real `listMyCharacters()` — confirmed the server-owned character and the genuine draft both appear,
  the foreign cached entry does not. `testing/scripts/audit.py` and `engine-parity-ci.mjs` both green
  (no `js/engine.js` change).
