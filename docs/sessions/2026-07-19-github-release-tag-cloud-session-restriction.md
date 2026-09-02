# Session: Why Claude can't tag/release from a cloud session (and what actually works)

> **Scope corrected 2026-09-02.** This note was written about tags and releases and closed by asking,
> as an open question, whether *other* ref writes (deleting a remote branch) hit the same wall. They
> do — confirmed four separate times since, listed under "What's still open" below. The underlying
> rule quoted in step 2 (**git push is restricted to the current working branch**) already predicted
> it: a branch that is not the one checked out is no more "the current working branch" than a tag ref
> is. Read this note as covering **remote ref writes generally**, with releases as a separate,
> API-level block on top.

**Date:** 2026-07-19 · **Decision:** none logged in `DECISIONS.md` (this is an environment/platform
constraint, not a PACT architectural choice — nothing in this repo to reverse or reconsider)

Why this note exists: asked to bump `BUILD` to v0.203 and tag/release it, this session hit a hard
platform-level 403 on both the git-level tag push *and* the GitHub API release-creation call. The user
then asked for a long-term fix ("I want you to be able to do it for me"). Research showed this is not
fixable from inside a cloud/web session — worth recording precisely so a future session doesn't
re-diagnose the same thing from scratch, and doesn't waste effort adding a personal PAT that won't help.

## What was tried, in order

1. **Plain git tag + push** (`git tag -a v0.203 <sha> && git push origin v0.203`): tag created fine
   locally; push failed `HTTP 403`, retried once (transient-failure convention), same result.
2. **Read Claude Code's own docs** ([Use Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web),
   `#github-proxy` section) — found the exact, documented reason:
   > "The proxy also restricts git push operations to the current working branch for safety..."

   A tag ref (`refs/tags/*`) is never "the current working branch," so this is a **deliberate,
   permanent restriction**, not a bug or a scope gap — every tag push from a cloud session will 403,
   regardless of which branch is checked out.
3. **`gh release create` / `gh api .../releases` (POST) via the GitHub REST API**, reasoning that a
   *release* is a server-side API call (not a git push), so it might not be caught by the
   branch-restricted git proxy:
   - Installed `gh` in-session (`apt install -y gh`) — not pre-installed, per the same docs page.
   - Confirmed `GH_TOKEN` was already the documented `proxy-injected` placeholder (checked without
     printing the actual value — the harness's safety classifier denies raw `echo $GH_TOKEN`, correctly,
     since that risks leaking a secret into the transcript even when the value itself is a placeholder).
   - `gh release list` failed — the proxy blocks `gh`'s default GraphQL transport outright
     (`"only the pinned set of PR-review operations is served"`), but explicitly pointed at the fix:
     `gh api repos/{owner}/{repo}/...` (REST). Retried that way and **reads worked** (listed existing
     releases fine).
   - `gh api repos/.../releases -X POST` (the actual release-creation call) returned a clean, explicit
     403: `"Creating, editing, or deleting releases is not permitted for this session type."`

That error text is the key finding: it names **the session type**, not a missing scope or an
unauthenticated request. A real personal-access-token (`GH_TOKEN` set explicitly, bypassing the
proxy-injected placeholder) would very likely hit the identical block, since "For security, all GitHub
operations go through a dedicated proxy service" (same docs page) — the proxy intercepts and rejects the
*operation*, before it would ever reach the point of checking whose token was attached. This wasn't
tested empirically (would require the user to generate and expose a real PAT just to prove a very likely
negative), so treat it as strong inference, not a confirmed fact — see "What's still open" below.

## Why this probably exists (informed guess, not documented)

