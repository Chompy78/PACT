# D-GH-2026-09-02-file-protocol-support-or-drop-the-claim — `file://` is not a supported way to run the tools

**Status:** Accepted · 2026-09-02 · branch `fix/file-protocol-support-or-drop-the-claim`

## Context

Two of the three tools' file headers carried this line, under a block titled **HARD CONSTRAINTS (do not
break)**:

```
 • Single self-contained .html: inline CSS+JS, NO external deps, NO network/CDN, no build step.
   Must run by opening the file directly (file://).
```

It was false, and had been since **D-GH26**, the safe-subset migration that moved the rules engine into
`js/engine.js` and had each tool import it through an ES-module bridge that fires `engine-ready`.
Browsers refuse ES-module loads from a `file://` origin, so off disk that bridge never runs.

Measured in headless Chromium on 2026-09-02, each tool opened directly from the filesystem:

| tool | engine loaded | `DATA.version` |
|---|---|---|
| CharGen | **no** | `null` |
| Live Sheet | **no** | `null` |
| DM Console | **no** | `null` |

Not degraded — non-functional. The page renders and nothing behind it works.

**How it was found, and a correction worth keeping.** A task was filed on 2026-09-02 claiming CharGen
displayed rules `v0.339` while the engine was at `v0.364`. That task was **wrong**: it was written from a
`grep` without loading the tool, and the live label was correct. Disproving it in a browser surfaced the
real finding — the stale literals are only ever *visible* when the module bridge fails, and the one
documented way to make it fail is the one the headers were telling people to use.

A second correction: the first write-up of this said **all three** tools carried the claim. Only two do.
`DM-Console.html` has a single incidental comment (`/* storage may be unavailable on file:// in some
browsers */`) which is not a constraint and was left alone.

## Options

