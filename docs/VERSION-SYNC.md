# PACT version sync

Two **separate** version numbers live in this repo. Don't conflate them.

| Axis | What it is | Where it lives |
|------|-----------|----------------|
| **Build version** (`vNNN`, = a GitHub PR number) | Cosmetic web-tool/build number | `js/engine.js` → `export const BUILD` (**single source of truth**), mirrored by the 3 tools |
| **Rules version** (`v0.3xx`) | The rules dataset | `DATA.version` inside the engine + each tool |

## Build version — now derived from the promotion PR, not a manual counter

**As of D-GH-2026-08-02-build-version-pr-linked**, `BUILD` is the number of the GitHub PR that
promotes `preview` → `main` (e.g. `v268` for PR #268), not an independently-incremented `v0.10x`
counter. This is a deliberate change — see that decision record for the full reasoning — but the
short version: a manually-picked "next" number is a shared mutable counter across concurrent
branches (the exact hazard already documented for the old `D-GH<N>` decision-numbering scheme), and
it gave no way to look at a running build and know what actually shipped in it. A promotion PR's
number is assigned atomically by GitHub the moment it's opened (no guessing, no collision risk), and
`github.com/Chompy78/PACT/pull/<N>` **is** the exact diff that build contains.

**Feature PRs into `preview` never touch `BUILD`.** Don't bump it as part of a regular task —
only the promotion step below does.

`js/engine.js` holds the canonical build number:

```js
export const BUILD = "v268";
```

Everything else must **match** that value:

- `tools/PACT-CharGen-Webtool.html` — line-1 comment, `<title>`, and the header `<span class="sub">Web Tool · vX</span>`
- `tools/PACT-Live-Char-Sheet.html` — line-1 comment
- `tools/DM-Console.html` — `var TOOL_VERSION = 'vX'`
- `index.html` — **don't touch.** It reads `BUILD` from `js/engine.js` at load and displays it, so it can never drift.

## Promoting `preview` → `main` (the only time `BUILD` changes)

1. Open the promotion PR (`preview` → `main`) first — this is how the number is obtained; GitHub
   assigns it the instant the PR exists, so there's nothing to bump before this step.
2. Push one commit to that same PR setting `BUILD` in `js/engine.js` to `v<PR#>`, then sync the four
   tool labels above to match (see the one-line prompt below).
3. Leave `DATA.version` alone — it's the separate rules-version axis, bumped only when mechanics
   change, and is untouched by this procedure regardless of which feature PRs are in the promotion.
4. Merge the promotion PR.
5. Tag the resulting `main` commit `v<PR#>` (same number) — and cut a GitHub Release from it if
   desired. **This step cannot be done from a cloud/web Claude Code session** — tag and release
   pushes get a hard platform 403 there regardless of numbering scheme (see
   `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md`). Do it from a local
   terminal session, or via the GitHub web UI.

### One-line prompt (step 2)

> Sync PACT build versions to `v<PR#>` (the number of this promotion PR): update `export const BUILD`
> in `js/engine.js`, the line-1 comment/`<title>`/header `.sub` label in `PACT-CharGen-Webtool.html`,
> the line-1 comment in `PACT-Live-Char-Sheet.html`, and `TOOL_VERSION` in `DM-Console.html`. Do
> **not** touch `index.html` (it reads `BUILD` live) or any `DATA.version` / rules string. Report old
> → new per file.

## Rules version (`DATA.version`) — unchanged

Bump only when the rules data actually changes (ladders, prices, gates, `compute()` output), as part
of whichever feature PR makes that change — same as before this document's build-version change.
