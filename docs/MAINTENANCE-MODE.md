# Maintenance mode — taking the PACT tools down and bringing them back

**Single source of truth for maintenance mode.** `docs/HOW-TO-WORK.md` points here; don't duplicate any
of this back into it.

Maintenance mode puts a "we're down for maintenance" page in front of the four tool pages, leaving the
landing page and the Players Guide up. It is one command each way, and it is reversible byte-for-byte.

---

## The short version

```powershell
cd C:\path\to\your\PACT
node testing/scripts/maintenance.mjs status     # what is it doing right now?
node testing/scripts/maintenance.mjs on         # take the tools down
node testing/scripts/maintenance.mjs off        # bring them back
```

Then **commit and push to `main`** — the script edits files and nothing else. Nothing reaches players
until it is on `main`.

---

## Running it

**Where:** PowerShell (or any shell) on your own machine, in your local clone. Forward slashes are fine
in PowerShell.

**You do not have to be in the repo root.** The script works out the repo from its *own* location
(`maintenance.mjs:31`), not from your current directory, so this works from anywhere:

```powershell
node C:\path\to\PACT\testing\scripts\maintenance.mjs status
```

**Prerequisites:** Node only — check with `node --version`. The script uses nothing but Node built-ins,
so there is no `npm install` step. (This matters: `AGENTS.md` forbids npm for the app itself.)

**Running it with no argument gives you `status`**, so you cannot toggle anything by forgetting the verb.

**Both `on` and `off` are idempotent.** Running `on` twice, or `off` when it is already off, is a no-op
and says so per file.

---

## The full sequence

Maintenance is applied **directly to `main`** — the branch GitHub Pages serves. Deliberately *not* via a
`preview` → `main` promotion: a promotion PR plus a `BUILD` bump is the wrong shape for an urgent
takedown, and you do not want to be waiting on CI while the tools are misbehaving in front of players.

```bash
git checkout main && git pull
node testing/scripts/maintenance.mjs on          # or: off
git add -A && git commit -m "ops: maintenance mode on"    # or: off
git push
```

Pages redeploys in a minute or two. Then verify — see *Checking it worked* below.

---

## What players see

They get `maintenance.html`, which tells them, in this order:

- the character tools are offline for maintenance and will be back shortly;
- **their characters are safe** — cloud characters are untouched in the database, local ones are still
  in their browser and in any JSON they exported;
- the **Players Guide is still available**, with a link;
- and a closing note: if they had unsaved changes open in a tab, **leave that tab alone, don't reload
  it**, and export to JSON once the tools return.

The page is styled to match PACT (parchment light theme, dark-mode variant via `prefers-color-scheme`)
and carries `<meta name="robots" content="noindex">` so a maintenance window cannot get itself indexed
as if it were the real site.

If you want different wording, **edit `maintenance.html` after running `on`** — the script will not
overwrite an existing page, and says so (`maintenance.html already present — left as-is`). Note that
`off` **deletes** the file, so hand-edits do not survive a full cycle; put lasting wording changes in the
`MAINTENANCE_PAGE` template inside the script instead.

---

## What it gates, and what it deliberately leaves up

**Gated — all four tool pages:**

- `tools/PACT-CharGen-Webtool.html`
- `tools/PACT-Live-Char-Sheet.html`
- `tools/DM-Console.html`
- `tools/characters.html` ← easy to forget; it is in the list

**Left up on purpose:**

- `docs/PACT-Players-Guide.html` — players keep the rules reference during the window.
- `index.html` — the landing page stays up and still links to the guide.

---

## ⚠️ It is a sign, not a lock

The gate is **client-side only**: a one-line script injected at the top of `<head>` that redirects to
`/PACT/maintenance.html` before any other script or asset loads. It changes no database state, no RLS
policy, and no Supabase configuration.

So maintenance mode does **not** prevent writes. Anyone using the `?maint=off` bypass, anyone with a tab
already open from before the window, and anything talking to Supabase directly can still read and write
cloud characters exactly as normal.

**If you are doing something where a concurrent write would corrupt data — a schema migration, a
backfill, a bulk repair — maintenance mode alone is not enough.** It stops honest traffic and tells
players what is happening; it is not a mutex. Take the database-side precaution as well.

---

## Bypass — using the tools while maintenance is up

Append `?maint=off` to any tool URL:

```
https://chompy78.github.io/PACT/tools/DM-Console.html?maint=off
```

This is how you verify the tools actually work *before* lifting. The bypass is per-URL, not sticky —
navigating within the tool may re-trigger the gate, so append it again if you land back on the
maintenance page.

