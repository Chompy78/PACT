# 2026-08-17 — Guide↔engine reconciliation: bundles, gates, and three checkers

Session ran from "sync the tools and the guide" to six `DATA.version` bumps (v0.343 → **v0.350**).
This is the narrative; *what* changed is in `CHANGELOG.md`, *why* in the four
`decisions/2026/D-GH-2026-08-17-*` records.

## The through-line

The session's real subject turned out to be **subclass bonus-spell bundles** — a purchase type that had
never been fully modelled. It was found by accident while checking something else, and every subsequent
thread came out of it.

## What was built

Three mechanical checkers, replacing an unreliable 171-finding hand-written audit:

| Script | Covers | Result |
|---|---|---|
| `guide-price-check.mjs` | 424 feature rows | 0 mismatch |
| `guide-spell-check.mjs` | 667 spell-economy cells | 0 mismatch |
| `guide-bundle-check.mjs` *(new)* | 24 bundle rows + Appendix J | 0 findings |
| `verify-guide.mjs` *(new)* | all three + structure + anchors | one PASS/FAIL |

Plus `gen-appendix-j.mjs` and `gen-bundle-workbook.py`, which generate the guide's new Appendix J and a
checkable spreadsheet from the engine rather than by hand.

## The image loss — found at the very end, by the owner

Commit `e0c5e9f` early in the session did what it said: made the served guide **byte-identical** to the
`pact-guide` master (v0.332 → v0.333). What nobody checked is that the master carries **one JPEG** where
this repo's copy carried **ten optimised WebPs** — a cover banner plus nine chapter illustrations
(*The Unwritten Future*, *Growth Through Choice*, *Lessons Learned*, *Coin Into Capability*, *Echoes of
the Past*, *Many Roads*, *Shaping Possibility*, *Every Choice Has Weight*, *The Ever-Unwritten Future*).

Nine illustrations were dropped at that moment, and every commit since carried the loss forward. Prose
*grew* by 12 KB across the session, which is why the 324 KB file-size drop never looked like content
loss — it looked like the compaction the master sync was expected to produce.

**Found because the owner noticed `preview`'s guide was dated 12 August** and asked about it, minutes
before a PR would have merged the loss.

Two lessons, both worth more than the fix:

- **`verify-guide.mjs` passes on this file.** It checks prices, structure and anchors — it says so — but
  it has no idea nine images vanished. An image-count check belongs in it.
- **The copy-back risk runs *both* ways.** The session repeatedly framed it as "copying from the master
  would wipe this repo's edits". The master is *also* missing things the served copy had. The two files
  diverged in **content**, not just recency, which the "keep them byte-identical" procedure does not
  account for.

## Four times the work was wrong, and how it was caught

Recorded because the pattern matters more than any single fix.

1. **"The engine stores only the lump price."** Asserted, built on, and used to construct Appendix J from
   an *assumed* grant shape. `DATA.spellGrants.subclassSpells` had the real spell lists all along. The
   assumption reproduced 16 of 21 prices and wrongly printed five bundles as "hand-set". Reading the real
   data reproduced 20, and the one genuine outlier (Circle of the Sea) turned out to be a 1 AP slip.
   **Caught by the owner asking "so you don't know what spells are in each one?"**
2. **"The inverted penalty is a defect."** The cold-review document was built on it. §11 blesses the
   per-feature route explicitly — *"the per-feature surcharge is cheaper for a single dip"* — and the
   guide was local the whole time, never grepped. **Caught by three of four cold reviewers.**
3. **"Bundles carrying +Tier contradicts §13."** Flagged twice as a blocker. §13 protects the spell
   *economy*; the engine has always priced spell-*granting* features with the full surcharge.
   **Caught by the owner citing Magical Secrets and Pact of the Tome.**
4. **Star Map edited in one of three places.** `guide-price-check` caught it as a `price-mismatch` —
   the gate earning its keep.

The common shape: **an absence claim asserted without the two independent checks `AGENTS.md` requires.**
Each was cheap to check and expensive to have wrong.

## Decisions taken

- Bundles get three price tiers, with the cross-class surcharge (**v0.350**) — the load-bearing one.
- Subclass purchases warn when the class is neither origin nor unlocked (**v0.347**) — *contested*, and
  the analysis that motivated it was partly wrong. Recorded as provisional.
- Circle of the Stars' spells split from Star Map's free-cast (**v0.349**).
- The 192-entry `DATA.features` mirror: measured, deliberately **not** fixed.

## Left open

- **The `pact-guide` copy-back — and the image restore.** Ten commits of guide edits exist only in this repo, and nine illustrations exist only on `preview`. The documented
  transfer direction would silently wipe them. Highest-risk outstanding item.
- **`refactor/subclass-purchase-unify`** on the NEXT board — the structural half of the bundle work.
- **The build-replay check** — worked-example line items are still unverified; only running totals are.
- **`documents-rules`** still unstamped.
- Four cold reviews filed under `docs/plans/cold-reviews/`, answering a question whose premise was wrong.
  They should be re-run, not acted on as-is.
