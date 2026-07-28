# D-GH-2026-07-15-wire-audit-py-into-ci — audit.py's default checks wired into CI; --rls stays manual

Status: Active

- **Context:** `testing/scripts/audit.py`'s own docstring said its checks (SW cache integrity,
  manifest/PWA correctness, engine-symbol drift guard, build-version mirror sync, and an `--rls`
  mode that live-proves Supabase RLS rejects unauthorized writes) should run "eventually in CI" — no
  workflow called it, so a regression only got caught if a human remembered to run it by hand.
  `DECISIONS.md` already notes this project has "been bitten twice by" grant/RLS drift that internal
  guards masked, making the RLS-adjacent half of this gap the higher-stakes one.
- **Options:** (a) add a step to the existing `engine-parity.yml` workflow; (b) a new dedicated
  workflow file; for the `--rls` mode specifically: (c1) wire it into CI using a GitHub Actions secret
  against a dedicated test Supabase project, or (c2) keep it manual-only and document that choice
  explicitly so "not wired into CI" can't again silently read as "wired."
- **Decision:** (b) a new `.github/workflows/static-audit.yml`, path-filtered to the files
  `audit.py`'s checks actually cover (service worker, manifest, icons, assets, the three tools,
  `js/engine.js`) rather than piggybacking on `engine-parity.yml`'s narrower engine/testing-only path
  filter. For `--rls`: (c2) — kept manual-only, documented in both `testing/README.md` and the new
  workflow's header comment.
- **Why:** `engine-parity.yml`'s path filter is deliberately scoped to `js/engine.js` +
  `testing/**` — folding audit.py's much broader file surface into it would either over-trigger that
  workflow on unrelated changes or under-trigger the audit on the SW/manifest/icon changes it exists
  to catch; a separate workflow keeps both path filters honest. The `--rls` proof needs a live
  Supabase project's real credentials as a GitHub Actions secret — standing one up (or confirming an
  existing test project is safe to point CI at) is a decision with its own security surface, not
  something to default into as a side effect of a CI-wiring chore. Manual-only, loudly documented, is
  the choice that can't silently regress into "nobody remembers this is manual."
- **Status:** in force. Revisit if/when a dedicated test Supabase project + secret exists.
