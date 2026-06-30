# PACT — Changelog

> One line per change, **newest first**. `DATA.version` is noted only when it changed.
> This is the scannable, going-forward log; the full pre-GitHub history is in
> `docs/history/CHANGELOG-full.md`. *Why* lives in `DECISIONS.md`; the messy middle in `docs/sessions/`.

- **2026-07-01 · chore — CU-3: tidy repo root and test files** (`index.old.html` + `.tmp-verify.mjs` deleted; `campaign-test.html` + `sync-test.html` moved to `testing/` with relative paths updated to `../js/` and `../login.html`; `testing/README.md` replaced stray repo description with a proper harness index). Closes REV-09. No engine/logic change; parity unaffected.

- **2026-06-30 · fix — REV-04: close campaign-join bypass in RLS** (`sql/rls-policies.sql`, `sql/migrations/2026-06-30-rev04-campaign-rls.sql`; no engine/logic change; parity unaffected). Removed `campaign_id` from the player column-level UPDATE grant — `join_campaign()` (SECURITY DEFINER) is now the sole writer. Also tightened the INSERT policy with `AND campaign_id IS NULL` so a player cannot insert a character pre-joined to an arbitrary campaign; `join_campaign()` bypasses RLS as a SECURITY DEFINER function and is unaffected. `DATA.version` unchanged.

- **2026-06-30 · fix — REV-03: service worker now uses network-first for `*.html` + `js/engine.js`** (`service-worker.js`; no engine/logic change; parity 5/0). Added `NETWORK_FIRST_RE` regex; HTML pages and `engine.js` now try the network first and fall back to cache only when offline — so a deployed rules fix reaches returning users on the very next page load without clearing storage. Icons and supporting JS files remain cache-first. `DATA.version` unchanged. (D-GH11)

- **2026-06-29 · feature — auth bar on menu: optional sign-in, no redirect gate** (`index.html`; no engine change; parity unaffected). Added a small `<script type="module">` auth block that imports `js/auth.js` and shows a "Sign in" button when signed out or "Signed in as X · Log out" when signed in. Every page (menu + tools) is open to everyone — no redirect gate. Cloud save/sync activates only when a session exists.

- **2026-06-30 · fix — REV-02: service worker now skips caching for cross-origin requests** (`service-worker.js`; no engine/logic change; parity 5/0). Added an origin guard (`url.origin !== self.location.origin → return`) to the fetch handler so Supabase API calls, esm.sh CDN responses, and any other cross-origin GETs are never intercepted or cached. Previously the handler claimed same-origin filtering in a comment but had no actual check, causing stale API responses and potential cross-user data to accumulate in Cache Storage. `DATA.version` unchanged.

- **2026-06-30 · fix — REV-01: regression gate now asserts real values** (`testing/tests/engine-parity.html`, `testing/expected/expected-results.csv`; no engine/logic change). Rewrote the parity runner so each test compares `compute()` / `rebuildStateFromEvents()` output against a confirmed baseline in `expected-results.csv` — previously `pass` was hard-coded `true` and all CSV columns were blank. Added two modes: "Capture baseline" (dumps CSV rows from live engine output for human review) and "Run tests (assert)" (fetches the CSV and fails if any actual differs from expected). CG-003 additionally asserts `remaining < 0` and that the first warning starts with "OVER BUDGET". LS-001/EV-001 assert `.ok`, `.total`, and `.eventsApplied`. Baseline captured and confirmed at engine v0.332: CG-001 (2 AP / 0 warn), CG-002 (50 AP / 0 warn), CG-003 (67 AP / 1 warn / over by 17), LS-001 (78 AP / 1 warn / 28 events), EV-001 (68 AP / 0 warn / 7 events). Gate now reports a real FAILED test when engine output changes. `DATA.version` unchanged.
- **2026-06-30 · docs — CU-5: fix duplicate D-GH7 in DECISIONS.md** (`DECISIONS.md`, `docs/sessions/2026-06-29-header-redesign-mobile-pin-pwa-task1.md`; no code change; parity unaffected). Renamed the older "PWA SW registration" entry from `D-GH7` to `D-GH8`; updated the two session-file backreferences. The campaign-play entry (`D-GH7 · Campaign play: dual-source AP…`) and all its callers (`js/campaign.js`, `sql/schema.sql`, migration, `CHANGELOG.md`) remain unchanged. Every `D-GH#` is now unique.

