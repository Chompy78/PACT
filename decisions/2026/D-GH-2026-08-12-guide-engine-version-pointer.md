# D-GH-2026-08-12-guide-engine-version-pointer — Guide gets a machine-generated `documents-rules:` pointer, separate from its own doc revision

Status: **Active**, 2026-08-12. Docs/tooling change — no `compute()`/rules-logic impact, no `DATA.version`
bump.

## Context

`docs/TASK_BOARD_NEXT.md` tracked "Reconcile guide↔engine rules-version drift" — the Players Guide is
maintained in a separate, non-GitHub project (`pact-guide`, on the home server), which hand-copied this
repo's `DATA.version`/`BUILD` into several of its own files and drifted repeatedly (confirmed stale
multiple times, most recently flagged in `D-GH-2026-08-12-grit-steep-ladder`'s Outstanding section). This
repo's own served guide copy, `docs/PACT-Players-Guide.html`, also had no defined update path — its
`content-version` marker (`v0.332`) had already fallen out of sync with its own content (commit `3bd8e70`
updated the Grit table to match rules `v0.343` without updating the marker).

A cold-reviewed plan (4 independent reviewers: Copilot/Opus-4.8, Kimi Chat, M365 Copilot/GPT-5 reasoning,
Claude 3.5 Sonnet — reviews at `z-cold/` on this repo's `zcold` branch) was drafted at
`docs/plans/2026-08-12-guide-engine-version-pointer.md`. This record closes that plan's PACT-repo half
(Phase 1); the `pact-guide` half (Phase 2) was implemented directly in that project via the home-server
MCP connector the same session (that project's own `D-2026-08-12-guide-rules-pointer`).

## Options

Restated from the plan (full alternatives-considered discussion there): fully automate the cross-repo copy
(rejected — `pact-guide` has no GitHub remote/CI); a live client-side read of `engine-data.js` from the
guide page (rejected — static-only repo, no backend/build step, fragile cross-origin dependency); a
brand-new vendoring script for this task (rejected — `pact-guide`'s existing
`py/vendor/engine/SYNCED_FROM.txt` already captures every needed fact); auto-advance the marker on every
vendor refresh (rejected after cold review — conflates "vendored" with "reconciled").

## Decision

1. **Mirrored branch: `main`.** Matches `pact-guide`'s existing vendoring pipeline's own choice (not
   `preview`) — `main` is what's actually live for players.
2. **Two markers, distinct meanings, both hand-adjacent HTML comments in the guide:** `content-version`
   (unchanged — independent document revision, moves on prose edits) and `documents-rules` (new — asserts
   the prose was reconciled against a specific engine rules version; format `version=vX.XXX; branch=main;
   commit=<7-hex>; reconciled=<date>`, deliberately unlike `content-version`'s bare `vX.XXX` so the two
   can't be confused by eye).
3. **`documents-rules` is a reconciliation assertion, not a vendor-refresh artifact.** It's stamped only
   as a deliberate action (`pact-guide`'s new `py/tools/stamp_guide_rules.mjs`, `stamp`/`--check` modes),
   never automatically advanced just because `py/vendor/engine/` was refreshed for the pricing sync.
4. **`BUILD` is never mirrored in the guide** — confirmed absent from guide body prose this session.
5. **Guide's canonical filename dropped its version** (`pact-guide`'s `PACT-Players-Guide-v0.333.html` →
   `PACT-Players-Guide.html`) — the embedded version had already caused three stale hardcoded references
   in that project's own tooling.
6. **This repo's served copy (`docs/PACT-Players-Guide.html`) gets a documented, manual update procedure**
   (added to `docs/VERSION-SYNC.md`): whenever `pact-guide`'s canonical file changes, the session that
   made that change copies the finished HTML here and commits, verifying both markers parse and
   `documents-rules` agrees with `pact-guide`'s own vendored snapshot (three-way check: vendored snapshot
   ↔ `pact-guide` canonical ↔ this repo's served copy).

## Why

No fully-automatic cross-repo push exists or is justified by this task's own "defined update path" (not
"automated") wording — `pact-guide` is a private, local-only project with no GitHub remote. Reusing
`pact-guide`'s already-shipped `SYNCED_FROM.txt` provenance (from its 2026-08-11 pricing auto-sync
pipeline, `D-2026-08-11-engine-js-auto-sync-pipeline` in that project) avoids building a second, competing
vendoring mechanism — the exact "two overlapping sync mechanisms" trap that project's own record already
names.

## What is NOT changed

- `js/engine.js`'s `BUILD`/`DATA.version` mechanics (see `docs/VERSION-SYNC.md`'s existing sections) —
  untouched.
- No `compute()` output changed; no `testing/expected/` update needed.
- This repo's `docs/PACT-Players-Guide.html` content itself is **not** updated by this change — only the
  documented procedure for updating it. The file still shows its stale `v0.332` marker until
  `pact-guide`'s canonical copy is next transferred here (an explicit interim-state note, per cold
  review).

## Outstanding — not done in this change

- The first real `documents-rules` stamp in `pact-guide` — deliberately not run without an actual
  guide-content reconciliation pass (see that project's new `TASK_BOARD.md` entry).
- The next transfer of `pact-guide`'s canonical HTML into this repo's `docs/PACT-Players-Guide.html`,
  once that stamp exists — will also correct the currently-stale `v0.332` marker as a side effect.

## Related

- `docs/plans/2026-08-12-guide-engine-version-pointer.md` — full plan, cold-review triage, marker spec.
- `docs/VERSION-SYNC.md` — new cross-project section added in this change.
- `D-GH-2026-08-12-grit-steep-ladder`'s Outstanding section — where this follow-up was first named.
- `pact-guide`'s own `D-2026-08-12-guide-rules-pointer` — that project's half of this same change.
