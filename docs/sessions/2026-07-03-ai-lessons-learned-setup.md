# 2026-07-03 — ai-lessons-learned: design, build, and setup-in-progress

## What this is
A separate, private GitHub repo (`chompy78/ai-lessons-learned`) for durable, cross-project
lessons learned from AI-assisted coding — general knowledge that shouldn't live inside PACT
specifically, but should be loaded into every coding session, anywhere. This file exists so a
fresh session (which has no memory of this conversation) can pick up exactly where this one
left off, instead of re-deriving all of the design decisions from scratch.

## Final design (agreed)
- **Repo:** `ai-lessons-learned`. **Skill:** `log-lesson`.
- Structure: `INDEX.md` (small, auto-loaded) + `topics/*.md` (numbered, append-only entries,
  e.g. `H-001`) + `inbox/` (one new file per session, never edited by others) + `sessions/`
  (discretionary, rich narrative — same idea as this very file, but for that repo).
- Each entry: trigger (concrete scenario) + rule + `category`/`confidence`/`last-confirmed`/
  `source` metadata — so a review a year from now doesn't rely on anyone's memory.
- Curation: a scheduled GitHub Action reads `inbox/`, proposes new entries via an AI call
  (never rewrites existing ones), opens a PR; a second workflow auto-merges it after 24h if
  untouched. Full rationale and alternatives considered are in the plan doc (see below).
- On a **local/persistent Windows PC**: `~/.claude/CLAUDE.md` has
  `@C:\Users\<user>\ai-lessons-learned\INDEX.md` — confirmed working syntax (verified against
  Claude Code docs: `~` and absolute paths both supported for `@`-imports, one-time approval
  dialog, max 4 hops).
- On **remote/cloud sessions** (Claude Code on the web — no persistent home directory): a
  `SessionStart` hook does the equivalent job instead (see below).

## What's actually been done so far
1. **PACT `.claude/commands/next-task.md`** — fixed hardcoded Windows worktree paths to be
   OS-agnostic (this was the seed lesson, `H-001` in the new repo). Committed: `c670065`.
2. **PACT `.claude/commands/close-session.md`** — added a "9. Cross-project hints" check so
   PACT sessions flag general lessons for capture into `ai-lessons-learned`. Committed: `5a33f8b`.
3. **A full starter kit** for the `ai-lessons-learned` repo was generated and sent to the user
   as a tarball: `INDEX.md`, two seeded entries (`H-001` cross-platform, `H-002` containers),
   `scripts/curate.js`, both GitHub Actions workflows (`curate.yml`, `auto-merge-stale.yml`),
   templates, and a `SETUP.md` runbook.
4. **The actual GitHub repo `chompy78/ai-lessons-learned` has been created** and confirmed to
   exist (loads a real page in browser) — but as of this session, cloning it via a fine-grained
   PAT was still failing.
5. **A `SessionStart` hook was built in PACT** to solve the remote-session case:
   - `.claude/hooks/session-start.sh` — only runs when `CLAUDE_CODE_REMOTE=true`; if
     `AI_LESSONS_TOKEN` is set, clones/pulls `ai-lessons-learned` to `/tmp/ai-lessons-learned`
     and prints `INDEX.md` to stdout (which Claude Code surfaces as session context
     automatically); fails silently (never blocks session start) if the token or clone fails.
   - `.claude/settings.json` — registers that script under `hooks.SessionStart`.
   - Committed and pushed: `a0854f4`.
   - **Tested logic paths that work:** not-a-remote-session → silent no-op; remote but no
     token → warns to stderr, exits 0 without blocking.
   - **Not yet working:** the actual clone. Manually running
     `git clone https://x-access-token:$AI_LESSONS_TOKEN@github.com/chompy78/ai-lessons-learned.git`
     failed with `remote: Repository not found. / fatal: Authentication failed`, even though
     the repo demonstrably exists.

## Current blocker / what to check next (superseded — see "Retest result" below)
The user regenerated the fine-grained PAT and confirmed, on GitHub's token summary screen:
- Repository access: `Chompy78/ai-lessons-learned` (correct repo, singular, selected)
- Repository permissions: "Read access to metadata" + "Read and Write access to code" (this
  is the same thing as "Contents: Read and write" — just labeled differently on that summary
  screen)

That all looks correct on paper. The likely remaining gap: **the new token's value may not
actually have been saved into the `AI_LESSONS_TOKEN` environment variable yet**, or was saved
after this particular session's container had already started (environment variables are
fixed for the lifetime of a session — a change made mid-session is invisible to that session).

**Next step for a fresh session:** confirm the new token value is saved in the Claude Code on
the web environment's "Environment variables" field, then, in a **brand-new session** started
against that same environment, re-run:
```
git clone https://x-access-token:$AI_LESSONS_TOKEN@github.com/chompy78/ai-lessons-learned.git /tmp/test-clone
```
If that succeeds, also run `.claude/hooks/session-start.sh` directly (already committed to
PACT) with `CLAUDE_CODE_REMOTE=true` to confirm the whole hook works end-to-end, not just a
raw clone. Clean up `/tmp/test-clone` afterward.

