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

## Cross-project: the Players Guide (`pact-guide`)

The Players Guide's prose is authored in a **separate, non-GitHub project** (`pact-guide`, on the home
server) — not this repo. This repo only serves a static copy at `docs/PACT-Players-Guide.html`. See
`D-GH-2026-08-12-guide-engine-version-pointer` for the full decision.

**Mirrored branch: `main`** (not `preview`) — `pact-guide`'s vendoring pipeline already made this call for
its pricing sync; the guide follows the same choice since `main` is what's actually live for players.

**Two markers, both HTML comments in the guide, distinct meanings — don't conflate them:**

| Marker | Means | Who maintains it |
|---|---|---|
| `content-version: vX.XXX` | This prose was last edited at this doc revision | `pact-guide`, hand-maintained, unrelated to rules version |
| `documents-rules: version=vX.XXX; branch=main; commit=<7-hex>; reconciled=<date>` | This prose was reconciled against this exact engine rules version | `pact-guide`'s `py/tools/stamp_guide_rules.mjs` — stamped only as a deliberate reconciliation action, never auto-advanced by a vendor refresh |

**This repo never carries `BUILD`** (the cosmetic build number above) in the guide — it has no reason to
track it.

> ### ⛔ The byte-identical rule is WRONG — corrected 2026-08-17
>
> This section used to require the served copy and the `pact-guide` master to be **byte-identical**, and
> on 2026-08-16 that was "achieved" by deleting the PACT-side extras. It caused a real, silent loss:
> commit `e0c5e9f` synced to the master and removed **nine chapter illustrations**, the optimised WebP
> cover, and the **entire four-theme system** (`pact-theme` persistence, `data-theme`, the Midnight dark
> theme, and `prefers-color-scheme` auto-detection). Nobody noticed for a day, because prose grew in the
> same window and the 324 KB drop read as expected compaction.
>
> **The two files legitimately differ.** A served PWA page and an authoring master have different needs.
> The served copy carries, and must keep:
>
> | Served-copy-only | Why |
> |---|---|
> | 10 embedded WebP images (cover + 9 chapter openers) | the master carries one JPEG cover |
> | The `[data-theme]` blocks + pre-paint theme script | `index.html` writes `pact-theme`; the guide reads it |
> | `.chapter-banner` CSS | styles the chapter openers |
>
> **Run `node testing/scripts/verify-guide.mjs` before AND after any transfer.** It checks all three of
> the above explicitly, as fixed inventories rather than counts, so none can leave as a side effect.
> A transfer that drops one now fails loudly instead of silently.
>
> One trap worth naming: the pre-sync stylesheet's `:root` contained **nine self-referential
> declarations** (`--bg:var(--bg)`), which are cyclic and therefore invalid — the default Parchment
> theme was already broken. Do not restore that block verbatim; the Parchment palette recovered from
> the master's flattened CSS is what is now in the file.

**Update procedure for `docs/PACT-Players-Guide.html` — a plain copy, with the documented
served-copy-only additions re-applied afterwards (see the box above).** `pact-guide` has no GitHub remote or CI, so there is no fully-automatic push. Whenever
`pact-guide`'s canonical guide file changes, **the session that made that change** copies the finished
HTML over `docs/PACT-Players-Guide.html` and commits. A straight `cp` is correct — and
`diff <master> docs/PACT-Players-Guide.html` must come back clean afterwards. **That diff is the check:**
if the two files ever differ, something has been edited on the served side, which is exactly what must
not happen (the master is canonical — see `AGENTS.md`).

> **Why this used to be more complicated (2026-08-16).** The served copy used to carry three
> PACT-repo-only `<head>` tags — `<link rel="manifest">`, `<link rel="icon">` and
> `<link rel="apple-touch-icon">` — that the master has no reason to know about. This procedure never
> mentioned them, so every hand-copy silently stripped them with no visible error. Rather than script
> the re-injection, the tags were **removed** and the two files made byte-identical, because the tags
> turned out to be almost entirely redundant: `manifest.json` already sets `scope: "/PACT/"`, so the
> guide is in scope and opens inside the installed app anyway, and `service-worker.js` already
> precaches `/PACT/docs/PACT-Players-Guide.html`, so offline support never depended on them either.
> The only real loss is the tab favicon on the guide page — tracked as a LATER task. Deleting three
> near-inert tags removed a whole class of transfer bug permanently; see `CHANGELOG.md`.

**Before any transfer in either direction, run the verifier:**

```
node testing/scripts/verify-guide.mjs
```

It runs all three content checkers plus structural and anchor checks and prints one PASS/FAIL. A green
run is the evidence that this repo's copy agrees with the engine. It deliberately does **not** claim the
copy is newer than the master — only a `diff` against the master shows that, and the two questions get
confused precisely when it matters most.

Then commit, verifying:
1. `diff` against the master is clean — no PACT-side edits, no stray tags reintroduced;
2. both markers parse and are present exactly once each;
3. `documents-rules`'s `version`/`branch`/`commit` match `pact-guide`'s `py/vendor/engine/SYNCED_FROM.txt`
   at the time of the copy (three-way check: vendored snapshot ↔ `pact-guide` canonical ↔ this repo's
   served copy — not just a two-file diff);
4. no stray `BUILD`/web-tool-version mentions crept into guide body prose.

**Current state (2026-08-12):** this repo's served copy still shows its old `v0.332` marker and carries no
`documents-rules` marker at all — landing this section doesn't fix that by itself. It's corrected the next
time `pact-guide`'s canonical file (now stamped, once that project's own pending first-stamp task closes)
is transferred here.
