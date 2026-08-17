# Handover patch — `pact-guide`'s `AGENTS.md`: cross-project rules-change atomicity

**Status:** Drafted, awaiting application in `pact-guide`. Not applied from this repo by design —
`pact-guide` is a separate project, and PACT's `AGENTS.md` "Technical Access ≠ Scope" rule says an
agent doesn't edit another project's files unprompted.

**Companion to:** the same rule landed in this repo's `AGENTS.md` (section *"A mechanics change isn't
finished until the engine AND the guide land it"*, added 2026-08-16 immediately after the Versioning
section).

**Why a patch and not a rewritten file:** per `AGENTS.md`'s standing rule — *"Copilot can't write files
back — ask it for a patch, not a full file"* — and its general *"Edit, don't regenerate"* discipline.
Both patches below give the exact old text and exact new text; apply them by hand and leave every
untouched section alone.

Line numbers are as of reading `pact-guide/AGENTS.md` on 2026-08-16 (306 lines total, header says
`Last Updated: 2026-08-06`). Anchor on the quoted text, not the numbers, in case the file has moved.

---

## Patch 1 of 3 — correct the misleading `engine.js` gotcha

**File:** `AGENTS.md` · **Section:** `## Tool-specific gotchas (fill in as discovered)` (~line 157)

**Why:** the note is half-right in a way that actively misleads. It is true that `engine.js` isn't
*owned* by `pact-guide`. But *"This project's engine is `/py/engine.py`"* reads as "`py/engine.py` is
the rules authority here" — and on 2026-08-16 that reading nearly caused a 171-finding guide-vs-engine
audit to be thrown away and redone against the wrong engine. That project's own
`D-2026-08-16-guide-audit-reconciliation-target` settled it the other way. The note that exists to
prevent the confusion is currently a cause of it.

### Exact old text

```
- **`engine.js` does not belong to this project.** PYTHON-FILES-OVERVIEW.md and an earlier version of this
  project's start prompt both referenced it, but it lives in the separate PACT-copilot-only project. This
  project's engine is `/py/engine.py`. Corrected in the start prompt on 2026-07-14.
```

### Exact new text

```
- **`engine.js` does not belong to this project — but it IS the rules authority over this project's
  guide.** `engine.js` lives in the separate PACT web-tools repo (GitHub `chompy78/pact`, referred to
  elsewhere here as "PACT-copilot-only"); PYTHON-FILES-OVERVIEW.md and an earlier version of this
  project's start prompt both referenced it as if it were local. Corrected in the start prompt on
  2026-07-14. **Do not read "not ours" as "not authoritative":** for reconciling the Players Guide's
  rules prose, `PACT/js/engine.js` + `js/engine-data.js` are the source of truth, and `/py/engine.py`
  is a *separate* engine awaiting its own reconciliation (and a probable rename to end the name
  collision). Settled by explicit owner instruction — see
  `D-2026-08-16-guide-audit-reconciliation-target`. On 2026-08-16 the older phrasing of this very
  bullet nearly caused a completed 171-finding audit to be discarded and redone against `/py/engine.py`.
```

---

## Patch 2 of 3 — add the atomicity rule

**File:** `AGENTS.md` · **Insertion point:** as a new top-level section immediately **before**
`# Technical Access ≠ Scope` (~line 199), i.e. directly after the final `## Tool-specific gotchas`
bullet and its `---` separator.

**Why:** nothing in either project currently states that a mechanics change has to land in both the
engine and the guide before it's finished. Grit's pricing diverged for ~6 days as a direct result.

### Exact old text (the anchor — do not change these lines, they are shown only to locate the insertion)

```
- **`device_bash` has no network access at all.** `git push`/`git fetch` fail immediately (e.g.
  `socat... Forbidden`). Any push must be run by John himself on the machine that hosts the actual clone,
  using the exact commands relayed to him. Confirmed 2026-08-05.

---

# Technical Access ≠ Scope
```

### Exact new text (replaces the anchor above — the anchor's own lines are preserved verbatim, with the new section inserted between the `---` and the existing heading)

```
- **`device_bash` has no network access at all.** `git push`/`git fetch` fail immediately (e.g.
  `socat... Forbidden`). Any push must be run by John himself on the machine that hosts the actual clone,
  using the exact commands relayed to him. Confirmed 2026-08-05.

---

# A Mechanics Change Isn't Finished Until The Engine AND The Guide Land It

A rules change that lands in this project's guide but not in `PACT/js/engine.js` — or the reverse — is
**half-done, not done**. Players read the guide, so a guide that disagrees with the engine is a live
rules bug with a human audience. Both sides land before the task closes.

- **The rules version is bumped exactly once, in the engine** (`DATA.version`, in PACT's
  `js/engine-data.js`). This guide never carries its own rules version. What the guide carries is the
  `documents-rules:` pointer — a *reconciliation assertion* recording which engine version this prose
  was last checked against, stamped only as a deliberate act via `py/tools/stamp_guide_rules.mjs`,
  never auto-advanced by a vendor refresh. `content-version:` is a different marker with a different
  meaning (this prose's own revision) — never conflate them. See
  `D-2026-08-12-guide-rules-pointer`.
- **`PACT/js/engine.js` wins when the two disagree.** Not `py/pricing.py`, and not `py/engine.py`. See
  `D-2026-08-16-guide-audit-reconciliation-target` and the corrected `engine.js` gotcha above.
  `PYTHON-FILES-OVERVIEW.md` calls the Python tooling the "pricing authority"; that line is hedged
  ("appears to…", "[VERIFY] Located but not yet fully inspected") and is a survey note, not a rival
  declaration — it does not override this.
- **This project owns the guide master.** `PACT-Players-Guide.html` here is canonical;
  `PACT/docs/PACT-Players-Guide.html` is a served copy. Transfer is manual and three-way-verified —
  the procedure lives in PACT's `docs/VERSION-SYNC.md`, and PACT's copy is never the place to make a
  guide edit.
- **Six rules-carrying copies can drift, not two:** (1) PACT `js/engine.js` + `js/engine-data.js`
  (source of truth) · (2) PACT `docs/PACT-Players-Guide.html` (served copy) · (3) this project's
  `PACT-Players-Guide.html` (master) · (4) `py/pricing.py` · (5) `py/engine.py` · (6)
  `py/vendor/engine/` (point-in-time snapshot of PACT's engine files; provenance in its
  `SYNCED_FROM.txt`, refreshed by re-running the sync, never hand-edited).

**Why this is a rule and not a nicety:** Grit's pricing diverged between guide and engine for ~6 days
(2026-08-06 → 2026-08-12) because nothing said this — this project deliberately moved to the 2N Steep
curve and documented the divergence while PACT's engine kept the older ladder, and each side's records
read as authoritative on its own. The August 2026 guide-vs-engine audit then found **171** discrepancies,
so Grit was the symptom that got noticed, not the extent of the drift.

---

# Technical Access ≠ Scope
```

---

## Patch 3 of 3 — bump the file's Last Updated date

**File:** `AGENTS.md` · **Line 5**

### Exact old text

```
Last Updated: 2026-08-06
```

### Exact new text

```
Last Updated: 2026-08-16
```

---

## After applying

1. Log it in `pact-guide`'s `CHANGELOG.md` (docs-only; **no** `DATA.version` bump — that number lives
   in PACT's engine and this change alters no mechanics).
2. Close the matching entry on `pact-guide`'s `TASK_BOARD.md` if one is tracking the atomicity rule.
3. No `documents-rules` re-stamp: this patch changes no guide prose, only agent instructions.
