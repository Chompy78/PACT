# D-GH-2026-07-15-dm-console-roster-tuned-curve — roster level onto the tuned curve, local mirror, full Live-Sheet parity

Status: Active

- **Context:** DM Console's roster showed each character's AP-equivalent level via `apLevel(eco.earned)`,
  which read the fixed `DATA.levelAP` ladder (L1=50, L2=92, L3=134, …). Live Sheet had already migrated
  its Track-Level / Earned-Lv readouts onto the DM-tunable `levelBudgetCurve` (D-GH-2026-07-14), so a DM
  who tuned their campaign curve saw their own roster disagree with the same character's Live Sheet. The
  roster is built by `dmAnalyze(exported)`, which operates on each imported character's LOG.
- **Options — where the curve comes from:** (A) extract Live Sheet's `_levelCurve()`/`trackLevel()` to a
  shared location and import into both tools; (B) a DM-Console-local mirror reading the campaign rules the
  same way Live Sheet does. **Options — the untuned fallback:** (1) use the tuned curve only when one is
  configured, else keep the fixed `DATA.levelAP` ladder; (2) full Live-Sheet parity — use the curve system
  always, falling back to the Standard preset (`{l1:79,inc:24}`) when untuned, exactly as Live Sheet.
- **Decision:** B + 2. A DM-Console-local `_latestLogSnapshotRules()`/`_levelCurve()`/`trackLevel()` trio
  (byte-mirroring Live Sheet's offline path — the character's latest LOG `rulesSnapshot.campRules`), the
  old `apLevel()` function removed. Fall back to the Standard preset when untuned/unbound.
- **Why:** (B over A) the "Consolidate the 4 duplicated level lookups" task
  (`chore/unify-level-lookup-helper`) already owns the shared-helper extraction across all tools; doing it
  here would collide with that task and blow past this single-file scope — a local mirror is the correct,
  non-overlapping increment, and the consolidation task will absorb both copies later. (2 over 1) option 1
  would still leave DM Console disagreeing with Live Sheet for *untuned* characters (fixed ladder vs
  Standard curve are numerically very different), which is the same class of bug this task exists to kill;
  "migrate *off* the fixed ladder … consistent with Live Sheet" reads as retiring the ladder for display,
  not conditionally keeping it. DM Console operates on imported files with no live cloud rules, so the LOG
  snapshot is the authoritative rules source (never the live-cloud branch of Live Sheet's `resolveRules()`).
- **Trade-off / watch-outs:** an unbound/untuned character's displayed roster level can shift versus the
  old ladder — by design, to match Live Sheet. Display-only; no `DATA.version` bump. **Stale reference:**
  the still-open `chore/unify-level-lookup-helper` roadmap entry cites `DM-Console.html:552 (apLevel(),
  fixed DATA.levelAP ladder)` as a call site — that site is now `trackLevel()` on the tuned curve; left
  unedited here because `docs/PACT_ROADMAP.md` has a single writer (flagged in the hand-off instead).
- **Status:** In force.
