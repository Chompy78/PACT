# Session — 2026-07-01 · Docs discipline audit, CU-3, REV-10

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md` (D-GH12).*

## Goal
Review whether CHANGELOG, DECISIONS, and session docs were up to date after the recent run of
merges; backfill what was missing; add enforcement so future sessions don't drift.

## What we did

### Docs audit + backfill
Reviewed all three doc files against the 2026-06-30 merge history. Findings:
- **CHANGELOG** — current.
- **DECISIONS.md** — missing an entry for REV-04 (campaign RLS tightening). Added **D-GH12**.
- **docs/sessions/** — nothing from 2026-06-30. Added
  `2026-06-30-rev-series-sw-hardening-campaign-rls.md` covering REV-01–04, CU-5, SW hardening,
  and the dual-source AP feature.

### Docs discipline enforcement
Three changes to make the gap less likely to recur:
1. **AGENTS.md checklist** — step 4 now spells out when each doc is required (CHANGELOG always;
   DECISIONS if the *why* is non-obvious; sessions if discussion spanned multiple areas). Step 6 is
   new: after a successful merge, re-check all three docs before closing the session.
2. **`settings.local.json` hook** — `PostToolUse` on Bash fires a reminder whenever a `pr merge`
   command succeeds, injecting the three-point checklist into the conversation.
3. **`.gitignore` fix (REV-10)** — `.claude/` was tracked despite being in `.gitignore`. Replaced
   blanket rule with `.claude/*.json` so machine-specific config is ignored while
   `.claude/agents/` and `.claude/commands/` stay tracked as shared project context. Untracked
   `launch.json`; agents + commands untouched. (PR #54, merged.)

### CU-3 — Tidy root & test files (PR #45, merged, parity 5/0)
- Deleted `index.old.html` + `.tmp-verify.mjs`.
- Moved `campaign-test.html` + `sync-test.html` into `testing/`; updated relative paths
  (`./js/` → `../js/`, `login.html` → `../login.html`).
- Replaced `testing/README.md` stray repo description with a proper harness index.
- Graduated CU-3 from the roadmap.

## Notes
- `launch.json` is now untracked (gitignored). After the REV-10 merge deleted it from disk,
  it was recreated locally with the `autoPort` fix so the preview server works.
- D-GH13 (regression gate design) was also added to DECISIONS.md this session by the user.
