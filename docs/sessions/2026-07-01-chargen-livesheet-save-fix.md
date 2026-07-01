# Session — 2026-07-01 · CharGen → Live Sheet save fix

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md`.*

## Goal
Investigate and fix the roadmap item "CharGen → Live Sheet button does not save character."

## Investigation
Traced the full flow: `readBuild()` → `buildToLiveLog()` → file download (CharGen) → `importJSON()` →
`save()` (Live Sheet, `localStorage`). Confirmed via a live browser round trip (export → import →
reload) that the happy path works correctly and persists across reload.

Root cause: both persistence points swallowed errors silently.
- `PACT-Live-Char-Sheet.html` `save()`/`load()` had empty `catch(e){}` around `localStorage`
  read/write. Simulated a blocked-storage condition (monkey-patched `Storage.prototype.setItem` to
  throw `QuotaExceededError`) — confirmed the import flow still showed "Loaded character." with
  nothing actually written, so the character would vanish on reload with zero indication anything
  went wrong. This matches real-world private/incognito browsing, storage quota, or storage disabled
  by the user/browser.
- `PACT-CharGen-Webtool.html` `exportToLiveSheet()` is `async` and invoked from a bare `onclick=` with
  no outer `try/catch` — any thrown error (e.g. from `readBuild()`/`buildToLiveLog()`) becomes an
  invisible unhandled promise rejection. Simulated by forcing `buildToLiveLog` to throw — confirmed no
  visible feedback prior to the fix (the reported "button does nothing" symptom).

## Fix
Added `console.error` + a visible `flash()` warning in both catch blocks, without touching the
success-path UI (no new messages on normal saves — `save()` is called after nearly every action, so
flashing on success would be noisy). Verified via browser: normal export/import/reload round trip
still works identically; simulated failures now surface a clear warning instead of failing silently.

## Verification
- `testing/tests/engine-parity.html`: 5 passed / 0 failed (no engine/compute change — this was
  display/integration-only, so `DATA.version` was not bumped per the roadmap note).
- Manual browser test via the preview static server: CharGen export → Live Sheet import → reload →
  character present; simulated storage failure → visible warning instead of silent data loss.

## Not done
No regression test file was added for the export/import path (roadmap step 5) — out of scope for a
minimal fix; flagged here if a future session wants to add one under `testing/`.
