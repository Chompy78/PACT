# D-GH25 — Leaked-password-protection roadmap item retired, not enabled

Status: Active

- **Context:** the 2026-07-02 post-merge security audit flagged `auth_leaked_password_protection`
  (Supabase Auth checks new/changed passwords against HaveIBeenPwned) as disabled, and a roadmap item
  asked for it to be enabled by hand in the Supabase dashboard (no code/migration involved — Auth config
  isn't reachable via any MCP tool or SQL). On attempting the toggle, the project owner found Supabase
  gates this feature behind a paid plan tier.
- **Options considered:** (A) upgrade the Supabase plan to enable it; (B) leave the toggle off and drop
  the roadmap item.
- **Decision:** (B). The project owner declined to pay for a plan upgrade for this one feature.
- **Why:** cost/benefit — PACT is a hobby tabletop-tool suite, not a project with a security budget; the
  underlying risk (reused/breached passwords) is mitigated by the free `auth_leaked_password_protection`
  advisor continuing to flag it on every future security-advisor check, so the gap stays visible even
  though it's not fixed.
- **Status:** DONE (roadmap item removed; not revisited unless the plan tier changes or the owner
  reconsiders).
