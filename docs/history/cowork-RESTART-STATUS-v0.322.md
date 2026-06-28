# PACT — v0.322 Restart Status (READ FIRST)

> **Build v0.106 · `DATA.version` v0.322 — SHIPPED.** Tool files: `PACT-CharGen-Webtool-v0.106.html` +
> `PACT-Live-Char-Sheet-v0.106.html` (+ 1 unified DM console). Green: **build-check OK, 46 gates**, guide-reconcile
> `--strict` 0 drift vs the v0.322 guide. When a number here disagrees with the tools, the tools win
> (`node tests/audit-all.cjs`).
>
> ## Since v0.322 ship — tooling (no engine/rules change; `DATA.version` stays v0.322)
> **Read `INDEX.md` FIRST.** The engine is now single-sourced in `src/engine/*.js`; edit there and run
> `node scripts/build.cjs` to re-inline into the tools (the four `.html` are byte-identical to the v0.322
> ship — Option A added no engine change). Tests are A–G coded (`audit-all.cjs … --list`); new gates:
> `build-check` (G1), `version-consistency` (G3), `changelog-gate` (G6). History split into `archive/`;
> *why* in `DECISIONS.md`; session narratives in `archive/sessions/`.
>
> ## ✅ Recently closed (nothing currently in flight)
> **Character test fixtures for GitHub** — **DONE: authored manually by John; no longer in flight.** The
> engine-generation plan in `DECISIONS.md` D-012 is closed/superseded (record kept for rationale).
> For the live open-items list, see `PACT-CONTEXT.md` §7.
>
> ## v0.322 port (engine deltas vs v0.315)
> Most of v0.316–v0.322 is guide/tooling/pregen/audit work that does NOT touch the HTML engine. The two
> real engine deltas: **Prophesied Doom +3→+4** (v0.316); **racial innate re-based to half the 3× standard
> cost = 6/9/12** (v0.319; was stale 5/10/15; cantrips stay 4). The surcharge (−1/0/+1), 4/5/7/10/14
> ability ladder, Ki steady-from-1, Sorcery bands-of-two-first-two-free, 4/6/8 slots, round-up
> spells-known, Paladin FS 13 were already in from v0.315/v0.321. Gate: `tests/v0322-changes.cjs`.
>
> ## What shipped in v0.106 (this session) — PHB pages + drawback text
> **The one open thread is CLOSED**, from John's source files (`phb-rules…jsonl` + Players-Guide v0.324 HTML).
> **Weapon-mastery pages** → `DATA.masteryFx[*].page` = **214** for all 8 (Cleave/Graze/Nick/Push/Sap/Slow/
> Topple/Vex; matched the JSONL `Equipment` "(mastery)" rows). **A&T pages** → added `page` to **41 of 43**
> `DATA.arts[*]`, matched by name to the JSONL `Feat` entries; **Blessed Warrior** + **Druidic Warrior** have
> no JSONL feat row → left page-less (no fabrication). **Drawbacks** — `drawbackFx` was already fully populated
> (69 strings); reconciled against the v0.324 guide: **53 identical, 10 synced** to the guide's fuller wording
> (the added DEX/WIS cap clauses are display-only — `drawbackMaxStats` already enforced them, so **no mechanics
> change**), and the **6 split `Affliction —` entries left as-is** (the guide stores them as one combined row).
> `_aTip` already renders "(PHB p.N)" once `page` is present — no wiring change needed. `DATA.version` stays
> **v0.322** (display data only). Build bumped **v0.105 → v0.106** per CONTEXT §6. 46 gates green; G1/G3 verify.
> **Open question for John:** want the cap clause ("… capped at 10") appended to each of the 6 `Affliction —`
> descriptions for consistency with the 10 synced rows? Say the word.
>
> ## Prior session — what shipped in v0.105
> **Unified DM console** — CardGrid + DataTable merged into one standalone file (`dm-consoles/DM Console -
> Unified-v0.015.html`; Card/Table topbar toggle, default Card; one shared engine/roster). The two
> originals were **retired** (consoles 3→1; integrity-audit M6 expects 1). **F3 swap rule** — a *free*
> cross-level known-spell upgrade pays only the difference; a *paid* one pays the full new cost
> (`_swapTally` admits UP rows with a `unit[oldL]` surcharge; gate A5). **Engine** — `compute` emits a
> Ki-unused **advisory**; **`DATA.masteryFx`** holds the 8 weapon-mastery descriptions (page now filled).
> **LiveSheet centre panel** — hover tooltips, page-ready segments (`_aTip` appends "(PHB p.N)").
> Parked/polish: `PACT-CONTEXT.md` §7 (Bonds stage 2, fighting-style polish, design-polish).
>
> ## ⚠ Environment note (important)
> The sync-backed workspace mount threw **I/O errors on the large CharGen HTML** (reads OK; rename/write
> fail). **Work in a LOCAL dir** — extract the tar to `/tmp/pact-hb` and run gates there — then deliver to
> the synced `output/`. The durable copy is always the sealed tar.

---

*(Earlier v0.315 / v0.314 restart-status sections moved to `archive/RESTART-STATUS-history.md` — history, do not act on.)*
