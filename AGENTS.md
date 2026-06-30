# PACT — instructions for AI coding agents

> **Single source of truth.** Edit ONLY this file. `CLAUDE.md` imports it (`@AGENTS.md`);
> `.github/copilot-instructions.md` is a stub that points here.

PACT is a static, vanilla-JS tabletop-RPG tool suite — no frameworks, no build step, no npm.
On GitHub Pages at https://chompy78.github.io/PACT/ (served from the `main` branch root; `preview`
is staging and promotes into `main`).

## Architecture — read before editing
- **`js/engine.js` is the single source of truth for all game rules** (browser ES module). Exports:
  `DATA`, `compute`, `rebuildStateFromEvents`, `baseBuild`, `MUT`, `activeEvents`, `economy`, `foldBuild`.
  Never re-implement rules logic anywhere else.
- **Three UI-only tools** in `tools/` (`PACT-CharGen-Webtool.html`, `PACT-Live-Char-Sheet.html`,
  `DM Console.html`) load the engine via a **module bridge**: a `<script type="module">` imports
  `../js/engine.js`, copies the API onto `window`, and fires `engine-ready`; the tool's classic UI script
  waits for that event. `tools/` and `js/` must stay siblings. (CharGen still embeds its own engine copy —
  migrating it onto the bridge is a pending task, so the others are the reference pattern.)
- **Persistence:** the app is an installable, offline-capable PWA with **optional sign-in**. Local-only
  still works (localStorage + JSON import/export); when signed in, characters also save to the **cloud
  (Supabase)** and DMs run **campaigns**. CharGen = a flat build JSON; Live Sheet = an event log
  `{ LOG, SEQ, rules }`. Store only raw character data; derive HP/AC/AP/warnings via `compute()` /
  `rebuildStateFromEvents()` at runtime — **never store derived values.**
- **CharGen → Live Sheet export (D-GH3, see DECISIONS.md):** emits one native buy event per purchase plus
  structural patches; imported characters must be indistinguishable from hand-built ones (drawbacks
  buy-off-able, one ledger entry per line).

## Hard rules for any change
- Keep the three tools working and their UI unchanged unless the task says otherwise.
- Vanilla JS only — no frameworks, bundlers, TypeScript, or npm.
- GitHub Pages only — **no custom backend code in the repo.** The app is static files; Supabase (hosted
  database + auth) is the only backend, reached from the browser and protected by row-level security.
  Service-worker scope and manifest `start_url` = `/PACT/`.
- **Secrets:** only the Supabase **anon/publishable** key is committed (safe under RLS). **Never commit the
  `service_role`/secret key** or any private credential.
- **Target:** modern evergreen browsers on phones and desktops (current Chrome/Edge/Firefox/Safari, incl.
  iOS Safari). Prefer widely-supported JS/CSS; no legacy/IE shims.
- After any change, `testing/tests/engine-parity.html` must report **5 passed / 0 failed** (how to run it —
  browser or headless — is in `docs/HOW-TO-WORK.md`). Keep `engine.js`'s public API stable if you touch it.

## Don't read large files wholesale (token budget)
- **`js/engine.js` (~237 KB)** — don't read end-to-end unless the task targets the engine; `grep` for the
  symbol you need (full API is the Exports line above).
- **Never load `docs/PACT-Players-Guide.html` (~657 KB) or `pact-cover.jpg`** — player assets, not code.
- **`tools/*.html` are 320–520 KB each** — search within for the relevant section; don't read the whole file.
- **`docs/history/` is a retired architecture** (`src/engine/`, `build.cjs`, a Node audit) — never read it
  unless asked.

## Versioning — TWO separate numbers (don't conflate or over-bump)
- **Build version** (`BUILD`, currently `v0.107`) — the cosmetic web-tool/build number. The single source
  of truth is `export const BUILD` in `js/engine.js`; the three tools must **mirror** it and stay
  consistent — CharGen (line-1 comment, `<title>`, header `.sub` label), Live Sheet (line-1 comment),
  DM Console (`TOOL_VERSION`). `index.html` reads `BUILD` live, so **never hand-edit its version.** Full
  bump procedure: `docs/VERSION-SYNC.md`.
- **Rules version** (`DATA.version`, currently `v0.332`) — the rules dataset. Bump ONLY when mechanics
  change (ladders, prices, gates, `compute()` output). The display-only maps `masteryFx`, `drawbackFx`,
  `racialFx` and `page` fields are never read by `compute()` — editing them is a docs change, so don't
  bump it; just log it in `CHANGELOG.md`.

## Log as you go (this is how context survives between sessions)
Before finishing a task / opening a PR, update what applies (newest on top):
- **`CHANGELOG.md`** — *what* changed, one line.
- **`DECISIONS.md`** — *why*, on any architectural/process choice (Context → Options → Decision → Why → Status).
- **`docs/sessions/<date>-<topic>.md`** — the discussion, when it's worth keeping.
- **Graduate:** when a `docs/PACT_ROADMAP.md` task is DONE, MOVE it into `CHANGELOG.md` in the same change —
  the roadmap holds only open work.

## Multiple sessions
More than one agent may be active. **`docs/PACT_ROADMAP.md` has a single writer** — don't append to it.
If you have new roadmap items, output them in **this exact format** for the human to fold in, then carry on:

````
## <short title> — TODO
```
<what to do — the agent prompt, paste-ready>
```
**Done when:** <objective, checkable condition>
````

One task per branch (the open branch is the "in flight" signal).

## File & data map
- **App:** `index.html` (menu) · `login.html` (auth) · `js/engine.js` · `tools/*.html` ·
  `docs/PACT-Players-Guide.html`.
- **Engine support:** `js/` — `supabase-client.js`, `auth.js`, `sync.js`, `campaign.js`, `dm.js`;
  root — `manifest.json`, `service-worker.js`, `404.html`; `sql/` — `schema.sql`, `rls-policies.sql`, `migrations/`.
- **Testing:** run `testing/tests/engine-parity.html` (expect **5/0**); fixtures in `testing/fixtures/`,
  expected output in `testing/expected/` (see `testing/README.md`).
- **Docs:** `docs/PACT_ROADMAP.md` (open work) · `docs/HOW-TO-WORK.md` · `docs/sessions/` ·
  `docs/history/` (archived, non-authoritative).
- **Data rule:** the DB stores only raw character data (`characters.stats`) — the engine derives the rest
  (see *Persistence* above). `ap` (DM-awarded points) is server-authoritative and DM-only — never
  overwritten by a local push.

## Per-change checklist
1. One task, one branch — name it `type/short-slug` (e.g. `feat/…`, `fix/…`, `docs/…`).
2. Touch `js/engine.js` only if the task targets the engine; else treat its API as fixed.
3. `testing/tests/engine-parity.html` → **5/0** (run it per `docs/HOW-TO-WORK.md`). If you changed
   `compute()` output, update `testing/expected/` in the same change and say so.
4. Update `CHANGELOG.md` (+ `DECISIONS.md` / `docs/sessions/` if relevant); graduate the task out of the
   roadmap if done.
5. Commit as `type(scope): summary` (Conventional Commits); open a PR and draft its body from the
   changelog entry.
