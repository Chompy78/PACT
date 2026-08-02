# D-GH-2026-08-02-dm-readonly-livesheet-view — DM Console gets a read-only "View in Live Sheet" for a player's character

Status: Active

- **Context:** The DM asked for an easy way to see a player's character in full detail, ideally opened
  in a new browser tab/window from DM Console's roster card. DM Console's own card already shows a
  computed summary (HP/AC/skills/etc.), but the ask was specifically for the full Live Sheet view.
  - Investigated whether Live Sheet's existing `?cloudChar=<id>` deep link (used by `characters.html`'s
    "Open in Live Sheet") could just be reused. Ruled out: it calls `loadCharacter()`, which makes the
    loaded character the tab's *active, editable* one and calls `save()` immediately. Two concrete
    risks if a DM used it to "view" a character they don't own: (1) `save()` writes to a single,
    *shared-across-tabs* `localStorage['pactLiveSheet']` slot — any click that triggers it in a
    view-only tab would silently clobber whatever the DM's own in-progress character was in another
    tab of the same browser; (2) if the DM then clicked "☁ Save to cloud",
    `S.saveCharacter({id: <foreign id>, ...})` would cache a `dirty:true` local entry under that
    foreign character's id, which `listMyCharacters()`'s local-draft merge (see
    `D-GH-2026-08-02-listmycharacters-local-cache-leak`) treats as proof of ownership — resurfacing
    someone else's character on the DM's own "My Characters," a new trigger for the exact leak class
    that fix closed.
  - Explored via a research agent whether a genuine read-only mode was cheap to build. Findings: every
    LOG mutation in Live Sheet already funnels through one function, `emit()`; `undo()`/`redo()` bypass
    `emit()` but still call `save()` directly — so guarding those two functions blocks all mutation
    paths, present and future, as long as new features keep following the existing pattern (which the
    whole tool is built on). `peekCharacter()` (already used elsewhere in this file) returns everything
    the render path needs and — per its own docstring — never touches `localStorage` at all.
- **Decision / what shipped:**
  - `tools/PACT-Live-Char-Sheet.html`: new module-level `VIEW_ONLY` flag (declared beside `viewAt`).
    `emit()`, `save()`, `undo()`, `redo()` each check it first and no-op (with a flash message) if set —
    this is the actual safety mechanism, not the UI hiding below. `buildBuyPanel()`'s existing
    `head`-gated "viewing history" message is extended to also fire when `VIEW_ONLY`. A new
    `?viewChar=<id>` deep link fetches via `S.peekCharacter(id)` (never `loadCharacter()`), sets
    `VIEW_ONLY=true` before ever touching `LOG`/`__charId`, skips calling `save()` entirely, hides the
    controls that would otherwise look interactive (Undo, Redo, Import, "Open in CharGen", the ☁ Cloud
    button, the whole DM-tools bar), and shows a persistent banner naming whose character is being
    viewed.
  - `tools/DM-Console.html`: `dmToolsBody()` gets a new "👁 View in Live Sheet ↗" button per cloud
    roster card, wired into the existing delegated click handler; opens
    `PACT-Live-Char-Sheet.html?viewChar=<id>` via `window.open(url, '_blank')` (DM Console's first use
    of `window.open` — no prior pattern there to extend).
  - Also guarded `refreshCloudCampaignRules()` (an existing boot-time function, unrelated to this
    feature, that resolves the *currently active* character's campaign rules) with the same `VIEW_ONLY`
    check — it independently calls the caching `loadCharacter()` using `currentCharId()`, and while
    investigation found no actual reachable race once `VIEW_ONLY`/`__charId` are set atomically in the
    same synchronous callback, guarding it removes any theoretical doubt for free.
- **Separate finding, not fixed here — flagged for awareness:** while verifying this feature with a
  headless Playwright test, the foreign test character got cached locally via a *different*,
  pre-existing path: `js/sync.js`'s `syncAll()` (wired up by `initSync()`, which runs on every signed-in
  page load) queries `characters_select('id')` with **no owner filter at all** — it relies entirely on
  RLS, which for a DM includes every character in every campaign they run (the same `is_campaign_dm()`
  clause documented in `D-GH-2026-08-01-dm-console-listcharacters-leak`) — then calls `reconcile()`
  (caches via `lsSet`) for the union of that list and whatever's already known locally. In other words:
  **any DM's browser already locally caches every one of their players' characters, as routine
  background behavior, regardless of this feature.** Confirmed this is currently safe only because of
  `listMyCharacters()`'s `dirty === true` filter (`D-GH-2026-08-02-listmycharacters-local-cache-leak`;
  `syncAll()`'s cached entries are `dirty:false`) — that single check is the only thing standing
  between this broad, unfiltered local cache and it resurfacing in "My Characters" again. Worth a
  defense-in-depth follow-up (e.g. scoping `syncAll()`'s own select to `owner_id = auth.uid()`, or
  something that doesn't rely on a single downstream filter as the sole safety net) — not fixed in this
  change since it's a pre-existing, separately-scoped concern, not something this feature introduces.
- **Why:** worth a full record because the "guard the choke points, not every button" design choice
  and the `peekCharacter()`-over-`loadCharacter()` choice are both non-obvious given how easy it would
  have been to just reuse the existing `?cloudChar=` deep link — a future agent extending this view (or
  adding a similar read-only view elsewhere) should understand why that reuse was rejected and what
  makes the chosen approach durable against future Live Sheet changes without needing to be revisited
  every time a new mutating control is added.
- **Status:** IN FORCE. Verified via headless Playwright against the real code (module bridges stubbed
  at `js/auth.js`/`js/supabase-client.js` import boundaries, matching this session's established
  verification pattern): `VIEW_ONLY` becomes true and the banner renders correctly; calling
  `undo()`/`redo()`/`emit()`/`save()` directly leaves `LOG` unchanged; Undo/Redo/Import/"Open in
  CharGen"/☁-Cloud/DM-tools-bar are all confirmed hidden; the buy panel shows the read-only message; the
  `syncAll()`-cached foreign entry is confirmed `dirty:false` (safely excluded downstream). `testing/
  scripts/audit.py` and `engine-parity-ci.mjs` both green; `random-manual-e2e.mjs` 3/3 (no `js/engine.js`
  change; normal CharGen/Live Sheet flows unaffected).
