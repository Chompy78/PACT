# D-GH46 — Communication conventions: recommend-with-reasoning, and a tool error is not an answer

Status: Active

- **Context:** two real failures this session prompted this. (1) `/pick-task`'s `AskUserQuestion` call
  errored once (a permission/stream failure); the retry was manual and undocumented, so nothing prevented
  a future session from silently treating that kind of error as if the Recommended option had been chosen.
  (2) `/close-session`'s own Output format instructed a flat action list with no recommend/don't-recommend
  distinction, so whether an item got called out as safe-to-run-now depended on the responding session's
  improvisation, not a written rule — inconsistent turn to turn. Separately, the user asked for a specific
  tiered `A`/`A1`/`A2` option-presentation format to be followed reliably, which had been getting lost
  because it was never written down anywhere durable.
- **Decision:** add a "Communication conventions" section to `AGENTS.md` covering all three, so every
  current and future skill inherits them rather than re-solving each per file: the tiered format (with
  every option requiring a stated reason, not just the recommended one); `AskUserQuestion` error handling
  (retry once for a genuine answer, never substitute a default, restate the answer before acting on it);
  and a recommend-by-default bar for follow-up-action lists (withhold only for destructive/irreversible
  actions, judgment calls only the user can make, or missing information). Updated `pick-task.md` and
  `close-session.md` to point at and apply these directly at their own decision points.
- **Why:** centralizing in `AGENTS.md` means a future skill that presents options or asks a question
  inherits the same reliability/format rules automatically, instead of each skill file re-deriving its own
  (and drifting, the way `close-session.md`'s flat list already had). The recommend-by-default bar
  specifically matches the user's stated preference ("get things done now rather than save them for
  later") — over-cautious deferral of already-verified, low-risk work was an explicit complaint, not just
  a formatting one.
- **Status:** DONE. Docs-only; no `js/engine.js` or `DATA.version` change; `testing/tests/engine-parity.html`
  unaffected.

---
