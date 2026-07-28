# D-GH20 — `ai-lessons-learned` auto-load in remote sessions: nudge-and-let-the-agent-decide, not auto-clone

Status: Active

- **Context:** a `SessionStart` hook (`.claude/hooks/session-start.sh`) was built to auto-load a
  separate, private cross-project repo (`chompy78/ai-lessons-learned`) into every remote/cloud
  session's context, using a fine-grained PAT (`AI_LESSONS_TOKEN`) to `git clone` it. Retesting
  with a freshly regenerated, correctly-scoped PAT still failed identically. Root-caused: remote
  sessions route all `github.com`/`api.github.com` traffic through a policy-enforcing proxy that
  injects the *session's own* scoped GitHub App credentials, overriding any PAT in the URL —
  a session can only reach repos in its explicit scope, and `ai-lessons-learned` wasn't in it.
  The only working fix was calling the `add_repo` agent tool from inside a turn — which a
  non-interactive shell hook cannot do, and which is documented to be invoked only when a task
  actually calls for it, not unconditionally every session.
- **Options considered:** (A) split into a private source repo + a public mirror containing only
  `INDEX.md`, auto-published by a GitHub Action, fetched by the hook via a plain unauthenticated
  `curl` of `raw.githubusercontent.com` — empirically verified viable (that domain is *not*
  gated by the session's GitHub-scoping proxy: tested against a public repo and a public Gist
  fully outside this session's scope, both returned real content; the private repo's raw URL
  correctly 404s unauthenticated); (B) GitHub Pages built from the private repo — dead end, Pages
  from a private repo still requires GitHub auth to view, hitting the same scoping wall; (C) drop
  automatic fetching entirely — the hook just prints a short reminder in remote sessions, and the
  agent calls `add_repo` + reads `INDEX.md` itself only when the current task looks relevant.
- **Decision:** (C). Rewrote `.claude/hooks/session-start.sh` to remove all `git
  clone`/`AI_LESSONS_TOKEN` logic; it now only prints a fixed, small reminder string in remote
  sessions pointing at the repo and telling the agent to pull it in itself if warranted.
  `AI_LESSONS_TOKEN` is no longer read anywhere in this repo.
- **Why:** the user expects `ai-lessons-learned` to accumulate a lot of private session detail
  over time and wants it to stay **fully** private — not "mostly private with a small public
  index," which is what option A would have required (once `INDEX.md` is published anywhere
  public, even a curated summary, it's a permanent trust boundary: cached/scraped copies can
  outlive a later switch back to private). Given that, the token cost of "fully automatic every
  session" (paying to load `INDEX.md` even on sessions that never touch it) was judged not worth
  crossing that boundary for. Option (C) trades full automation for near-zero cost on unrelated
  sessions and a full pull-in on sessions that actually need it.
- **Status:** DONE. Hook rewritten and verified (remote: prints reminder, exit 0; non-remote:
  silent, exit 0). Local-machine loading (`~/.claude/CLAUDE.md` `@`-import of `INDEX.md`) is
  unaffected — it never went through this proxy in the first place.

---
