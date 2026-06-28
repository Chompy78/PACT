# SUPERSEDED — v0.313 rules-port WIP note (historical only)

> Removed from `PACT-CONTEXT.md` during the v0.322 cleanup. This described an **in-progress v0.313
> reprice** and said "DATA.version is still v0.309 ON PURPOSE." That is **no longer true** — the
> current shipped state is **build v0.104 / `DATA.version` v0.322**. Kept for history; **do not act on it.**

---

### v0.313 RULES PORT IN PROGRESS (read before editing the engine)
DATA.version is still v0.309 ON PURPOSE — the v0.313 reprice is PARTIALLY applied. Do NOT bump it until the remaining items are done + green.

DONE & green (audit-all 20/20 / parity x7 / guide-reconcile --strict 0-drift): metrics wired (tests/guide-prices-v0.313.tsv = SNAP); Fighting Style natives -> Premium (Fighter T1 12/13, Paladin/Ranger T2 13/16); Champion +Heroic Warrior (T5 origin16/cross25) +Superior Critical (T6 19/30) all 3 pricing places (features now 317 excl hidden; qa C2 updated); Ability ladder above 10 -> 4,5,7,10,14 (cum 16:16,18:26,20:40; deep-check2 M8a updated); kiCum -> bands-of-two [0,1,2,4,6,9,12,16,20,25,...] (qa C1 updated).

REMAINING (compute/model changes): Vigor -> Passive band [5,8,11,14,17,21,25] + die-match-free-of-CON rule; Grit -> Situational [2,4,6,9,12,15,18] + HP +5->+4; Metamagic -> Steep [2,4,6,8,10,12]; Combat Superiority -> 3 free maneuvers + extra ladder [4,5,6,7,8,9,10...]; 10 Fighting Style arts -> priced A&T T3 Passive 11(9) MODEL CALL (naive ap 0->11 double-charges + breaks fighting-style.cjs:23); Additional Fighting Style barring; Fighter Weapon Mastery row; Mystic Arcanum wording + Ranger vestigial line + rules 16/20; then bump DATA.version x7 + build, update CONTEXT+CHANGELOG, deliver.

OPEN Qs: (1) draft guide does not enumerate the 10 fighting styles as priced rows — apply changelog intent T3 Passive 11/9? (2) confirm Fighter 555 = canonical-build cost, not the AP budget (491 unchanged).

METHOD: soffice docx->txt -> guide-reconcile --regen -> reprice -> apply-shared-edit x7 -> parity -> guide-reconcile --strict 0-drift -> audit-all 20/20. MASTER grid unchanged in v0.313.
