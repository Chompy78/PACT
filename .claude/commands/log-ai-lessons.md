# PACT — mine a session for cross-project lessons

You read a session, session file, or transcript and draft candidate entries for the separate,
private `chompy78/ai-lessons-learned` repo. This is a **report-only** pass for the drafting
step — never write to `inbox/`, commit, or push without approval, same convention as
`/close-session`'s item 9 (which this command supersedes as the reusable, standalone version
of that same check).

## Step 1 — figure out the source

`$ARGUMENTS` is a file path, a directory, a glob, or empty:
- **Empty** — mine *this session's own conversation* so far (the same thing `/close-session`
  item 9 does, but callable any time, not just at close).
- **A single file** — a `docs/sessions/*.md` entry, an exported/teleported transcript
  (`claude --teleport` + `/export`), a `DECISIONS.md` excerpt, or similar. Read it directly.
- **A directory or glob matching several files** (e.g. a historical backfill across
  `docs/sessions/*.md`) — don't read them all inline. Delegate to a `general-purpose` agent:
  give it the file list, ask it to read everything and return only the drafted candidates
  (trigger/rule/category/confidence/last-confirmed/source, one per lesson) as compact text —
  not the raw source content. This keeps the bulk of the reading out of your own context.

## Step 2 — make sure you can see the repo, and what's already in it

- **Remote/cloud session:** if `chompy78/ai-lessons-learned` isn't already cloned locally this
  session, call `add_repo(owner="chompy78", repo="ai-lessons-learned")` yourself (you're the
  agent running this command — this is fine here, unlike a `SessionStart` hook, which can't do
  this; see `DECISIONS.md` D-GH20), then `git clone --depth 1` it if the clone doesn't already
  exist.
- **Persistent local machine:** use whatever local clone already exists (see
  `SETUP-NEW-WINDOWS-PC.md` if one was sent to you, or just `git clone`/`git pull` it yourself
  the normal way — this is a private repo your own machine's GitHub auth already has access to,
  no proxy-scoping issue applies locally).
- Read the current `INDEX.md` so you don't draft a duplicate of something already covered.

## Step 3 — draft candidates

For each genuinely new, generalizable lesson you find (not specific to PACT, or whatever
project the source came from), draft it in exactly this shape (matches
`templates/log-lesson-snippet.md` in `ai-lessons-learned`):

```markdown
## Candidate: <short title>
- **Trigger:** <the concrete scenario — specific enough a future reader recognizes it>
- **Rule:** <the generalized, actionable rule>
- **category:** <slug>
- **confidence:** <low|medium|high>
- **last-confirmed:** <today's date>
- **source:** <what you read this from — file path, session, repo/PR>
```

Be selective, not exhaustive:
- Skip anything project-specific that doesn't generalize.
- Skip anything already covered by an existing `INDEX.md` row.
- Skip vague or unactionable observations — a lesson needs a concrete trigger and a concrete
  rule, not just "be careful with X."
- Don't guess an `H-###` number — `scripts/curate.mjs` assigns the real one later from the live
  `INDEX.md` at curation time; leave IDs out of your draft entirely.

## Step 4 — show candidates for approval

List every drafted candidate, numbered (`C1`, `C2`, ...), each with its one-line trigger and
rule visible in the list itself (not just buried in the full block) so the user can decide
without opening anything else. If you found none, say so plainly — don't force an entry that
doesn't earn its place.

Ask once which candidates (if any) to commit: "Write C1 and C3? Say the letters, or 'none'."
Wait for that reply.

## Step 5 — write, commit, push (only approved candidates)

For each approved candidate:
1. Write it as its **own new file** — `inbox/<today's date>-<short-slug>.md` — never bundle
   multiple candidates into one inbox file (breaks `curate.mjs`'s one-file-per-submission
   assumption) and never edit an existing `inbox/` or `topics/` file directly.
2. Commit (`feat(lessons): add inbox candidate <slug>` or similar) and push to `main` on
   `chompy78/ai-lessons-learned`.

Report back the filenames written and confirm they're pushed. Remind the user (briefly) that
`curate.yml` will pick them up on its own schedule, or that they can `workflow_dispatch` it
themselves for an immediate run.

---

$ARGUMENTS
