# D-GH35 — CharGen event-sourcing model: build-equality undo, authoritative file loads, and a non-locking budget award

Status: Active

- **Context:** Phase 2 Steps 4–5 made CharGen event-sourced end-to-end — snapshot-based undo/redo, event-log
  persistence `{schema,rules,name,budget,LOG,SEQ,id}`, and `name`/`budget` as first-class LOG events
  (`name`/`award`). Three sub-decisions in that work are non-obvious enough that a future agent would
  otherwise re-litigate them.
- **Options / Decisions:**
  1. **Undo restore = DOM-rebuild (build-equality), NOT `LOG = frame.log` (event-equality).** `restoreFrame`
     sets `LOG = f.log` then calls `applyBuild(foldBuild(f.log))`, which *rebuilds* the LOG from the DOM it
     just wrote (via `_buildEventBurst`) rather than keeping `f.log` verbatim. An internal first-pass review
     (finding **F2**) proposed making `LOG = f.log` the default to preserve exact event identity; the
     external cold reviewer argued against it, and the code settled it: CharGen's LOG is *already*
     regenerated synthetically (fresh `seq`/`ts`, blanket `noLock`) on **every** whole-build op, so exact
     event identity was never a guarantee. The contract is **build equality**, and the single canonical LOG
     builder is `_buildEventBurst`. `LOG = f.log` is kept only as a documented bug-containment fallback if a
     field ever fails to round-trip (it didn't). *(F2 was reversed.)*
  2. **A native saved file DOES reinstate the authoritative saved LOG** (`_cgApplyEnvelope` sets
     `LOG = d.LOG` verbatim after the DOM repaint) — the opposite of undo. Reason: `size` (and any
     compute-managed field parked in a hidden control) does **not** round-trip through `applyBuild`'s DOM
     re-derivation, and a persisted file must reload *exactly* as saved ("what you saved is what you load").
     Undo is an in-session op where build-equality suffices; a file load is a durable artifact where the
     stored LOG is authoritative. Different contracts for the two paths, on purpose.
  3. **The CharGen budget `award` must NOT lock undo history** (the roadmap's "AP-award lock semantics"
     turned out to be a *negative* requirement). In the Live Sheet an `award` locks history (actual-play
     integrity); CharGen budget is a freely-editable creation parameter, so it must stay undoable. CharGen's
     snapshot undo has no award-lock guard, so this is correct by construction; the award is tagged
     `noLock` to also stay out of the creation-pricing lock.
- **Why:** the LOG is a *build-equality artifact*, not a pristine event history — so undo optimises for
  surfacing `applyBuild`/`_buildEventBurst` divergence bugs (rebuild, don't mask), while file load optimises
  for exact reproduction (trust the saved bytes). Conflating the two would either mask bugs (undo) or lose
  compute-managed fields like `size` (load).
- **Status:** In force (build v0.200, on `main`). A back-compat reconcile in `_cgApplyEnvelope` heals older
  (Step-4) files whose top-level name/budget drifted from a stale LOG `name`/`award`.
