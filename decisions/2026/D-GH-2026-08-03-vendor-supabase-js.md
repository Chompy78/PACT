# D-GH-2026-08-03-vendor-supabase-js — the Supabase client is vendored, not fetched from a CDN

Status: Active

## Context

`js/supabase-client.js` imported `@supabase/supabase-js@2.110.2` from `esm.sh`. That made **every cloud
feature depend on a third-party CDN being reachable at page load** — and an ES module import failure aborts
the entire script, so an outage, a corporate block or an ad-blocker took the cloud half of every tool down.
It was the only external network dependency in the app.

D-GH-2026-08-03 (bridge split) already limited the blast radius so a failure costs cloud features rather
than the whole tool. That was damage control; the dependency remained.

## Decision

Vendor it: `js/vendor/supabase-js-2.110.2.js`, served from our own origin and precached by the service
worker.

**The official UMD build, not the esm.sh module graph.** Resolving esm.sh's ESM form transitively gives
**6 files, 268KB** — the bundle plus node polyfills (`process`, `buffer`, `events`, `async_hooks`, `tty`)
that esm.sh injects for browser use. The official UMD build is **one file, 206KB, zero imports**, and is
the artifact Supabase actually publish for browsers.

**Two appended lines, no transform.** The UMD assigns its API to a top-level `var supabase`, which inside
an ES module is module-scoped rather than global — so `export const createClient = supabase.createClient;
export default supabase;` is the whole adaptation. The bytes above that footer are the official build
verbatim. No bundler, no build step, nothing generated locally.

**The filename carries the version, and that is load-bearing.** A version-pinned URL cannot go stale:
updating means a *new* filename, so the service worker can never serve an old copy against a newer caller.
That is precisely the failure that broke every cloud path earlier the same day
(D-GH-2026-08-03-uuid-character-ids' aftermath), and it is what lets this file stay cache-first
(effectively immutable) rather than being re-fetched on every load.

## Why this is allowed against "no bundlers, no npm"

`AGENTS.md` says vanilla JS, no frameworks, bundlers, TypeScript or npm. The intent is that everything in
the repo is plain, readable code with no build step between source and shipped artifact. A vendored file is
the one opaque object in an otherwise readable project, so it is worth being explicit:

- No build step is added. Nothing generates this file locally; it is downloaded and committed.
- No package manager, no dependency graph, no lockfile.
- It is a copy of a file the app **already loaded on every page** — the change is *where it is served
  from*, not what runs.

The owner made this call explicitly after the trade was laid out (a CDN outage mid-session versus one
unreadable file plus a manual update step).

## Consequences

- **Update is manual and deliberate.** The procedure is in the file's header and enforced by
  `testing/scripts/audit.py`: the import, the filename version pin, and the `PRE_CACHE` entry must agree.
- **`testing/scripts/audit.py` gained vendor awareness.** Its `service-worker import freshness` check
  previously only matched same-directory `./name.js` imports and would have silently ignored
  `./vendor/…`. It now fails on an unversioned vendor filename, a missing file, or a vendor import absent
  from `PRE_CACHE`. Both new failure modes were demonstrated red before being fixed.
- **The e2e Supabase stub was retargeted** from the esm.sh URL to the local vendor path (matching both, so
  the harness still works against an older checkout). It is still worth stubbing now that the file is
  local: it keeps a test run hermetic and avoids parsing 200KB per page load.

## Verification

With **every third-party host hard-blocked** in a real browser:

| tool | events fired | DATA | cloud bridge |
|---|---|---|---|
| Live Sheet | `engine-ready`, `sync-ready` | object | yes |
| DM Console | `engine-ready`, `campaign-ready` | object | yes |
| CharGen | `engine-ready`, `campaign-ready`, `sync-ready` | object | yes |

No page errors. Before vendoring, the cloud event never fired at all under that condition. Parity 24/0,
audit 28/0, browser e2e 3/3.
