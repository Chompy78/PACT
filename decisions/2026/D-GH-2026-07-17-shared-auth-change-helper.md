# D-GH-2026-07-17-shared-auth-change-helper — Add onSessionChange(cb) to js/auth.js

Status: Active

> **Note (2026-07-28 migration):** no full Context/Options/Decision/Why/Status record existed for this entry in the original single-file `DECISIONS.md` — only an index-line summary. Preserved verbatim below rather than fabricating fields that were never written.

- **Summary:** Added `onSessionChange(cb)` to `js/auth.js`, a one-argument wrapper around `onAuthChange(event, session)` that structurally rules out the argument-order bug fixed 3 separate times at different call sites; migrated CharGen's 3 call sites and DM Console's 1 to it, but kept Live Sheet's single call site on the raw `onAuthChange` since it genuinely needs the event string for its `SIGNED_OUT` branch — the task's own step 1 explicitly permitted this, even though the "Done when" line's "all 5 call sites use it" reads more strictly; judged wrap-don't-replace correct because forcing Live Sheet through the session-only wrapper would mean either threading `event` back in as an optional 2nd argument (defeating the whole point of a can't-get-it-wrong single-argument signature) or subscribing twice, and the argument-order bug this task exists to prevent has only ever hit session-only call sites in practice, not the one site that legitimately needs the event
