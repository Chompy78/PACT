# PACT — v0.315 Restart Status (earlier; superseded by the v0.322 section above)

## v0.315 — DONE & VERIFIED (engine matches the v0.315 guide)
- **Spell economy:** origin Discipline discount is now **flat −1 at every tier** (was HD-scaling 1/2/3;
  guide says "never deepens"). New **un-unlocked surcharge** mirrors it per spell-economy purchase
  (Foundation/Rank/cantrips/slots/spells-known): **origin −1 / non-origin-unlocked 0 / un-unlocked +1**,
  gated on `b.unlockedClasses`. compute `baseDisc` (Tradition) + `dd` (Discipline). Gate `v0315-changes` #1–5.
- **§14 arbitrage close:** Frail/Glass Frame HP loss can't be offset by Grit/Vigor bought at creation —
  their HP is suppressed + a warning fires (compute hp2). Gate #6–7.
- **Fighting Style** arts re-costed T3 Passive 11 → **T1 Premium 12** (×12). Gates `fighting-style`,
  `combat-superiority`, `v0315-changes` #8.
- **Boons:** Sure Climber 2, Total Recall 5, Beast-Bonded HD1, Unbowed (no exhaustion), Unkillable (+exhaustion). #9.
- **Drawbacks:** Missing Limb→**Missing Arm** (DEX cap 12) **+ new Peg Leg (+4, DEX cap 12)**; One-Eyed 4,
  Hexed Luck 8, Oath 5, Prophesied Doom 3, Truename 3, Superstitious 2; + Slow Study/Wild Surge/Mana-Sick
  text. Count 68→69 (qa C2 updated). #10.
- **Live-Sheet UI fixes** (per-file, no shared/parity block): **OVER BUDGET is now soft** — `legalCheck`
  drops it so the live event-economy (`eco.available`, frozen prices) is the sole affordability gate
  (fixes "13 AP left but a 5-AP buy is blocked"; root cause = current-price total > frozen spend after
  reprices). **"Affordable only"** now hides every unaffordable buy (removed the stray `!warns.length`).
  **`award()`** rejects non-numeric AP (no NaN error). The metamagic **options** picker stays gated on owning
  the Metamagic feature, and Warlock **invocations** keep their "🔒 requires Warlock discipline" hint — but
  Sorcerer **features** themselves stay visible in the buy panel, greyed with a "needs Sorcerer discipline"
  reason (an earlier over-broad hide that made them un-findable was reverted). Stale **"Grit +5 HP" → +4**.

## v0.315 — build cut DONE
- `DATA.version` → **v0.315** and build → **v0.103** across all 4 engine files; tool files renamed
  v0.102→v0.103; first-line headers bumped; consoles re-synced to v0.315; guide snapshot regenerated to
  `guide-prices-v0.315.tsv` (SNAP updated); CONTEXT/CHANGELOG updated in lockstep.
- Suggested remaining browser spot-checks (all gate- or fuzz-verified at the logic level): over-budget buy
  succeeds when AP is available; "Affordable only" hides unaffordable tiles; award-AP rejects letters;
  metamagic rows hidden without a Sorcerer Discipline; out-of-tradition cantrip shows in the centre view.

---

# PACT — v0.314 WIP Restart Status (earlier; superseded by the v0.315 section above)

> **Build v0.102 · `DATA.version` v0.309 (HELD on purpose).** The v0.314 work below is applied and
> green but the version is NOT bumped yet — do not bump until the open items are resolved and the
> user has browser-tested. Verify ground truth with `node tests/audit-all.cjs` (28 gates) +
> `node tests/guide-reconcile.cjs` (0 drift). When a number here disagrees with the tools, the tools win.

## How to start
1. Read `PACT-CONTEXT.md` (authoritative architecture/engine), then this file for current state.
2. `node tests/audit-all.cjs` → expect **28 GATES GREEN**. `node scripts/parity.cjs` → 5 shared blocks identical.
3. The #1 rule still holds: any engine/`DATA` edit must be mirrored to **all engine files** via
   `scripts/apply-shared-edit.cjs` then re-verified with `parity.cjs`.

## Console set CHANGED (important)
- Now **2 consoles**, not 5: `dm-consoles/DM Console - CardGrid-v0.014.html` + `DM Console - DataTable-v0.014.html`
  (Dashboard / MobileAccordion / SessionTracker discarded).
