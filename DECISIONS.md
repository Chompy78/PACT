# PACT — Decisions (why it's built this way)

> Authoritative record of decisions **still in force**. One entry per decision:
> **Context → Options → Decision → Why → Status.** Newest at the TOP.
> `CHANGELOG.md` records *what* changed; this records *why*.

---

## D-GH2 · Carry the changelog / decisions / narrative discipline into the GitHub repo
- **Context:** the pre-GitHub Cowork project kept a rich `CHANGELOG.md`, `DECISIONS.md`, and session
  narratives. The new GitHub repo had an architecture instructions file (`pact-agent-instructions.md`) but
  no logging discipline — so context would stop travelling between AI sessions.
- **Options:** (i) keep the logging notes only in Cowork; (ii) move the three logging docs into the repo and
  make the AI-agent instructions require updating them on every change.
- **Decision:** (ii). One master instructions file (`AGENTS.md`, copied to `CLAUDE.md` +
  `.github/copilot-instructions.md`) now carries BOTH the architecture/PWA plan AND a "log as you go" rule
  that points every agent at `CHANGELOG.md` / `DECISIONS.md` / `docs/sessions/`.
- **Why:** in-repo docs version with the code and show up in every diff/PR, so the discipline is enforced by
  review instead of memory; one master file copied to the tool-specific names means Copilot and Claude both
  follow identical rules without re-pasting context each session.
- **Status:** IN FORCE.

## D-GH1 · Repo layout: one shared `js/engine.js`, tools are UI-only, deploy via GitHub Pages
- **Context:** moving PACT from Cowork (engine inlined into each standalone HTML tool) to GitHub Pages.
- **Options:** (i) standalone single-file tools with the engine inlined in each; (ii) centralise the engine
  in one `js/engine.js` and have the tools import it via a module bridge; (iii) both.
- **Decision:** (ii) — `js/engine.js` is the single source of truth; `tools/*.html` import it; the site is
  served by GitHub Pages at `/PACT/`.
- **Why:** one engine to edit means the three tools can never silently diverge; Pages gives a free public
  URL. Trade-off: tools are no longer single-file/offline (the PWA task restores offline via a service worker).
- **Status:** IN FORCE.

## D-014 · PHB pages + drawback text are display data — fill them, keep `DATA.version` v0.322
- **Context:** fill the weapon-mastery + A&T PHB page numbers and reconcile the 69 drawback descriptions,
  from a PHB-rules JSONL (entries carry a `page`) + Players Guide v0.324.
- **Decision:** masteries → p214; arts → matched 41/43 (Blessed/Druidic Warrior absent from the PHB feat
  list, left page-less); drawbacks → 53 identical, 10 synced to the guide, 6 split "Affliction" rows kept.
  `DATA.version` stays **v0.322**.
- **Why:** the 10 drawback diffs only add DEX/WIS cap clauses already enforced by `DATA.drawbackMaxStats` —
  display-only, so a version bump would misrepresent a mechanics change that didn't happen. `compute()`
  untouched (byte-identical). Applied as a surgical DATA edit, not a wholesale engine replace, because the
  live repo may be ahead of any snapshot.
- **Status:** DONE in the engine data; land it via `ENGINE-DATA-UPDATE.md`. **Open:** append "…capped at 10"
  to the 6 `Affliction —` descriptions for parity? (Caps already enforced.)
