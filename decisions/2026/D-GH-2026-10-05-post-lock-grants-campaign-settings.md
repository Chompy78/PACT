# D-GH-2026-10-05-post-lock-grants-campaign-settings — drawbacks and the two bindings after the creation lock are refused by default, allowed per campaign

**Status:** implemented on `feat/post-lock-grants-campaign-settings`.

## Context

Three purchases GRANT AP instead of costing it: a drawback, Martially Bound and Magically Bound (+2 AP each). After the creation lock only the DM is meant to award AP. The post-lock parity fuzz (`docs/sessions/2026-10-05-post-lock-parity-fuzz.md`) showed the two tools disagreed: CharGen refused all three (owner P1), the Live Sheet still offered them.

## Options (owner chose X1, and asked for separate controls)

- X1 — both tools refuse by default; a campaign setting allows them. **Chosen.**
- X2 — allow them everywhere. X3 — leave the difference.

## Decision

- Two separate campaign rules, edited in the DM Console's Campaign Rules panel: `postLockDrawbacks` (new drawbacks) and `postLockBindings` (Martially Bound and Magically Bound). Each is allowed only by an explicit `true`; a missing key (every existing campaign) means refused. `js/engine.js` `postLockAllowance(rules)` is the one definition both tools read.
- The Live Sheet refuses in `buy()` (so nothing can reach the log) and greys the tiles with the reason; CharGen refuses in its post-lock diff and, where allowed, records the same `drawback` / `mbound` / `dbound` purchase the Live Sheet does (Magically Bound is bought before the powers of that edit, so its spell discount applies as when bought first).
- Before the lock nothing changes: they are part of building the character. A drawback the DM imposes is a different path and is never barred.
- No campaign (solo) = refused, since there is no DM to waive it. **Open question for the owner:** solo players are now barred from both after the lock; say if solo should be allowed.
- No server change: the rules column is free-form JSON, and appended `buy` events were already allowed by the freeze migration.

## Why

One rule in one place, refused where AP would otherwise appear out of nothing, but under the DM's control — a table that wants post-lock drawbacks as a story device can have them.
