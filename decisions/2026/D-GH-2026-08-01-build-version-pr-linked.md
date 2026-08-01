# D-GH-2026-08-01-build-version-pr-linked — `BUILD` is now the `preview`→`main` promotion PR number, not a manual counter

Status: Active

- **Context:** Follow-up discussion after merging PR #289 (the `listCharacters()` leak fix). The user
  asked whether the tools' cosmetic `BUILD` label (`js/engine.js`'s `export const BUILD`, currently
  `v0.203`) could be tied to the PR number instead of the existing manually-incremented `v0.10x`
  counter, then asked whether the git release **tag** could be combined with that PR link too.
  Confirmed by inspection: `BUILD` is purely a display label (`index.html` just prints
  `'Build ' + BUILD`; no code anywhere compares or parses it as a version), so changing its source has
  no functional blast radius — this is a process/traceability change, not a code-behavior one. Also
  confirmed the existing git tags (`v0.200`–`v0.203`) already point at commits on `main`, and three of
  the four (`v0.200`→PR #242, `v0.201`→PR #257, `v0.202`→PR #266) are literally "Merge pull request #N
  from Chompy78/preview" commits — i.e. the **promotion** PR, not the individual feature PR that made
  any given change. A promotion typically bundles several feature PRs merged into `preview` since the
  last release.
- **Options considered:**
  - **Tie `BUILD` to the feature PR number** (the PR that actually makes the tool-facing change,
    merged into `preview`) — rejected for the *tag*-combining half of the ask: since a promotion
    bundles many feature PRs, the tag (which lives on the promotion commit) would only reflect
    whichever feature PR last happened to bump `BUILD`, silently dropping every other bundled PR from
    the traceable record even though they shipped in the same release.
  - **Tie `BUILD` to the promotion PR number** (`preview`→`main`) and bump it as the last step of that
    same promotion PR, chosen. The tag naturally lives on the promotion commit already, so this makes
    `BUILD` and the tag **the same number, on the same commit, from the same PR** — genuinely combining
    the two asks into one identifier. Also removes an existing hazard: bumping `BUILD` inside
    individual feature PRs (the old procedure, per `docs/VERSION-SYNC.md`'s prior "1. Change BUILD in
    js/engine.js" step with no stated owner/timing) meant two concurrent feature branches could each
    reasonably guess the same "next" `v0.20x` value — the identical shared-mutable-counter race already
    called out for the retired sequential `D-GH<N>` decision-numbering scheme. A promotion is
    inherently serial (one `preview`, one `main`, one promotion PR at a time), so there's no concurrent
    guess to collide with, and GitHub assigns the PR number atomically the moment it's opened — no
    "check remote for highest existing number" step needed at all.
  - **Status quo** (independent manual counter) — rejected: gave no way to look at a running build and
    know what shipped in it without cross-referencing `CHANGELOG.md` by date/guesswork.
- **Decision / what shipped:** `docs/VERSION-SYNC.md` rewritten: `BUILD` format is now `v<PR#>` (e.g.
  `v268`), bumped exactly once as part of the promotion PR (open the promotion PR first to obtain the
  number, then push one commit inside it setting `BUILD` + mirroring the four tool labels, per the
  existing mirror list — unchanged). Feature PRs into `preview` never touch `BUILD`. After merge, the
  resulting `main` commit is tagged with the same `v<PR#>`. `AGENTS.md`'s Versioning section updated to
  match. `DATA.version` (the separate rules-version axis) is completely unaffected by this change —
  still bumped by whichever feature PR changes mechanics, on its own independent schedule.
- **Why:** worth a full record because a future agent following the old `docs/VERSION-SYNC.md`
  procedure (bump `BUILD` as part of a regular feature-PR checklist) would now be doing something this
  repo has deliberately moved away from — the doc alone states the *what*, this record preserves the
  *why* (the race-condition parallel to `D-GH<N>`, and the "tag and PR should be the same number, on
  the same commit" reasoning that specifically required anchoring to the *promotion* PR rather than
  the feature PR).
- **Status:** IN FORCE. Verified before writing: `index.html`/`js/sync.js` grepped for any code that
  parses or compares `BUILD` as a real version (none — display-only, confirmed by reading every match).
  Read `testing/scripts/audit.py`'s build-version-mirror check directly (not assumed): the `js/engine.js`
  source-of-truth extraction is a free-form quoted string (any format), but the three per-tool mirror
  patterns match `v[\d.]+` specifically (digits and dots only, dot not required) — a plain `v268` (all
  digits, no dot) satisfies that pattern, so the new format passes the existing guard unchanged with no
  code change needed there. No `js/engine.js` rules logic touched; `engine-parity-ci.mjs` not affected
  by a docs-only change (still expected 20/0, unchanged from before this record). The actual next
  promotion PR is the first live test of the new procedure — not yet exercised as of this record.
