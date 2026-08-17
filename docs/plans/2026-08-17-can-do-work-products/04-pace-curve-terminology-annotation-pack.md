# Annotation pack — `docs/pace-curve-terminology`

**Task:** Purge the "pace curve" mislabel from the historical records.
**Discipline (critical):** **Annotate — do NOT rewrite.** These are historical
records of what was believed at the time. Preserve the original wording and
reasoning **verbatim**; add a short, dated correction note **beside** it,
pointing at `D-GH-2026-08-03-ap-budget-curve-standard`. **Never regenerate a whole
file.** This mirrors the existing "Addendum (2026-08-03)" shape in
`D-GH-2026-08-02-creation-lock-switch.md`.

> ⚠ **Re-grep before pasting.** Line numbers were verified 2026-08-03 and may have
> moved. Confirm each site still says what's quoted below before editing.

---

## The correct framing (what every note asserts)

`D-GH-2026-08-03-ap-budget-curve-standard` established that **PACT has no
AP-earned-per-level curve at all**:

- The `{1:50 … 20:491}` ladder was the **Players Guide appendix's twenty
  pregenerated Emberwatch sample characters** — not a rule.
- The rules define only a **budget curve** (Standard L1 79 / +24, Generous
  83 / +28, prelude L0 55) and an **award pace** (AP per session, ~7).
- Live code was already corrected in that change; only the **archival records**
  still assert the old framing as settled fact.

---

## Paste-ready notes (one per site)

Each note is written to sit **directly beneath** the quoted line. Keep the
original line untouched.

### Site 1 — `DECISIONS.md:448`
Original (the mislabel is the parenthetical; the decision itself was correct at
the time):
> "left js/ap-by-level.js untouched (pace curve != budget curve)"

**Paste beneath it:**
```
> Correction (<date>, see D-GH-2026-08-03-ap-budget-curve-standard): the term
> "pace curve" here is a mislabel. PACT has no AP-earned-per-level curve — the
> rules define a *budget* curve (Standard L1 79/+24, Generous 83/+28, prelude L0
> 55) and a separate *award pace* (~7 AP/session). The decision this line
> records — leaving js/ap-by-level.js untouched — was still correct at the time;
> only the parenthetical naming is wrong.
```

### Site 2 — `decisions/2026/D-GH49.md:8`
Original cites `DATA.levelAP` as `{1:50…20:491}` / `DATA.level1AP` 50. **Note the
supersession — do not edit the figures in place.**

**Paste beneath it:**
```
> Superseded (<date>, see D-GH-2026-08-03-ap-budget-curve-standard): the
> {1:50…20:491} / level1AP 50 figures cited here were the Players Guide appendix's
> twenty pregenerated Emberwatch sample characters, mistaken for a rules curve.
> The live values are now 79-based (budget curve: Standard L1 79/+24). Figures
> left as-written to preserve the record of what was believed at the time.
```

### Site 3 — `decisions/2026/D-GH-2026-07-14-advancement-tracks.md:9`
Original:
> "(AP earned by level: 1->50…20->491, which is exactly what js/ap-by-level.js's
> AP_BY_LEVEL already is)"

This record **also** contains the follow-up note that predicted a `DATA.version`
bump would be needed — **that prediction came true, so cross-link it.**

**Paste beneath it:**
```
> Correction (<date>, see D-GH-2026-08-03-ap-budget-curve-standard): the
> "AP earned by level 1->50…20->491" framing is wrong — that ladder was the
> Emberwatch sample characters, not an earned-per-level rule. PACT defines a
> *budget* curve (Standard L1 79/+24) and a separate *award pace* (~7/session).
> The follow-up note below predicted a DATA.version bump would be needed; that
> prediction came true — see D-GH-2026-08-03-ap-budget-curve-standard.
```

### Site 4 — `decisions/2026/D-GH-2026-08-02-creation-lock-switch.md:78/86/88`
The 2026-08-03 addendum's whole **two-curve framing**. Its **mechanism** (the
threshold reads the campaign budget curve) is **unaffected and must stay** —
**only** the "pace curve" naming and the `L1=50` figure are wrong.

**Paste beneath the addendum's two-curve framing:**
```
> Terminology correction (<date>, see D-GH-2026-08-03-ap-budget-curve-standard):
> this addendum's "pace curve" naming and its L1=50 figure are wrong. There is no
> AP-earned-per-level curve; L1 on the budget curve is 79 (Standard). The
> mechanism described here — the creation-lock threshold reading the campaign
> budget curve — is correct and unchanged; only the naming and the 50 figure are
> superseded.
```

### Site 5 — `docs/sessions/2026-07-14-advancement-tracks-review-saga.md:22`
Session note. **Lowest priority; a single dated footnote at the top is enough for
a session log.**

**Paste as a footnote at the top of the file:**
```
> Footnote (<date>): terminology in this session log predates
> D-GH-2026-08-03-ap-budget-curve-standard, which established that PACT has no
> AP-earned-per-level "pace curve" — only a budget curve (Standard L1 79/+24) and
> an award pace (~7/session). Left unedited as a record of the discussion at the
> time.
```

---

## Extra re-grep before closing
Also re-grep for the following **outside** `docs/PACT-Players-Guide.html`,
`docs/history/` and `CHANGELOG-archive-*.md`, in case a site was missed:
- `"1st-level recruit"`
- `"491"`
- `"+21/level"`

Any hit that presents the old framing as **current fact** gets the same
beside-the-line dated note; hits inside an explicit correction note, `docs/history/`
or the changelog archive are fine and expected.

---

## Bookkeeping
- **Docs-only.** Do **NOT** bump `DATA.version`.
- Log the sweep in `CHANGELOG.md` as **one line**.
- **No new `DECISIONS.md` entry** is needed — `D-GH-2026-08-03-ap-budget-curve-standard`
  already carries the "why", and this task is listed there under "Caveats and
  follow-ups".

## Done when
`grep -rn "pace curve\|PACE curve" --include=*.md --include=*.js --include=*.html .`
returns no hit that presents the term as **current fact** outside `docs/history/`
and the changelog archive (hits inside an explicit correction note are fine and
expected); every edited record still contains its **original wording**; and parity
still reports **0 failed**.
