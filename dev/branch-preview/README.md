# PACT branch preview

A local web page that lists every branch (local and remote), shows what's actually in it (last
commit, ahead/behind `preview`, open PR if any), and loads any one of them into a running local
copy of the app with one click — no manual `git checkout` / `python -m http.server` dance.

## Run it

```
node dev/branch-preview/server.mjs
```

Then open **http://localhost:8737**.

## How it works

- Reads branch info straight from this repo (`git for-each-ref`, `git fetch --prune` on each
  refresh) — it never writes to it.
- All checkouts happen in a **separate worktree** it owns entirely
  (`dev/branch-preview/worktree/`, gitignored) — your actual working directory, and anything a
  Claude Code session might be doing in it, is never touched.
- Every "Load" checks out **detached at a specific commit**, never a branch name, so it can never
  collide with a branch already checked out elsewhere (including this repo's own working directory)
  and can never accidentally commit onto a shared branch pointer.
- The loaded branch is served at `/PACT/...` — same base path the real app expects (manifest scope,
  service worker precache list), so it behaves exactly like the deployed site.

## Notes

- Port `8737` by default; override with `PORT=xxxx node dev/branch-preview/server.mjs`.
- PR status is fetched on demand (click "PR?" next to a branch) via `gh`, not on every page load —
  keeps the branch list fast and doesn't fail if `gh` isn't signed in or installed.
- No new dependencies — plain Node (`http`/`fs`/`child_process`), matching this project's
  no-npm-for-the-app-itself convention. This is dev-only tooling, same class as `testing/scripts/`.
