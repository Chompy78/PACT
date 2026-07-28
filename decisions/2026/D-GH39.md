# D-GH39 — CharGen's ability-score steppers never reached the LOG (found via switch-tool manual testing)

Status: Active

- **Context:** the task owner manually tested D-GH38's switch button on Android Chrome, using CharGen's +/-
  ability-score steppers, and found the AP total never moved and the scores didn't survive a save or the
  switch. `st_STR`/`DEX`/etc inputs are `readonly` — the stepper buttons are the *only* way to change an
  ability score in the UI; there is no typing path to fall back on. Root cause: `stepAbil(a,d)` set
  `e.value` directly and called `render()`, but never dispatched an `input`/`change` event — so
  `_cgWirePatchDelegation`'s delegated listener (which calls `onPatchFieldChange` → the LOG mutation
  pipeline) never fired. The DOM number changed; nothing else did. **Confirmed live** (headless browser,
  a real `.click()` on the actual "+" button, not a scripted bypass): before the fix, clicking the STR
  stepper never moved `compute().total` or touched `LOG`; after, it did both correctly.
- **Decision:** `stepAbil` now dispatches a real bubbling `input` event on the field after setting its
  value, so it goes through the *exact same path* a typed value would — including
  `_setCoalesceForEvent(e)`, so repeated clicks group into sane undo steps, not one step per click.
- **Why:** this is the minimal, most consistent fix — it makes the stepper behave exactly like every other
  wired input instead of adding a second, parallel code path (e.g. calling `onPatchFieldChange` directly)
  that would skip the coalescing step and diverge from the existing architecture.
- **Severity note for future readers:** this was **live in production** and affected every player who ever
  used the ability-score steppers (the only way to set them) — a foundational character-creation step
  silently not costing AP or persisting, undetected until it was exercised carefully while testing an
  unrelated feature (D-GH38). Worth remembering as a reminder that a green `engine-parity` suite and a
  working save/load round-trip do not, by themselves, prove a UI control is wired to the model it appears
  to control.
- **Status:** DONE. Verified via a real Playwright `.click()` on the actual stepper button (not a scripted
  value/event bypass) in a headless browser: AP total moved 0→9 and `LOG` recorded the new stat after two
  clicks. CharGen's classic scripts syntax-check clean. No engine change; `DATA.version` unchanged.
