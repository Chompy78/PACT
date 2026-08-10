# PACT version sync

Two **separate** version numbers live in this repo. Don't conflate them.

| Axis | What it is | Where it lives |
|------|-----------|----------------|
| **Build version** (`vM.NNN` — manual major `M`, PR number `NNN`) | Cosmetic web-tool/build number | `js/engine.js` → `export const BUILD` (**single source of truth**), mirrored by the 3 tools |
| **Rules version** (`v0.3xx`) | The rules dataset | `DATA.version` inside the engine + each tool |

## Build version — major is manual, minor is the promotion PR number

**As of D-GH-2026-08-02-build-version-pr-linked** (amended same-day for the two-part format), `BUILD`
is `v<major>.<PR#>` — e.g. `v1.293` for PR #293 under major `1`. The PR-number half is the number of
the GitHub PR that promotes `preview` → `main`; see that decision record for why it's PR-derived
rather than an independently-incremented counter (short version: a manually-picked "next" number is a
shared mutable counter across concurrent branches — the exact hazard already documented for the old
`D-GH<N>` decision-numbering scheme — and it gave no way to look at a running build and know what
actually shipped in it; a promotion PR's number is assigned atomically by GitHub the moment it's
opened, so `github.com/Chompy78/PACT/pull/<N>` **is** the exact diff that build contains).

The **major number is manual** — it does not auto-increment. **Carry it forward unchanged** at every
promotion unless a human explicitly decides this release deserves a new major (a relaunch, a big
milestone) — that's a deliberate, named decision each time, not a mechanical step, and is never
inferred from the size of what's in the promotion.

**Feature PRs into `preview` never touch `BUILD`.** Don't bump it as part of a regular task —
only the promotion step below does.

`js/engine.js` holds the canonical build number:

```js
export const BUILD = "v1.293";
```

Everything else must **match** that value:

- `tools/PACT-CharGen-Webtool.html` — line-1 comment, `<title>`, and the header `<span class="sub">Web Tool · vX</span>`
- `tools/PACT-Live-Char-Sheet.html` — line-1 comment
- `tools/DM-Console.html` — `var TOOL_VERSION = 'vX'`
- `index.html` — **don't touch.** It reads `BUILD` from `js/engine.js` at load and displays it, so it can never drift.

## Promoting `preview` → `main` (the only time `BUILD` changes)

1. Open the promotion PR (`preview` → `main`) first — this is how the PR-number half is obtained;
   GitHub assigns it the instant the PR exists, so there's nothing to bump before this step.
2. Check the *previous* `BUILD` value's major number (e.g. `1` in `v1.293`) — carry it forward as-is
   unless you've been explicitly told this release bumps the major.
3. Push one commit to that same PR setting `BUILD` in `js/engine.js` to `v<major>.<PR#>`, then sync
   the four tool labels above to match (see the one-line prompt below).
4. Leave `DATA.version` alone — it's the separate rules-version axis, bumped only when mechanics
   change, and is untouched by this procedure regardless of which feature PRs are in the promotion.
5. **Merge the promotion PR with a regular merge commit — never squash.** Squashing a `preview`→`main`
   promotion severs the shared commit history between the two branches (the squash commit has no
   common ancestor with `preview`'s real history beyond that point), so the *next* promotion's 3-way
   merge falls back to a stale common ancestor and produces spurious conflicts even when the content
   isn't actually incompatible — this happened for real between PR #293 (squashed) and #294, and had
   to be fixed with a manual reconciliation merge. Regular feature PRs into `preview` can still squash
   freely; this rule is promotion-PRs-only.
6. Tag the resulting `main` commit `v<major>.<PR#>` (same value) — and cut a GitHub Release from it
   if desired. **This step cannot be done from a cloud/web Claude Code session** — tag and release
   pushes get a hard platform 403 there regardless of numbering scheme (see
   `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md`). Do it from a local
   terminal session, or via the GitHub web UI.

### One-line prompt (step 3)

> Sync PACT build versions to `v<major>.<PR#>` (carry the previous major number forward unless told
> otherwise; PR# is this promotion PR's own number): update `export const BUILD` in `js/engine.js`,
> the line-1 comment/`<title>`/header `.sub` label in `PACT-CharGen-Webtool.html`, the line-1 comment
> in `PACT-Live-Char-Sheet.html`, and `TOOL_VERSION` in `DM-Console.html`. Do **not** touch
> `index.html` (it reads `BUILD` live) or any `DATA.version` / rules string. Report old → new per file.

## Rules version (`DATA.version`) — unchanged

Bump only when the rules data actually changes (ladders, prices, gates, `compute()` output), as part
of whichever feature PR makes that change — same as before this document's build-version change.

### Rules version display sites — all three are LIVE, none need hand-editing

Unlike `BUILD` above, every on-screen "PACT rules · vX" label reads `DATA.version` live at
`engine-ready` — there is no rules-version literal anywhere in `tools/` that a rules bump must touch
(fixed for CharGen's chip by `fix/chargen-rules-label-live`; Live Sheet and DM Console were already
live before that task, per `RULES=(window.DATA&&window.DATA.version)||RULES` in both).

| Tool | Live source |
|------|-------------|
| `tools/PACT-CharGen-Webtool.html` | `#cgPactver` chip + `<title>`'s "Rules" half, both set from `window.DATA.version` on `engine-ready` |
| `tools/PACT-Live-Char-Sheet.html` | `RULES` var + `#lsRulesVer`, set from `window.DATA.version` in `_lsBoot()` |
| `tools/DM-Console.html` | `RULES` var + `#rulesVer`, set from `window.DATA.version` on `engine-ready` |

A `DATA.version` bump therefore needs **no** rules-label edit in any tool — only `js/engine.js`'s own
`DATA.version` string, plus `testing/expected/` if `compute()` output moved.
