# PACT — Changelog

> One line per change, **newest first**. `DATA.version` is noted only when it changed.
> This is the scannable, going-forward log; the full pre-GitHub history is in
> `docs/history/CHANGELOG-full.md`. *Why* lives in `DECISIONS.md`; the messy middle in `docs/sessions/`.

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