Tags and releases are more "public-facing" than a branch push or even a PR — a Release notifies
watchers, appears on the repo's front page, and (unlike a PR) has no required review gate before it's
visible. Restricting an autonomous cloud session to branch-scoped git operations (which still require a
human to open/merge a PR to have any real effect) while blocking the two operations that publish
something directly and irreversibly fits the same shape as the already-known "push access ≠ delete
access" pattern (this repo's `ai-lessons-learned` H-020) — just applied to a different pair of
operations. Anthropic hasn't published the specific rationale as far as this session found; don't state
this as confirmed policy reasoning if it comes up again, only as a plausible read of the evidence.

## What actually works (recommended path forward)

- **No GitHub MCP tool routes around any of this.** Checked again on 2026-09-02: the tool surface has
  `create_branch` but no branch/ref delete, and `get_tag`/`list_tags`/`get_release_by_tag` are all
  read-only. Confirmed independently in the 2026-07-11, 2026-07-14 and 2026-08-20 sessions. Do not
  spend time looking for one.

- **Local Claude Code (terminal-installed, not web/cloud)** authenticates with the user's own real
  GitHub credentials directly (`gh auth login`, or a locally-configured token) — it does not route
  through this session-scoped, operation-restricted proxy. Tag/release creation from a local session
  should work normally. This is the practical "have Claude do it for me" answer: run that specific
  action from a local session, not a cloud/web one.
- **The GitHub web UI** remains the fallback for a cloud session, as before — draft the tag/target/notes
  in chat, human pastes/clicks. See the existing `ai-lessons-learned` entry
  (`2026-07-19-github-release-tag-old-commit.md`) for the exact URL-parameter trick when the target
  commit isn't the branch tip GitHub's UI defaults to.

## What's still open

- Whether a **user-supplied `GH_TOKEN`** (not the `proxy-injected` placeholder) actually bypasses the
  release-creation block was not tested — the reasoning above says it's unlikely to help, but nobody has
  confirmed it fails. Worth a cheap, low-stakes test *if* a future session has a disposable/scoped PAT
  handy anyway — not worth generating one solely for this test given the security trade-off (no secrets
  store yet; an env var is visible to anyone who can edit the environment).
- ~~Whether *other* write operations this session hasn't tried (e.g. deleting a remote branch, editing
  repo settings, managing webhooks) hit the same "not permitted for this session type" wall is unknown;
  this note covers tags/releases only.~~ **Answered for remote-branch deletion: it is blocked too.**
  Confirmed independently four times, so this is settled rather than anecdotal:
  - **2026-07-11** — five merged branches left on GitHub; "remote branch deletion 403'd from this
    session's credentials (no GitHub MCP tool covers it either)", matching `ai-lessons-learned` H-020
    (*push access ≠ delete access* for remote-session creds).
  - **2026-07-14** — `fix/shared-ui-helpers-esc`: "the remote branch delete failed with an HTTP 403
    from the git remote."
  - **2026-08-09** — a stray `release/promote-v1391`: 403, logged there as "same class as the
    tag-push restriction".
  - **2026-09-02** — `claude/feature-cost-customization-s8bnk3` after PR #496 merged: the delete died
    with `send-pack: unexpected disconnect while reading sideband packet` / `fatal: the remote end hung
    up unexpectedly`. **Worth knowing the shape**: a branch delete does not always surface a clean
    `403` the way a tag push does — it can present as a transport error, which reads like a network
    blip and invites a pointless retry. Check `git ls-remote --heads origin <branch>` to tell the two
    apart; the ref still being there means blocked, not flaky.

  **Tag deletion is likewise blocked** (`D-GH-2026-08-20-tag-only-meaningful-promotions`, step 2),
  which `docs/VERSION-SYNC.md` step 6 already records as "creation **and deletion**".

  So the practical rule for a cloud session is: **it can push its own working branch, and nothing
  else.** Creating a branch is fine (it is a push); deleting any ref — a tag, or a branch other than
  the one checked out — is not. Plan branch and tag cleanup as a human step; do not budget a cloud
  session's time for it.

- Still genuinely untested: **editing repo settings** and **managing webhooks**. Nobody has tried
  either, so do not assume from the above that they fail — or that they work.