## Retest result (2026-07-03, follow-up session) — root cause was NOT the token
Re-ran the clone in a fresh session against the same environment. `AI_LESSONS_TOKEN` was
confirmed present (93 chars). The raw clone still failed identically:
```
git clone https://x-access-token:$AI_LESSONS_TOKEN@github.com/chompy78/ai-lessons-learned.git
→ remote: Repository not found. / fatal: Authentication failed
```
Probing further, `curl -H "Authorization: Bearer $AI_LESSONS_TOKEN" https://api.github.com/user`
returned a real 200 (token is valid, resolves to `Chompy78`), but
`.../repos/chompy78/ai-lessons-learned` returned an **Anthropic-proxy** 403 —
`"GitHub access to this repository is not enabled for this session. Use add_repo to request
access."` — not a GitHub error at all.

**Actual root cause:** Claude Code on the web sessions route all `github.com`/`api.github.com`
traffic through a policy-enforcing egress proxy that injects the *session's own* scoped GitHub
App credentials (`gitConfigInjection: true` — see `/root/.ccr/README.md`), which override
whatever token is embedded in the clone URL or `Authorization` header. A session is only
authorized for the repos explicitly in its scope (here, just `chompy78/pact`); any other repo
gets rejected as "not found" regardless of PAT validity, correctness of fine-grained
permissions, or whether the env var is set. **The fine-grained PAT was a dead end for this
environment type from the start** — it can never work here, no matter how it's configured.

**The actual fix:** the agent must call the `add_repo` tool (owner=`chompy78`,
repo=`ai-lessons-learned`) from *inside* an agent turn — this grants the session GitHub scope
for that repo for the rest of the session, no PAT involved. After that, a plain
`git clone --depth 1 https://github.com/chompy78/ai-lessons-learned /workspace/ai-lessons-learned`
succeeded immediately (commit `e61dc0b`, `README.md` only — the starter kit tarball with
`INDEX.md`/`topics/`/workflows was never actually pushed to the repo).

**This breaks the `SessionStart` hook design as built.** `.claude/hooks/session-start.sh` does
a raw PAT-based `git clone` from a non-interactive shell script — it has no way to call
`add_repo` (an agent tool, not a shell command), so it will **never succeed** in a remote
session, independent of `AI_LESSONS_TOKEN`. Worse, `add_repo`'s own tool contract says it must
only be invoked when the user *explicitly* asks in that turn — which is fundamentally at odds
with "auto-load silently on every session start" with no per-session prompt. This is a real
design gap, not a config error: **the remote/cloud half of the original plan (SessionStart hook
+ PAT) needs to be rethought**, e.g. the agent explicitly calling `add_repo` itself early in a
session when the user's request is about `ai-lessons-learned` (as happened in this very
session), rather than a hook silently fetching it. Left for the next session to decide; not
fixed here since it's a scope/architecture change, not a "flip a bug" fix.

## Redesign decision (2026-07-03, same follow-up session) — remote hook now nudges, doesn't fetch
Considered three options for the remote/cloud half of the design once the PAT approach was
confirmed dead:
- **A — split into a private source repo + a public mirror of just `INDEX.md`** (auto-published
  by a GitHub Action on push, fetched by the hook via a plain unauthenticated `curl` of
  `raw.githubusercontent.com`). Empirically verified this domain is **not** gated by the
  session's GitHub-scoping proxy — tested with a public repo (`octocat/Hello-World`) and a
  public Gist totally outside this session's scope, both returned real `200`s; the private
  `ai-lessons-learned` repo's raw URL correctly `404`s unauthenticated, confirming the split
  would work exactly as designed. Rejected anyway — see decision below.
- **B — GitHub Pages on the private repo** — dead end, Pages built from a private repo still
  requires GitHub auth to view, so it hits the same scoping wall.
- **C — agent calls `add_repo` explicitly only when a task looks relevant** — fully private,
  fully manual, no automatic coverage on unrelated sessions.

**Decision: C.** The user expects to store a lot of session detail in this repo over time and
wants it to **stay private**, full stop — option A's "small public mirror" would have worked,
but pushing anything (even a curated index) to a public location was a bigger tradeoff than the
convenience it bought, especially before the repo has any real usage pattern to judge what's
safe to make public. Chose to keep everything private and accept manual-but-directed loading
instead.

**What changed as a result:** `.claude/hooks/session-start.sh` no longer attempts any `git
clone`/`AI_LESSONS_TOKEN` logic at all — in a remote session it now just prints a short,
fixed-cost reminder telling the agent that `chompy78/ai-lessons-learned` exists and to call
`add_repo` + read `INDEX.md` itself if the current task looks relevant. This removes the
`AI_LESSONS_TOKEN` dependency entirely (the env var can be deleted from the environment's
config whenever convenient — nothing in the repo reads it anymore) and trades "fully automatic
every session" for "near-zero token cost on unrelated sessions, full pull-in on relevant ones."

## Still outstanding after that (lower priority, not blocking)
- Historical backfill: mine `docs/sessions/*.md` and the generalizable parts of `DECISIONS.md`
  for lessons that predate this system, using an Explore-type agent.
- Decide whether to actually enable the `curate.yml` schedule (it needs an `ANTHROPIC_API_KEY`
  repo secret — a separate, small billing setup on console.anthropic.com, distinct from a
  Claude.ai subscription — the user was made aware of this and can defer it).
- The `templates/log-lesson-snippet.md` block only helps PACT so far; other projects need the
  same check pasted into their own session-closing equivalent to also feed this repo.
- The user is also replicating this whole setup across multiple Windows PCs — a full
  from-scratch guide (`SETUP-NEW-WINDOWS-PC.md`) was already written and sent for that.
