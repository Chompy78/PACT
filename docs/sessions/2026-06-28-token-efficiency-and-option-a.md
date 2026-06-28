# Session narrative — 2026-06-28 · token efficiency, repo structure, and Option A

> History / non-authoritative. The *discussion* behind the changes; durable conclusions live in
> `DECISIONS.md`, the one-line "what" in `archive/PACT-CHANGELOG.md`. Build stayed v0.104 / `DATA.version`
> v0.322 throughout — no engine/rules change.

## Where it started
The user handed over `PACT-pact-hb-v0.322-restart.tar` and asked, loosely, to make a "token-efficient"
tar and reorganise the files — plus two real questions: *does taring cost much, and should I extract it
into a session?* The useful correction up front: **a tar's format doesn't change token cost at all** —
tokens are spent only when file *contents* are read. Extracting is the cheap prerequisite for *selective*
reading. The real waste in this project is that the ~238 KB engine is duplicated across the four HTML
tools (measured: CharGen 506 KB ≈ ~145k tokens, 48–79% of each file is the engine).

## What we explored, in order
1. **A front door.** Rather than merge docs, we added `INDEX.md` — a ~8 KB map (read-order, file table,
   the "never paste a whole HTML tool" rule) so a session orients cheaply. Decided small files + an index
   beat a megafile (you read only what you need). → D-001, D-002.
2. **Honesty gate.** Found the embedded restart note was stale (claimed v0.309 / v0.102 while shipped state
   was v0.322 / v0.104). Added a `PACT-CURRENT` marker + `version-consistency` gate (G3) so a doc can't lie
   silently. A gate can check a version string, not prose style. → D-005.
3. **File types.** Confirmed prose stays Markdown, tables stay TSV, records stay JSON — converting prose to
   JSON would *add* tokens. → D-004.
4. **Archive the history.** Moved CHANGELOG (55 KB), old restart-status sections, the v0.313 note, the
   ki-sorcery audit (its tags are already live in the engine), and the fuzz harness into `archive/`
   (renamed `OVERNIGHT-PLAN.md` → `FUZZ-STRESS-PLAN.md`, `overnight.cjs` → `fuzz-stress-harness.cjs`).
   Live read-path went ~111 KB → ~32 KB. A FUSE glitch wrote the CHANGELOG as 0 bytes mid-move; caught it on
   verification and restored the full file from the untouched input tar. Kept everything (no deletes). → D-003.
5. **Addressable tests.** Instead of renaming 45 gate files to generic codes (which loses meaning + risks
   breakage), added an A–G code layer: `audit-all.cjs` runs by code/group/`--list`, catalogued in
   `tests/TESTS.md`. → D-006.
6. **A1/A2 output format.** The user's coded-list preference turned out to already be in their personal
   Copilot instructions; mirrored it into INDEX for PACT sessions.
7. **Changelog discipline.** Added `changelog-gate` (G6 — current version must be documented) and a written
   "How to add an entry" convention; later broadened the rule to "log any substantive change before you
   finish," not just version bumps.

## Option A (the big one)
We weighed the only structural way to cut the token floor: de-duplicate the engine. Rejected two tempting
shortcuts — **merging CharGen + Live-Sheet** (different jobs/economic models; risky product merge for a
partial win → D-008) and an external `engine.js` via `<script src>` (breaks the standalone single-file
requirement). Chose the **in-place build**: `src/engine/*.js` is the source; `scripts/build.cjs` rewrites the
engine block inside each tool by brace-match. The decisive property: the **first build is byte-identical** —
proven by md5 before/after, plus a round-trip (edit `src/` once → build → all four tools updated → revert →
back to identical). The old parity check became `build-check` (G1). The tools stay standalone; you now edit
one place. The default workflow: edit `src/`, and **rebuilding the shipped HTML is a deliberate, prompted
step** (the user explicitly wanted "default = token-efficient, prompt me before producing shipped files"). → D-009.

## What we deliberately did NOT do
- **Merge the DM consoles** — same tool, two layouts; worth merging into one "DM section", but it's a UI
  change needing visual QA, so deferred to its own step. After Option A its payoff is product/UX, not tokens. → D-010.
- **Bump the build / rename tool files** — would have changed the `.html` and broken the byte-identical proof.

## Open at session end
- **GitHub hosting model** (Pages-with-shared-engine vs single-file downloads vs both) — drives whether the
  engine stays inlined. Leaning "both". → D-011.
- **DM console merge** — approved in principle, pending the hosting decision.
- **IP check before going public** — the repo embeds 2024 PHB species data + official spell JSON; confirm
  only SRD-licensed content is published (flagged, not resolved).
- **Character test fixtures** — designed + schema-mapped, **not generated** (see `DECISIONS.md` D-012).

## Character test fixtures — started, not finished
The user asked for sample character files for GitHub testing: 1 empty character, 4 valid builds at
**50 / 150 / 250 / 500 AP**, 4 invalid builds (a spread: over-budget, missing prerequisite, illegal buy,
cap/duplicate), and the 4 valid builds re-expressed as **Live-Sheet histories** folding to the same final
builds. Confirmed the design (blank empty char; I pick diverse archetypes spending ~90–100% of budget;
distinct failure modes; livesheet twins = identical folds). Mapped the schema — every file is
`{rules,name,LOG,SEQ}` and the build is folded from the LOG — and the headless loader (`loadEngine` →
`foldBuild`/`setLOG`/`compute`/`economy`), with each buy priced by `compute().total` deltas.
**Stopped before generating any files** — `tests/fixtures/samples/` does not exist yet. Plan recorded as
**D-012**; a new session resumes directly from there.

## Result
All 46 gates green throughout; the four HTML tools are byte-for-byte unchanged. New: `INDEX.md`,
`DECISIONS.md`, `src/engine/` + build/build-check, `tests/TESTS.md`, `archive/` history split, G3/G6 gates,
and this narrative. Deliverables outside the repo: `PACT-AI-Setup-Prompt.md` and an updated
`How-to-Prompt-AI-Well.docx` (added a "3.3" pattern).
