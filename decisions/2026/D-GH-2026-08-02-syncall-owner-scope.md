# D-GH-2026-08-02-syncall-owner-scope — `syncAll()` now scopes its select to the signed-in user's own characters

Status: Active

- **Context:** Follow-up to a finding flagged (not fixed) in `D-GH-2026-08-02-dm-readonly-livesheet-
  view`: `js/sync.js`'s `syncAll()` — the background job `initSync()` runs automatically on every
  signed-in, online page load, not on any user action — decided which characters to reconcile via a
  bare `supabase.from('characters').select('id')` with **no owner filter at all**. `characters_select`'s
  RLS policy is `owner_id = auth.uid() OR is_campaign_dm(campaign_id)` (needed elsewhere, e.g. DM
  Console's roster), so for a DM this bare select returns every character in every campaign they run,
  not just their own. `syncAll()` then calls `reconcile()` (which caches via `lsSet`, `dirty:false`)
  for the union of that list and whatever's already known locally — meaning a DM's browser was already
  routinely caching a local copy of every one of their players' characters, purely as a side effect of
  loading any page while signed in.
  - This was already *harmless in practice*: `listMyCharacters()`'s `dirty === true` requirement
    (`D-GH-2026-08-02-listmycharacters-local-cache-leak`) filters out exactly these `dirty:false`
    entries, so none of it was resurfacing anywhere. But that safety came entirely from a downstream
    check with a different, narrower purpose (distinguishing genuine unsynced drafts from read-only
    caches) — not from the fetch itself being correctly scoped. `syncAll()`'s own stated purpose ("keep
    my characters in sync") never needed DM-visible characters in the first place.
- **Options considered:** essentially none — unlike the read-only-view feature (which had a real
  reuse-vs-build-new tradeoff), there's no legitimate use for `syncAll()` seeing characters it doesn't
  own. DM Console's own roster display already gets player data through a separate, purpose-built path
  (`js/dm.js`'s `getRoster()`, which explicitly needs and is meant to have that broader visibility).
  Scoping `syncAll()` to `owner_id = auth.uid()` closes the unnecessary access at its source rather than
  continuing to rely solely on the downstream `dirty` check.
- **Decision / what shipped:** `js/sync.js`'s `syncAll()` now captures `const user = await
  currentUser()` up front and adds `.eq('owner_id', user.id)` to its `select('id')` query — the same
  pattern `listMyCharacters()` already uses, applied to the one remaining unscoped query of this shape
  in the file (`peekCharacter()`/`reconcile()` fetch a single already-known id and don't enumerate
  broadly, so they weren't candidates for this same fix).
- **Why:** makes the background sync job correct by construction instead of relying on an unrelated
  downstream filter to catch its overreach after the fact. If `listMyCharacters()`'s `dirty` check were
  ever weakened, refactored, or bypassed by a future change, this would have silently become a real,
  user-visible leak again with no test or review signal pointing at `syncAll()` itself — the fetch was
  wrong regardless of whether anything downstream happened to catch it. Worth its own record (not
  folded into the read-only-view PR) since it's a genuinely separate root cause, found while building
  that feature but not caused by it.
- **Status:** IN FORCE. Verified via headless Playwright against the real `syncAll()` (module bridges
  stubbed at `js/auth.js`/`js/supabase-client.js` import boundaries): a stub simulating real RLS
  behavior (a bare `select('id')` returns both the signed-in user's own character AND a different
  owner's character; an owner-scoped query returns only the former) confirmed `syncAll()` now only
  attempts to reconcile the signed-in user's own character — the other owner's id is never even looked
  up. `testing/scripts/audit.py` and `engine-parity-ci.mjs` both green (no `js/engine.js` change);
  `random-manual-e2e.mjs` 3/3 (no behavior change to normal single-user CharGen/Live Sheet flows, which
  never had characters outside their own to begin with).