- They were supplied with a stale v0.303 engine and **re-spliced** with the canonical v0.314 bundle
  (DATA + compute + MUT + foldBuild + economy + activeEvents + baseBuild). Import fold verified
  (fighting-style/metamagic/maneuver names, epic-boon ability, maneuver buys all fold correctly).
- All console globs in tooling retargeted `/^DM-Console-v\d/` → `/^DM Console - /`; integrity-audit count 5→2.

## DONE & VERIFIED (28 gates green, guide-reconcile 0 drift)
- **Stat-bonus model:** rare flat bonuses (Epic Boons +2 chosen / max 30; Primal Champion +4 STR/+4 CON)
  hit the FINAL attribute only; ability-increase AP is priced on the bought score (`abilAP` on `st`,
  bonuses on `effScore`). Gate `tests/epic-boons.cjs`.
- **12 Epic Boons** in DATA.boons + boonList (T7 Passive, flat 25 AP, hd17, `epic:true`). boons 76→88.
  Save schema: `b.epicBoonAbil` folded via `MUT.names` `eb`. Picker in Live-Sheet ✎ (LS-only by design).
- **Reprices:** Vigor → Passive sticker [5,8,11,14,17,21,25] (cap CON); Grit → Situational
  [2,4,6,9,12,15,18] + HP +5→+4; Beguiling Magic → 8/6 (3 places). Gate `tests/vigor-grit.cjs`.
- **Metamagic** → flat class-neutral Steep ladder (option N = 2N: 2/4/6/8/10/12). Gate `tests/barred-metamagic.cjs`.
- **Barring:** Additional Fighting Style + 4× class Weapon Mastery removed from `DATA.featureList`
  (kept in DATA.features for back-compat). ⚠️ SEE OPEN #2 — only half-applied.