The gate also writes `sessionStorage['pact-maint-from']` with the path the player came from before
redirecting. Nothing reads it today — it is a breadcrumb left for a future "take me back to what I was
doing" link on the maintenance page. Don't rely on it doing anything yet.

---

## Checking it worked

```
node testing/scripts/maintenance.mjs status
```

prints one line per tool page plus an overall state:

```
maintenance page : present  (maintenance.html)
  GATED   tools/PACT-CharGen-Webtool.html
  GATED   tools/PACT-Live-Char-Sheet.html
  GATED   tools/DM-Console.html
  GATED   tools/characters.html

maintenance mode: ON
```

Three possible states:

| State | Meaning |
|---|---|
| `ON` | all four pages gated **and** `maintenance.html` present |
| `OFF` | no page gated **and** `maintenance.html` absent |
| `INCONSISTENT` | anything else — some gated, some not, or the page missing while gates remain |

**`INCONSISTENT` exits with code 2** and tells you the fix: run `on` or `off` to make it uniform. It
usually means a half-finished toggle, an interrupted run, or a merge that brought in one side of the
change. Never hand-patch your way out of it — run the script.

After pushing, also check the live site: load a tool URL in a private window (to dodge your own service
worker cache) and confirm you land on the maintenance page — then confirm `?maint=off` still gets you
into the tool.

---

## Rules and traps

### Always use the script — never hand-edit the gate

This is not style advice. The first takedown (`965a052`, 16 Aug 2026) was applied by hand with
surrounding newlines, which `off` would not have fully removed — it would have left stray blank lines in
all four tool pages.

Worse, `15610f6` records a **data-loss bug** found while fixing that: in `PACT-CharGen-Webtool.html` the
`<head>` shares its line with `<meta charset="utf-8">`. A line-based removal would have deleted the
charset declaration along with the gate. That is why `off` removes an exact marked substring
(`/*PACT-MAINT*/ … /*/PACT-MAINT*/`) rather than a line.

The tools were then reset and re-gated *with the script*, and `off` was verified to restore them
byte-for-byte. **That guarantee only holds if the gate went on via the script in the first place.**

**Acceptance check if you ever touch the script:** run `on`, then `off`, then `git status` — it must be
clean.

### Do not bump `service-worker.js`'s `CACHE_NAME` for this

HTML is network-first, so returning users get the maintenance page on their next load and get the real
tools back just as fast on `off`. Bumping the cache would precache the *maintenance* pages and then need
a second bump to undo.

### `preview` does not carry maintenance mode

Any `preview` → `main` promotion while maintenance is on will **silently lift it** — the promotion
merges `preview`'s un-gated tool pages over the gated ones. Don't promote during a maintenance window.
If you must, re-run `on` on `main` immediately afterwards and check `status`.

### A promotion is not how you take the tools down

Restating the point above from the other direction: put the gate on `main` directly. Routing a takedown
through `preview` means a PR, CI, and a `BUILD` bump before anything reaches players.

---

## Troubleshooting

**"I pushed but players still see the tools."** Give Pages a minute or two. Then check you pushed to
`main`, not `preview` (`git branch --show-current`). Then check a private window — your own service
worker may be serving a cached page to you specifically.

**"Some pages are gated and some aren't."** That is `INCONSISTENT`. Run `on` or `off`; don't hand-fix.

**"`off` didn't remove everything."** Almost certainly a hand-applied gate that doesn't match
`GATE_RE`. Search the four tool files for `PACT-MAINT` and remove the exact `<script>…</script>` block,
then run `status` to confirm.

**"The wording is wrong and `off` deleted my edit."** Expected — `off` deletes `maintenance.html`. Edit
the `MAINTENANCE_PAGE` template in the script so the change survives.

**"Maintenance vanished after a release."** A `preview` → `main` promotion lifted it. See above.

---

## History

| Commit | Date | What |
|---|---|---|
| `965a052` | 16 Aug 2026 | took the tools down for maintenance — gate applied by hand |
| `15610f6` | 16 Aug 2026 | added `maintenance.mjs`; re-applied the gate with it so `off` reverses byte-for-byte; fixed the CharGen `<meta charset>` data-loss bug |
| `964cca7` | 16 Aug 2026 22:09 | **lifted maintenance mode** — the state the site has been in since |

Maintenance mode has been **OFF** since 16 August 2026.

---

## Files involved

| Path | Role |
|---|---|
| `testing/scripts/maintenance.mjs` | the toggle — `status` / `on` / `off`; owns the gate string, the regex, and the page template |
| `maintenance.html` | the page players see; **created by `on`, deleted by `off`**, so it is absent from a healthy `main` |
| `tools/*.html` (four files) | receive the injected gate |
| `docs/HOW-TO-WORK.md` | points here |
