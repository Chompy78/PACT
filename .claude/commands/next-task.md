# PACT — work the next roadmap task

You help pick and complete the next task from the PACT roadmap. Other Claude Code sessions might be
working on this same repo at the same time, each in their own separate copy of the code (a "git
worktree"). **Never edit files directly in the main shared folder** — always work inside your own
worktree (set up in Step 4).

## Step 1 — get the latest information

Don't trust the files sitting in the shared folder right now — another session could switch branches
in that same folder while you're reading, so what you see on disk might not match what's really on the
`preview` branch. Instead, pull the real, current versions straight from GitHub:

```
git fetch origin
git show origin/preview:AGENTS.md
git show origin/preview:docs/PACT_ROADMAP.md
git show origin/preview:testing/tests/engine-parity.html
git show origin/preview:testing/expected/expected-results.csv
```

These tell you: the current rules for making changes, how to name your branch (`type/short-slug`), and
how many tests should pass right now (don't assume it's always 5 — check the actual file, since it can
grow over time).

If `git show` fails (e.g. no internet), fall back to reading the local copies of these files instead —
and mention that you had to do that.

## Step 2 — pick a task

- If I gave you a specific task name in `$ARGUMENTS` (a title, a short code, etc.), work on that one.
- Otherwise, open the roadmap and pick the topmost task marked `— TODO` in the **🔴 NOW** section, skipping
  any that are explicitly marked as blocked or waiting on something else.
- If nothing in 🔴 NOW is available, move to the **🟡 NEXT** section instead and say that's what you did.

Tell me in one sentence which task you picked and why. **Then stop and wait for me to say go** — don't
start any work yet.

## Step 3 — two quick checks before starting (after I say go)

**Check 1 — is someone already doing this?**
Work out the branch name (`type/short-slug`) this task would use, then run:
```
git ls-remote --heads origin <type/short-slug>
git branch --list <type/short-slug>
```
If that branch already exists, stop and tell me — don't pick a different task instead, and don't touch
that branch. It means someone (possibly another session) is already on it.

**Check 2 — effort & model calibration**
Assume the session is already running at **High** reasoning effort and on **Sonnet** — that's the floor
and the default for a full roadmap task (multi-file edits, running `engine-parity.html` to a pass count,
rebasing against `preview`, opening a PR). Don't verify this or ask me to confirm it; just proceed on that
assumption.

Instead, judge the task you picked in Step 2 against two escalation triggers, and only speak up if one fires:
- **Effort above High** (`xhigh`/`max`): only for a genuinely ambiguous judgment call, not routine roadmap
  work.
- **Model to Opus**: only if the task has real rework risk on Sonnet — a genuine architectural trade-off, a
  change that's expensive to get wrong (e.g. touches `js/engine.js` rules logic, data-model/migration
  decisions, or cross-tool contracts), or something you're not confident you can get right in one pass.

If neither trigger applies, say nothing and move straight to Step 4 — High/Sonnet stands, no confirmation
needed. If either applies, stop once and ask me about whichever fired in a single message (e.g. "this
touches engine.js rules logic — switch to Opus and/or bump to xhigh, or continue as-is?"). This is a
separate go/no-go from Step 2 — don't skip it even if I already said go once.

## Step 4 — set up your own worktree

Don't work inside the shared PACT folder for this task. Instead, create a separate folder just for this
work:

```
git fetch origin
git worktree add -b <type/short-slug> C:\Users\JohnChow\pact-worktrees\<short-slug> origin/preview
```

From here on, do all your reading, editing, and testing inside
`C:\Users\JohnChow\pact-worktrees\<short-slug>` — not the shared folder. Use full paths for every git
command so nothing depends on which folder you happen to be "in."

## Step 5 — do the work

Be efficient: read each file once, use search instead of reading whole files when you can, and make your
edits in one clean pass rather than going back and forth. Only touch `js/engine.js` if this specific task
is about the game engine — otherwise leave it alone.

Before calling it done:
- Run the test suite (`testing/tests/engine-parity.html`) and check it matches the pass count you saw in
  Step 1 — not a hardcoded number.
- Add a line to `CHANGELOG.md` (always). Add a note to `DECISIONS.md` too, if this change involved a
  non-obvious reason behind a choice you made.
- Remove the task from `docs/PACT_ROADMAP.md` and move it into `CHANGELOG.md`, in this same change.

## Step 6 — catch up before opening the PR

Other work may have landed on `preview` while you were busy. Bring your branch up to date:
```
git -C C:\Users\JohnChow\pact-worktrees\<short-slug> fetch origin
git -C C:\Users\JohnChow\pact-worktrees\<short-slug> rebase origin/preview
```
Fix any conflicts, then re-run the tests.

## Step 7 — push and open the pull request

Push your branch and open a PR targeting `preview`. Use your `CHANGELOG.md` entry as the starting point
for the PR description.

## Step 8 — clean up

Once the PR is open, remove your worktree folder (but leave the branch itself — cleaning up old branches
is a different, separate task, not part of this one):
```
git worktree remove C:\Users\JohnChow\pact-worktrees\<short-slug>
```

---

$ARGUMENTS
