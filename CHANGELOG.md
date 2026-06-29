# PACT — Changelog

> One line per change, **newest first**. `DATA.version` is noted only when it changed.
> This is the scannable, going-forward log; the full pre-GitHub history is in
> `docs/history/CHANGELOG-full.md`. *Why* lives in `DECISIONS.md`; the messy middle in `docs/sessions/`.

## How to add an entry
Add at the TOP. Format:
`- **<date> · <type> — <headline>** (<proof: tests pass, files touched>). <what changed, condensed>.`
`<type>` ∈ `feature · rule · fix · data · UI · tooling · docs`. Note `DATA.version` only if it changed.

---

- **2026-06-29 · fix — rename XP → AP in the data model** (`sql/schema.sql`, `sql/rls-policies.sql`; matches the JS rename on the backend branch). PACT's DM-awarded currency is **AP**, not XP (the plan's wording was wrong): `characters.xp` → `characters.ap`, `award_xp()` → `award_ap()`. Live DBs need the one-off migration (`alter table … rename column xp to ap;` + recreate the function).

- **2026-06-29 · feature — Task 3 (partial): SQL data model + RLS** (new files `sql/schema.sql`, `sql/rls-policies.sql`; no app/engine changes; engine-parity unaffected). Three tables (`profiles`, `campaigns`, `characters`) storing only raw `stats` (build JSON / event log) with `ap` as a separate column. Per-campaign overlapping roles (no global role flag), no player cap. ap locked via column-level GRANT + DM-only `award_ap()` RPC; joining via `join_campaign()` and `regenerate_invite_code()` SECURITY DEFINER RPCs; recursion-safe RLS via SECURITY DEFINER helpers. See `DECISIONS.md` D-GH4. NOTE: overrides the plan's "up to 5 players" cap — `docs/PWA-BUILD-PLAN.md` Task 4 still needs updating.

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
