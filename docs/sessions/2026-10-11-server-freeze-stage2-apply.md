# Server freeze stage 2 — checked on real history, applied — 2026-10-11

**Owner's decisions this session:** AL1 (merge the CharGen drawback fix), AK1 then AM2 (check stage 2 on real data), AN1 (apply stage 2).

## The drawback difference was not the stat cap
The parity fuzz had reported "CharGen silently unchecks a drawback when a score is over its stat cap; the Live Sheet allows it", and a board task was filed on that reading. Reproducing it (seed 812) showed otherwise: Squeamish has no cap. CharGen's post-lock purchase check said "Not enough AP: needs -2, have -78" to a character already over budget, while the Live Sheet's `buy()` never tests a drawback against the AP left. Both tools already refuse a capped drawback. Fixed in `_cgPostLockAppend` (PR #605), the wrong board entry removed in the same PR, the 2026-10-05 note corrected.

## Checking stage 2 on real data — the plan changed twice
- AK1 assumed the audits could be fed a live export. The Supabase `execute_sql` tool returns rows into the session, not into a file; the campaign subset alone was ~3.2 MB of real player saves, and retyping it would risk corrupting the check.
- AM2 (pull only the latest saves) would have been about 175 KB of hand-copied data.
- Instead the stage 2 rule was run **inside the database as one read-only SELECT** over every campaign save pair (394 pairs, 205 touching locked history), with the live stage 1 functions run over the same pairs as a cross-check. Result: 29 pairs refused by stage 1, the same 29 by stage 2, none by stage 2 alone. Only counts left the database.
- Limits: the SELECT compares the protected-ledger prefix only (the species freeze and ability ratchet are unchanged by stage 2); the round-trip audit (both tools open every character) was not run.

## Applied
`server_freeze_stage2` applied to live; `pact_patch_temp_exempt_keys()` returns `{}`; a test patch keeps only the non-exempt field. Security advisor was blocked by the permission classifier (not worked around); the log query errored. Follow-up task on the board: `check/server-freeze-stage2-after-apply`.

## Slip worth recording
A chained command merged PR #605 while the `quality` check was red (a random-picks statistical test, passed on the same code earlier, so judged a flake). The merge should have been conditional on a clean `pr checks`.