- **A1 — Make `file://` work again.** The engine would have to reach the tools without ES modules,
  i.e. inlined at build time. `AGENTS.md` bars a build step outright ("Vanilla JS only — no frameworks,
  bundlers, TypeScript, or npm"), so this is not an implementation task; it is a request to relax a hard
  rule, with the follow-on cost that the committed `tools/*.html` stop being the files you edit.
- **A2 — Drop the claim, keep the idea.** Delete the false line, state what actually replaces it (served
  over http), and file the *capability* separately so it is not lost along with the wrong sentence.
- **A3 — Leave it.** Rejected without needing the owner: a false line inside a block headed "do not
  break" is worse than no line, because the next agent defends it.

## Decision

**A2.** The claim is removed from both tool headers and replaced with what is true — served over http,
GitHub Pages or any local static server — stating in place *why*, so the next reader does not restore it.
Restoring `file://` support is recorded as a **LATER** consideration
(`docs/TASK_BOARD_LATER.md`, `feat/file-protocol-support`), explicitly gated behind a decision to relax
the no-build-step rule, with "declined" named as a legitimate closing outcome.

## Why

The single most informative fact is that this broke at D-GH26 and **nobody reported it in the whole
window since**. That is evidence about how much the capability is actually used, and it is why the
restore is LATER rather than NEXT — it is a real product question, not a live defect.

The asymmetry decided the rest. Leaving the sentence costs nothing until an agent reads "do not break"
and spends a cycle defending a constraint that has not held for months, or — worse — treats a `file://`
failure report as a regression to bisect. Removing it costs nothing at all, provided the replacement says
what to do instead, which it does.

`AGENTS.md`'s own working discipline settles the tie-break: *the shipped artifact wins over the written
guide*. The artifact has not supported `file://` since D-GH26. `docs/HOW-TO-WORK.md` was already correct
on this point ("`file://` will not work") while the tool headers contradicted it — so this change makes
the headers agree with the doc, not the reverse.

## Status

Accepted and shipped. Both headers corrected; `docs/HOW-TO-WORK.md` gained the failure *symptom* (page
renders, `window.DATA` undefined, version labels on their fallbacks) so the next person recognises it
without re-measuring. `docs/TASK_BOARD_NOW.md` entry removed; `docs/TASK_BOARD_LATER.md` entry added.

### Addendum — the block was rotten, not just that one line (same day)

A `/code-review ultra` pass over the first commit found that fixing one sentence had left the rest of the
same "READ FIRST" comment block false, and it applied this decision's own reasoning — *a false line under
a "do not break" heading is worse than no line* — to what remained. All verified against the files before
acting; the whole block was then de-rotted in one pass:

| what it said | what is true |
|---|---|
| `AI SESSION CONTEXT — READ FIRST (PACT tools · v0.339)` | rules were v0.364; **no** version is stamped there now, by design |
| `see PACT-CONTEXT.md (authoritative)` | that file does not exist anywhere in the repo → `AGENTS.md` |
| `Rules source of truth: PACT-Players-Guide-v0.303.docx` | no `.docx` exists; the source of truth is `js/engine.js` |
| `compute()` and `DATA` are "copy-pasted into BOTH html files" | both live **only** in `js/engine.js` since D-GH26; `grep -c 'function compute(' tools/*.html` → 0, 0 |
| `RULE: any change to the engine or DATA must be mirrored in the other file` | obeying this means re-implementing the engine in a tool — the one thing `AGENTS.md` forbids outright |
| `Single self-contained .html … NO external deps` | both tools import 6-7 modules from `js/` plus `ui-helpers.js`; that is the intended architecture |
| `Exports a "-livesheet.json" that hands the character to the sibling` | deleted by D-GH40; the handoff is the shared envelope, or `switchToLiveSheet()` |

**One of these was player-facing, not just a comment.** The Live Sheet's in-app Tool Guide told players to
click `⇆ Live Sheet` "to download a `-livesheet.json` file". That button is `⇆ Open in Live Sheet`, it calls
`switchToLiveSheet()`, and it downloads nothing — so a player following the guide went looking in their
Downloads folder for a file that was never produced. Rewritten to describe the two routes that exist.

**Not fixed, deliberately:** four items in that block (`renderCharSheet`, `buildPortraitPrompts`,
`hydrateSheet`/`csSave`) really *are* still copy-pasted into both tools, so the ⚠ heading stays and only the
migrated rows were removed. The review's write-up implied the whole block was obsolete; it is not, and
deleting it would have created a new false statement in place of the old one.

The stale claim also survived in `docs/AI_review_prompt.md`, the brief handed to a **cold external
reviewer** — who by design has no repo access and therefore cannot disprove anything in it. That file
listed both `file://` support and `DATA.version = "v0.337"` as ground truth. Both corrected.

**The pattern worth naming:** every one of these was written true and left behind by a later change, and all
of them sat in the block whose stated job is to orient a fresh agent. Orientation comments rot *silently*
and are read *first*, which is the worst possible combination. `testing/scripts/version-label-ci.mjs` now
gates the version numbers a user sees; nothing gates prose, so the only defence is fixing the whole block
when you are already in it.

### Addendum 2 — the prose tripped the guard it described (2026-09-03)

Shipping the de-rot turned CI red. The new comment asserted that neither tool declares a local
`compute()` and proved it by quoting the command — writing the literal `function compute(` into both
files. `testing/scripts/audit.py`'s engine-symbol drift guard matches
`\bfunction\s+(compute)\s*\(` against **raw file text, comments included**, so the sentence claiming
the guard finds nothing became the thing it found. audit: 27 passed / 2 failed.

Two ways out, and the choice matters more than the bug:

| | |
|---|---|
| **Loosen the guard** to strip comments before matching | Rejected. A commented-out engine symbol is a paste waiting to happen — the guard's whole job is to stop `compute()` reappearing inside a tool, and a commented one is one keystroke from live. Weakening the check that protects the single source of truth, to accommodate a sentence, inverts the priority. |
| **Reword the prose** | Taken. The comment makes the same point without spelling out a declaration, and now warns the next editor that the guard reads comments. audit 29/0. |

**The process failure is the more useful record.** Before pushing, four gates were run locally
(engine-parity, version-label, undo-barrier, tool-pricing) and `audit.py` was not — so a check that
exists, runs in CI, and catches exactly this class of change was skipped by the person editing the file
it guards. Afterwards every gate CI runs was enumerated from `.github/workflows/*.yml` rather than
recalled: twelve, of which nine execute in a cloud container and three (`chargen-flows-e2e`,
`cloud-e2e`, `guide-theme-e2e`) need Playwright, which is not installed there. The lesson is not "run
more tests" but "derive the gate list from the workflow files, don't remember it".

## Status (original)

Not covered here, deliberately: whether the `v0.339` fallback literals should exist at all. They are now
gated against drift by `testing/scripts/version-label-ci.mjs`, which is a different question from whether
a fallback that is only visible in a non-functional state is worth carrying.
