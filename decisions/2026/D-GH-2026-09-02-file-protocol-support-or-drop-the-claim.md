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

Not covered here, deliberately: whether the `v0.339` fallback literals should exist at all. They are now
gated against drift by `testing/scripts/version-label-ci.mjs`, which is a different question from whether
a fallback that is only visible in a non-functional state is worth carrying.
