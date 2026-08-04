# Review reports

Output of `docs/review-prompts/*.md` runs. One file per pass, named `<date>-<kind>.md`.

Kept so a later pass can be diffed against an earlier one — the useful question after a round of
fixes is "what did we actually close, and what came back", which needs the previous report on disk.

These are findings, not decisions. A finding that gets acted on graduates into `CHANGELOG.md` (and
`DECISIONS.md` if the *why* is non-obvious) like any other change; a finding that gets rejected
should be struck through here with a one-line reason rather than deleted, so the next review does not
re-report it.