- **2026-06-30 · fix — Task 5 hardening: SW pre-cache, offline login, update flow, maskable icon, preconnect** (`service-worker.js`, `login.html`, `manifest.json`, `index.html`; no engine/logic change; parity 5/0). Added `login.html` + five JS modules (`auth`, `sync`, `campaign`, `dm`, `supabase-client`) to `PRE_CACHE` so tool pages work offline from a cold install; bumped `CACHE_NAME` to `pact-v2`. Removed unconditional `self.skipWaiting()` from the SW install handler so the update-notification UI (already wired in `index.html`) can fire correctly — SW now only skips waiting when the client posts the message. Added SW registration + update handler to `login.html` (was the one page missing it — hard FAIL in audit). Added `"purpose":"maskable"` to the 512-px manifest icon (Android adaptive-icon fix). Added `<link rel="preconnect">` for `esm.sh` and the Supabase origin in `index.html`. `DATA.version` unchanged.

- **2026-06-30 · feature — dual-source AP budget: `compute(b, opts)` and `rebuildStateFromEvents(base, events, opts)` now accept `{ dmAp, ignorePlayerAp }`** (`js/engine.js`; engine-parity **5/0**). When `dmAp` is provided it is added to the player-log AP (or replaces it when `ignorePlayerAp: true`). Returns `budget` (spendable total), `playerAp`, `dmAp`, and `spendable`; `remaining` and `status` reflect the adjusted budget. Fully backward-compatible — callers with no opts see identical output. `DATA.version` unchanged.
- **2026-06-30 · feature — Live Sheet dual-source AP: cloud-loaded characters now blend DM-granted AP into the budget** (`tools/PACT-Live-Char-Sheet.html`, `js/sync.js`; no engine/DATA change; parity 5/0). When a character is loaded from the ☁ Cloud menu, `rec.ap` (DM-granted, server-authoritative) is stored as `window._dmAp`; if the character belongs to a campaign with `ignore_player_ap: true`, only DM AP counts toward the spendable budget. `render()` and `refreshBuy()` now adjust `b.budget = (ignorePlayerAp ? 0 : eco.earned) + dmAp` before calling `compute()`, so `r.remaining` (AP left), the buy-panel affordability checks, and the "OVER BUDGET" warning all reflect the correct figure. The ecoline bar gains a `· X from DM` chip when dmAp > 0 (with an "Y player AP ignored" prefix when the campaign flag is set). `sync.js` reconcile and listCharacters selects now include `campaign_id` so the load handler can look up `ignore_player_ap` via `listMyCampaigns()`. `DATA.version` unchanged.

- **2026-06-30 · feature — Task 4 UI: campaign roster + cloud save in DM Console and Live Sheet** (`tools/DM Console.html`, `tools/PACT-Live-Char-Sheet.html`; no engine/logic change). **DM Console**: added module bridge importing `auth.js`/`campaign.js`/`dm.js`; new "Campaign (cloud)" panel in the bottom toolbar (auth status, campaign selector, player/DM invite codes with copy, ignore-player-AP toggle); new "Campaign Roster" section above the card grid (live roster from Supabase with DM-AP column, per-character Award AP form with note, 📒 history modal showing amount/DM/note/date). **Live Sheet**: added module bridge importing `auth.js`/`sync.js` + `initSync()`; new ☁ Cloud button in the top bar (next to Sheet) — dropdown shows auth status, Save to cloud (saves `{LOG,SEQ,rules}` blob via `saveCharacter()`), and a list of the user's saved livesheet characters to load from cloud (sets `LOG`/`SEQ`/`loadedRules` globals and calls `save()`+`render()`). `DATA.version` unchanged.