- **Primal Champion** → T7 Passive, origin 19 / cross 32, unprotected (user override of guide's 44).
- **Fighting-style arts** → all 12 at ap:11 / tier:3 / band:3 (T3 Passive). Clears pre-existing
  deep-check2 M3b. Buyable standalone (LS Weapons & armour section; CharGen arts grid as a
  "Fighting Style" group); free when feature-granted (fightingStyleNames). Gate `tests/combat-superiority.cjs`.
- **Combat Superiority** → 3 free maneuvers + buy 4th+ on ladder 4/5/6… via `{cat:'mvbuy'}` events
  (economy charges the event; compute untouched, no double-charge). `buyManeuver()` helper + picker shows 3+bought.
- Composite/off-table protected set now **1** (Warlock: Pact of the Tome) — Beguiling & Primal un-protected.

## OPEN — RESOLVED 2026-06-27 (was: need the user)
1. **"Search all" (§7 Class Access, CharGen) "doesn't work." → FIXED.** Root cause (confirmed by user
   screenshot: typing "rage" showed Rage + Unarmored Defense + Danger Sense + Reckless Attack, i.e. the
   first 4 of `featureList` in raw order): the box was a **native `<datalist>`**, which filters by prefix
   and so ignored the mid-string keyword (every label is `"Class: name"`). Replaced with a JS substring
   autocomplete (`_featAC`, matches the name after `": "` first, then anywhere; body-appended fixed menu,
   `_pruneAC` cleans orphans). `list="featureDL"` removed from the feat2 input. CharGen-only — parity 5/5 intact.
2. **Barring half-applied → FIXED.** `buildClassPickers` now skips `BARRED_FEATURES` (the 5), so the
   quick-add-by-class dropdowns hide them too. Still kept in `DATA.features` for old-save back-compat.
3. **Ranger known vs prepared → NO CONFLICT (doc already correct).** v0.314 guide ALREADY says prepared
   (L1323 "Clerics, Druids, Paladins and Rangers get their whole list free"; L5823; L5829 "the Paladin and
   the Ranger each prepare from their full class list … swap freely"). "Known caster" lists name only
   sorcerer/bard/warlock/wizard. Engine `DATA.prepared` agrees. **Ranger = prepared is settled — do not re-raise.**
   (Status doc's old line refs 2336/879/2327 were stale, from an earlier guide revision.)

Gate `tests/barred-metamagic.cjs` extended (now 10 checks): no native datalist, `_featAC` wired,
quick-add filters BARRED_FEATURES, and the search-"rage" semantic (includes Rage, excludes the 3 non-matches).

## REMAINING before cutting v0.314
- Browser click-test (no headless coverage): **the new search-all autocomplete dropdown**, the new buy
  buttons (fighting styles, "+ Buy maneuver"), and the 2 consoles' roster/dmAnalyze UI rendering.
- Guide-text fixes (doc, not engine): Ranger wording — DONE/none needed (see #3); Primal Champion 44→19/32 — **PARKED** by user 2026-06-27 (revisit before/at build cut; not a blocker for browser testing).
- THEN cut the build: bump `DATA.version` → **v0.314** + build → **v0.103** across all engine files,
  update `PACT-CONTEXT.md` + `PACT-CHANGELOG.md` in lockstep.

## AP ledger — itemized (added 2026-06-27)
The CharGen AP ledger now lists **each item purchased** under its category, not just the category
subtotal (user: "show each item rather than surmising"). Additive `compute().itemize` map (keyed by the
aggregate label) records per-buy `[label, ap]` rows for **Class features, Species traits, Subclass
abilities, Arts & Techniques, Boons** — mirrored across all 4 engine files via `apply-shared-edit`.
`r.lines` is **unchanged** (byte-identical), so every other gate and the Live-Sheet ledger are unaffected;
only CharGen's `renderLedger` (CharGen-only) expands the items into indented sub-rows. Gate `tests/ledger-itemize.cjs` · `tests/search-autocomplete.cjs`.

## Search-all overlay bug — FIXED 2026-06-27
Picking a result re-dispatched `input`, which re-ran the filter and re-opened the autocomplete as a fixed
overlay over the form — clicks on controls beneath it were swallowed (looked like "selecting items does
nothing / AP wont update"). `pick()` now sets the value, closes the menu, and calls `render()` directly
(no event re-dispatch). Gate `tests/search-autocomplete.cjs` reproduces pick→menu-closed + one recompute.

## DM consoles — full AP Ledger view (2026-06-27)
- Both consoles now have a **📒 AP Ledger** button (next to 📊 Skill Matrix) opening an overlay with each character’s **full, itemised** AP breakdown — grouped (Core / Combat / Class & Heritage / Magic / Boons & Gold) with every purchase listed, plus total / budget. `dmAnalyze` now surfaces `lines`/`itemize`/`total`/`budget` from compute. Gate `tests/console-ledger.cjs`.
- Verified both consoles carry the full v0.314 engine (392 spells incl. Wish, slot ladder [4,6,8,…], innate 3×, itemize). integrity-audit clean.

## ROOT CAUSE of recurring "AP doesn’t update" (FIXED 2026-06-27)
- CharGen render used `_gT[t]` / `_gI[i]` (granted tools/instruments) but **never defined `_gT`/`_gI`**. The moment ANY tool or musical-instrument checkbox was ticked, the count filter ran `undefined[name]` → **TypeError → render() threw**, freezing the ledger + AP total for EVERY subsequent change (skills, class abilities, etc.) and leaving the tool unpriced. Defined `const _gT={},_gI={}` in render (compute’s grantTl/grantIn are always empty, so this matches). This very likely explains the earlier skills / class-ability “won’t update” reports too. Gate `tests/tool-render.cjs`.
- **A&T picker grouped** (Live Sheet left buy-list): 43 arts now grouped by category (Combat / Fighting Style / Magic / Utility / Social / Origin) with headers; **fighting styles moved into the A&T group** and removed from the Weapons \u0026 armour section.

## Swapper #3 — convert-the-slot (DONE 2026-06-27)
- Swapping a known spell UP to a higher level now **converts the slot**: on save, the spell is re-bucketed to the new level and `known` count events move the slot (old level -1, new level +1).
- **Cost = the level difference** (`unit[newL]-unit[oldL]`), charged automatically by compute via the count change; the discount cancels. `_swapTally` EXCLUDES level-change known rows so they are never double-billed (same-level swaps still use the free/paid Hit-Die economy). Verified headlessly: L3->L5 = +1 AP exactly. Gate `tests/swap-convert.cjs`.
- Level picker shows AP cost per level; capped at current rank; swap-icon tooltip lists what free swaps cover.
- ⚠️ NEEDS BROWSER TEST: the save→reload round-trip (does the converted spell appear in the new-level slot). Economy half is gate-verified; the DOM save/rebuild half needs a click-test.

## Live Sheet swapper polish (2026-06-27)
- Level picker options now show the per-level **AP cost** (`L5 · 3 AP`).
- Per-level spell datalists are built only up to the caster’s **current rank** (`elig.maxLv`), so the swap level picker can no longer offer a level above your rank.
- ✅ RESOLVED: convert-the-slot implemented (see Swapper #3 section). Economy gate-verified; save→reload needs browser test.

## Spell data + reliable name picker (2026-06-27)
- **15 missing spells added** to `DATA.spells` (377→392) from the PHB jsonl: Wish, Mass Heal, Simulacrum, Tsunami, Word of Recall, Vitriolic Sphere, Inflict Wounds, Wrathful Smite, Shining Smite, Melf’s Acid Arrow, Lightning Arrow, Swift Quiver, Jallarzi’s Storm of Radiance, Leomund’s Secret Chest, Tasha’s Bubbling Cauldron. Apostrophes normalised to ASCII to match existing names. Mirrored ×4; parity OK.
- **`_spellAC`** (both tools): replaces the flaky native `<datalist>` in “Name your spells” with a JS dropdown that reads the row’s level list (`_dlid`), removes the native `list` attr (no double popup), filters by substring, and closes on pick (no re-dispatch loop). Known rows show ONLY the slot level; the swap level-picker repoints `_dlid`. Gates `tests/spell-picker-ac.cjs` + updated `spell-level-picker.cjs`.
- **Refresh-after-class-ability:** the overlay fix (search-all pick no longer re-opens) IS present in the current CharGen (verified: 1 fix / 0 old re-dispatch). If the symptom persists, it is a STALE/cached file — re-download from output.

## Spell-slot + innate rebalance (2026-06-27)
- **Slot price ladder** `DATA.slotSticker` [2,4,6,9,12,15,18,21,24] → **[4,6,8,10,12,14,16,18,20]** (L1=4, +2/level). Affects EVERY caster slot buy.
- **Innate single spells** now **3× slot** (was 5×): `DATA.innate5x` → [12,18,24,30,36,42,48,54,60]. Key name `innate5x` kept (legacy) but holds 3× values; ledger label + comments say 3×.
- **Innate spells are now NON-swappable** (lock once named), alongside dabbler cantrips.
- Mirrored across all 4 engine files (apply-shared-edit); parity 5/5. Gates: `deep-check2` M7b updated to new ladder; `deep-check` L7c2 added (locks innate == 3×slot); CharGen `get("Innate spells (3×…")` lookup + UI hints updated.
- ⚠️ **GUIDE DOC TODO (not done):** `PACT-Players-Guide-v0.314.docx` still shows the OLD slot table (Standard slot cost 2/4/6/9…; Innate 5× 10/20/30…) and the L3023 text. Engine is the source of truth; the guide table needs a careful manual update to match (no gate enforces it).

## Spell naming — level-limited list + swap level picker (added 2026-06-27, Live Sheet)
Known-spell rows now show only the **slot level’s** spells (was the combined `_all` list). Cross-level change
is **swap-only**: clicking the swap button reveals a level picker (`_nameSwapLevelPicker`) that filters the list
to the chosen level. Economy unchanged per user: free Hit-Die swaps cover cantrips/arcanum/styles/etc.; a paid
known-spell swap pays the **full** new-level price (free if a Hit-Die swap covers it). CharGen was already
level-limited. Out-of-tradition (dabbler) cantrips are now NON-swappable (lock permanently once named). Gates `tests/name-lock.cjs` (updated) + `tests/spell-level-picker.cjs`.

## New test gates this WIP (wired into audit-all)
`tests/epic-boons.cjs` · `tests/vigor-grit.cjs` · `tests/barred-metamagic.cjs` · `tests/combat-superiority.cjs` · `tests/ledger-itemize.cjs` · `tests/search-autocomplete.cjs` · `tests/spell-level-picker.cjs`
(see also `PACT-v0.314-implementation-plan.md`).
