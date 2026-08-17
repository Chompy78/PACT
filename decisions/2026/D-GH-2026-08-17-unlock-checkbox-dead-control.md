# D-GH-2026-08-17-unlock-checkbox-dead-control — the class-unlock checkbox was a dead control, so the unlocked price tier was unreachable; the fix is capture-phase delegation, not ordering luck

**Status:** Settled and implemented. No `DATA.version` change — this is UI plumbing, not rules.

## Context

`D-GH-2026-08-17-bundle-three-tier-pricing` gave every class-gated purchase three prices —
origin / unlocked (sticker) / cross-class — and `compute()` charges all three. Adding an end-to-end
test that the *displayed* row price equals the *charged* ledger price turned up something worse than
a display bug: in CharGen, **ticking "unlock \<class\>" did nothing at all**. `readBuild()` never saw
the class, no `unlockclass` event reached the LOG, and the checkbox silently sprang back. The entire
middle price tier was unreachable from the UI, and had been since Chunk 3 made that checkbox
LOG-backed.

Two independent causes, layered:

1. The checkbox was generated with an inline `onchange="render()"` — a leftover from when the DOM was
   authoritative. An element's own inline handler runs in the **target** phase, before any bubble
   listener on an ancestor. `render()` re-derives every checklist checkbox's `checked` from the LOG,
   found no `unlockclass` entry, and un-ticked the box. The delegated `onChecklistToggle` then read
   `checked === false` and took the **retract** path.
2. Removing the inline handler was not enough. `#form` also carries a bare
   `addEventListener('input', render)` (and `change`), and a checkbox click fires `input` *first*.
   Same outcome one event earlier.

The bug is invisible to a synthetic test. `el.checked = true; el.dispatchEvent(new Event('change'))`
skips the `input` event entirely and passes — which is exactly how the first draft of the new e2e
section "passed" while reporting `unlockedClasses: []` right next to it.

## Options

- **A1 — Reorder listener registration** so the checklist delegation is wired before `#form`'s
  `render` listeners. Smallest diff. Rejected: same-phase, same-node ordering is registration order,
  which is bootstrap-order luck. Anyone adding a listener later re-breaks it silently, and nothing
  states the constraint.
- **A2 — Have `render()` skip checkboxes mid-interaction** (a re-entrancy guard). Rejected: makes
  `render()` stateful about who called it, and the guard has to be right for every category.
- **A3 — Bind the delegation in the CAPTURE phase, for both `input` and `change`.** Chosen. Capture
  on an ancestor runs before the target's own handlers and before every bubble listener, regardless
  of registration order — so the LOG-mutating handler observes the user's actual intent by
  construction, not by arrangement. The inline `onchange="render()"` is deleted as redundant
  (`emit()` and `retractFlatEvent()` both render already).

## Decision

A3, plus the inline-handler removal. Handling both `input` and `change` is safe because
`onChecklistToggle` is already idempotent in each direction: an emit is skipped when the LOG holds
the value (`_hasEntry`), and a retract is a no-op when it doesn't (`findIndex === -1`). Verified: one
real click produces exactly one `unlockclass` LOG entry despite the handler firing twice.

## Why

The invariant that matters is *the handler that mutates the LOG must see what the user did*.
Registration order does not express that; the capture phase does. It is also the only option that
survives someone adding another `change -> render()` listener next year without reading this file.

## Status / verification

- `chargen-flows-e2e.mjs` gained a section that drives a **real click** and asserts the row price
  equals the ledger price at all three tiers, that the three tiers are genuinely distinct, and that
  un-ticking retracts. 46 → 56 checks, all green; the other 46 unchanged.
- The same section covers the display half of the defect: the row `.price` spans (features, subclass
  abilities, bundles) knew only origin/cross and showed `cross` for an unlocked class while the
  ledger charged the sticker — a bundle read 11 AP and cost 8. All three now route through one
  `PRC(o,u,x)` helper in `render()` so they cannot drift apart again.
- Fixtures `CG-012`/`CG-013` pin the engine side of the three tiers independently of the UI.