- **2026-06-30 · feature — landing page redesign to match the Player's Guide** (engine untouched — parity unaffected; `index.html`, `docs/PACT-Players-Guide.html`, new `pact-cover.jpg`). Rebuilt `index.html` in the guide's parchment "tome" style on shared CSS tokens (`--ink/--accent/--rule/--head`). Added a subtle theme picker (Parchment/Midnight/Dragonfire/High contrast) with an **"Auto · match device"** default that follows `prefers-color-scheme` and persists to one `localStorage` key (`pact-theme`); added link-preview metadata (Open Graph/Twitter, image → absolute Pages URL `https://chompy78.github.io/PACT/pact-cover.jpg`), an inline SVG favicon, `theme-color`, focus-visible + reduced-motion a11y (AA contrast verified), wayfinding ("Start here", For-players/For-DMs grouping with icons), a PWA install button (`beforeinstallprompt`), and an offline badge. Removed the dev-only Engine Parity Tests card and the `js/engine.js` masthead jargon. **Externalized the cover image** to a shared `pact-cover.jpg`: landing page references `pact-cover.jpg`, the guide now references `../pact-cover.jpg` (index ~420 KB → ~23 KB; guide ~1.06 MB → ~656 KB). No tool pages, engine, or save data changed; all links/wiring preserved 1:1. Verified in-browser: cover loads, 3 cards + hero render, theme switch + Auto-revert work, zero console errors. `DATA.version` unchanged.
- **2026-06-29 · data — tools refreshed to the corrected v0.332 DATA** (`tools/*.html`; no engine/logic change). Replaced each tool's embedded `const DATA={…}` block with the audited v0.332 dataset (now md5-identical across CharGen / Live Sheet / DM Console **and** `engine.js`). CharGen's static version labels (title + header) bumped v0.322→v0.332; Live Sheet & DM Console already render `DATA.version` dynamically. Browser-verified all three: load with no console errors, `compute()` prices on the new ladders (1st Expertise **5 AP**, 20 Focus **110 AP**), Barbarian "Path of the World Tree", Dragonborn "Draconic flight" sticker 9; 318 features / 33 invocations; pages display v0.332. (Tools still embed their own DATA+compute — Option B import refactor remains a later task.) `DATA.version` **v0.332**.

- **2026-06-29 · fix — correct the v0.332 engine DATA (PR #23 shipped an incomplete build)** (`js/engine.js`; engine-parity **5/0**). PR #23 merged the divergent `Downloads` export: only **106 of 318** `features`, **0 of 33** Eldritch Invocations, and missing the Dragonborn "Draconic flight" reprice (handoff change #4). Replaced `DATA` with the audited **handoff v0.332** dataset while keeping the repo's ES-module code byte-for-byte unchanged (no `compute()`/logic change). Now: 318 features, 33 invocations, Draconic flight T4 Situational (origin 9 / cross 13), expertise N+4 ladder, Focus Gentle ladder, Barbarian "Path of the World Tree". Verified against the handoff's 6-point checklist (all PASS) and DATA byte-identical to the handoff build. `DATA.version` stays **v0.332**.

- **2026-06-29 · data — engine rules data refresh, `DATA.version` v0.322 → v0.332** (`js/engine.js`). Dropped-in an externally-updated `engine.js` — **data-only**: the `DATA` object changed (new features + revised AP costs) while every function and export is byte-for-byte identical (verified via diff). Parity test still **5/0** on all fixtures at v0.332. *(Superseded — the dropped-in file was an incomplete export; corrected by the entry above.)*

- **2026-06-29 · feature — campaign-play backend: co-DMs, AP award ledger, ignore-player-AP** (`sql/schema.sql`, `sql/rls-policies.sql`, new `sql/migrations/2026-06-29-codm-ap-ledger.sql`; no engine/tool changes). New `campaign_dms` table (multiple DMs per campaign; owner auto-added; join via new `dm_invite_code`/`join_as_dm` or owner `promote_to_dm`/`remove_dm`). New `ap_awards` ledger — `award_ap(char, amount, note)` now records who/when/how much and bumps the running `characters.ap`. New `campaigns.ignore_player_ap` toggle for the dual-source AP model. `is_campaign_dm()` now checks membership; RLS + grants updated for both new tables. Run the migration on existing DBs. See `DECISIONS.md` D-GH7.

- **2026-06-29 · feature — Task 1 complete: SW registration added to `tools/*.html`** (engine untouched — parity unaffected; `tools/*.html` only). Added the shared service-worker registration block + `<link rel="manifest" href="/PACT/manifest.json">` to all three tool pages (CharGen, Live Sheet, DM Console), using absolute `/PACT/` paths, with an in-page "new version ready / Reload" bar on `updatefound`. Finishes the SW snippet deferred from the PWA-shell entry below.

- **2026-06-29 · fix — Mobile CharGen header now stays pinned** (engine untouched; `tools/PACT-CharGen-Webtool.html`). On mobile (≤768px) the page switched to an app-shell: `body` is a flex column at `100dvh; overflow:hidden`, the header is a static `flex:0 0 auto` bar, and `.layout` becomes the scroll area (`flex:1; overflow-y:auto`). Fixes the header scrolling off on real mobile Chrome (a compositor repaint issue that `fixed`/`sticky` + GPU hints couldn't solve). Desktop keeps `position:sticky` + window scroll; "Jump to section" uses `scrollIntoView` on the inner area. See D-GH5.

- **2026-06-29 · chore — Version bump + header polish** (engine untouched; all three `tools/*.html`). CharGen & Live Sheet build → **v0.107**; DM Console `TOOL_VERSION` → **v0.015**. Header now surfaces both the Web Tool build (v0.107) and the PACT rules version (`DATA.version` v0.322, unchanged) and shows a ⚠ warning icon beside the AP total on row 1. Removed the now-unused `.topbar` CSS from CharGen. `DATA.version` unchanged. See D-GH6.

- **2026-06-29 · feature — Task 1: PWA shell** (engine-parity 5/5; new files only). Added `manifest.json` (standalone, scope+start_url `/PACT/`), `service-worker.js` (cache-first, pre-caches all tool pages + engine, skips icon failures gracefully, "reload to update" banner), `404.html` (GitHub Pages SPA redirect), placeholder icons 192/512/180 in `icons/`. SW registration + manifest link added to `index.html`. SW snippet for `tools/*.html` deferred — prompt provided separately.

## How to add an entry
Add at the TOP. Format:
`- **<date> · <type> — <headline>** (<proof: tests pass, files touched>). <what changed, condensed>.`
`<type>` ∈ `feature · rule · fix · data · UI · tooling · docs`. Note `DATA.version` only if it changed.

---

- **2026-06-29 · fix — rename XP → AP across the cloud backend** (`js/sync.js`, `js/dm.js`, harnesses; SQL + docs renamed on the data-model branch). PACT's DM-awarded currency is **AP**, not XP: `characters.xp` → `characters.ap`, `award_xp()` → `award_ap()`, and every client reference. Live DBs need the one-off `alter table … rename column xp to ap;` + function recreate.

- **2026-06-29 · feature — Task 4 (partial): campaigns + DM AP logic** (new files `js/campaign.js`, `js/dm.js`, `campaign-test.html`; no engine/tool changes). `campaign.js`: create campaign (auto invite code), join via `join_campaign()` RPC, regenerate code (DM-only), list campaigns tagged by per-campaign role. `dm.js`: read roster (player name + character + ap), award/deduct ap via `award_ap()` RPC, read raw stats for inspection. `campaign-test.html` exercises create/join/regen/roster/award end-to-end. DM Console UI wiring deferred until tool HTML edits settle.

- **2026-06-29 · feature — Task 3 (partial): cloud save + offline sync** (new files `js/sync.js`, `sync-test.html`; no engine/tool changes). Supabase-primary, localStorage-fallback character persistence: save/load/list/delete, last-write-wins by `updated_at`, dirty-flag retry on reconnect, `initSync()` auto-reconciles on load + the `online` event. Only raw `stats` is stored; `ap` is never pushed from local and is overwritten from the server on pull. `sync-test.html` harness verifies it end-to-end.

- **2026-06-29 · feature — Task 2 (partial): standalone login screen** (new file `login.html`; no engine/tool changes). Self-contained sign-in / register / forgot-password page wired to `js/auth.js`, themed to match `index.html`. Lets auth be tested end-to-end before the per-page auth gate is wired in.

- **2026-06-29 · feature — Task 2 (partial): Supabase client + auth helpers** (new files `js/supabase-client.js`, `js/auth.js`; no HTML/engine changes; engine-parity unaffected). Single shared Supabase client (publishable key, RLS-protected; supabase-js loaded from CDN, no build step). Pure-logic auth module: register/login/logout, forgot + update password, current user/session, auth-change subscription, profile fetch. No global role read (roles are per-campaign, D-GH4). Login UI + HTML wiring deferred to the next step.

- **2026-06-29 · UI — CharGen: header fully redesigned with 4-row desktop layout (Row 1: name+AP+warn icon; Row 2: title+versions+timestamp; Row 3: all action buttons, wraps; Row 4: section nav) and 2-row mobile layout (Row 1: name+AP; Row 2: Random+Reset+section jump). New 768px breakpoint for header only; existing 600px breakpoint unchanged. `DATA.version` unchanged.**

- **2026-06-28 · UI — Both tools: "Last edited" timestamp now reads from document.lastModified (HTTP header set by GitHub Pages from the commit date) instead of a hardcoded string. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — CharGen: AP indicator is now the sticky mini-header (#mtop): character name on left, "X / Y AP" pill on right. Removed #apFloat floating pill (not wanted in CharGen) and #chip (topbar duplicate). UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — CharGen: removed mobile bottom AP bar (#mobar); replaced with a floating pill (#apFloat, top-right) identical to the Live Sheet — shows remaining AP, flashes on change, turns red when over budget. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet mobile improvements: header buttons become icon-only (text labels hidden), version/last-edited metadata hidden; DM toolbar scrolls horizontally; category headers get larger tap targets; bottom bar gets thumb-reachable Undo/Redo buttons alongside AP display. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet buy panel — renamed 'Expertise' group to 'Skill expertise'. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet buy panel — moved 'Tools & instruments' and 'Tool expertise' to sit directly after 'Expertise' (before 'Languages') in the Proficiencies group. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet buy panel — boons and drawbacks now grouped by category (matching CharGen); boons show their effect description like drawbacks; AP moved inline next to the item name to save vertical space. UI-only; `DATA.version` unchanged.**

- **2026-06-28 · UI — Live Sheet buy panel — moved weapon masteries from the 'Languages & masteries' group into 'Weapons & armour'; renamed the languages group to 'Languages'. UI-only; `DATA.version` unchanged.**

- **2026-06-29 · fix — suppress zero-cost non-purchase entries in CharGen→Live Sheet exports** (`DATA.version`
  stayed **v0.322**; exporter-only fix). The export log now skips non-purchase setup entries like
  innate-spell defaults and character-size state, so the Live Sheet no longer shows them as if they were
  bought purchases.

- **2026-06-29 · fix — make CharGen→Live Sheet export create a file again** (`DATA.version`
  stayed **v0.322**; exporter-only fix). The Live Sheet export button now completes its save/download
  path successfully by avoiding a broken mutator reference during event-log generation, so CharGen can
  produce a downloadable Live-Sheet JSON file again.

- **2026-06-29 · fix — make CharGen→Live Sheet export emit native per-item events** (`DATA.version`
  stayed **v0.322**; `compute()` unchanged; exporter-only change). CharGen export now emits discrete
  native buy events for boons, drawbacks, skills, saves, expertise, tools, masteries, racial traits,
  arts, features, subclasses, and other itemized purchases so imported characters behave like native
  Live-Sheet buys, including drawback buy-off and per-line ledger entries.

- **2026-06-28 · data — apply PHB page numbers and drawback text updates to `js/engine.js`** (`DATA.version`
  stayed **v0.322**; `compute()` unchanged; display-only data only). Added `page: 214` to the 8 weapon
  masteries, added PHB `page` values to the 41 listed arts/techniques, and replaced the 10 listed
  `drawbackFx` strings with the fuller Players Guide wording. Verified `testing/tests/engine-parity.html`
  reports **5 passed / 0 failed**.

- **2026-06-28 · data — fill PHB page numbers + sync drawback text into `js/engine.js`** (`DATA.version`
  stays **v0.322** — display data only, `compute()` unchanged; engine-parity unaffected). Weapon-mastery
  PHB pages → `DATA.masteryFx[*].page` = **214** (all 8). Arts & Techniques pages → `page` added to **41 of
  43** `DATA.arts[*]` (matched to the PHB feat list; *Blessed Warrior* + *Druidic Warrior* have no PHB feat
  entry, left page-less). Drawback descriptions reconciled against the **Players Guide v0.324**: 53 already
  identical, **10 synced** to the guide's fuller wording (added DEX/WIS "cap" clauses — already enforced by
  `DATA.drawbackMaxStats`, so display-only). Land it via `docs/ENGINE-DATA-UPDATE.md`. See `DECISIONS.md` D-014.

<!-- Full pre-GitHub history (the v0.x build series, 119 condensed lines): docs/history/CHANGELOG-full.md -->
