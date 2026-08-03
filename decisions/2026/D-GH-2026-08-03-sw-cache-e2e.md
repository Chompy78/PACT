# D-GH-2026-08-03-sw-cache-e2e — a returning-visitor gate, and a four-month-old truncated tag

Status: Active

## Context

The `test/cloud-e2e` task exists because nothing in `testing/` exercises a signed-in session. Working
through it surfaced that the gap is wider than "no auth": **no gate simulates a second visit**. Every
existing check runs in a clean browser with no service worker, which is precisely the state in which the
2026-08-03 outage could not occur — and that outage took down every cloud path while all five checks were
green.

The warm-cache half needs no backend at all, so it was split out and delivered first.

## Decision

`testing/scripts/sw-cache-e2e.mjs` installs the real service worker, waits for it to activate and populate
its cache, then changes a module on disk so a network-first module imports a symbol only the *new* copy
exports — the exact shape of the original bug — and reloads **without** a hard refresh.

Verified both ways, which is the only thing that makes it worth having:

| service-worker policy | result |
|---|---|
| `character-store.js` network-first (fixed) | all checks pass, exit 0 |
| `character-store.js` cache-first (the bug) | `events=["engine-ready"]` only, `does not provide an export named '__swProbe'`, exit 1 |

Wired into CI as its own workflow with a deliberately broad path filter (`js/**`, `service-worker.js`,
`tools/*.html`): the failure mode is a *combination* of a module change and a caching policy, not either
alone, so a narrow filter would miss it.

## What building it uncovered

**CharGen's own service-worker registration has been dead since PR #210.** Line 3905 of
`tools/PACT-CharGen-Webtool.html` was the literal fragment `    <li><sp` — the file is truncated
mid-tag. An unterminated tag swallows everything that follows, so the `<script>` block registering the
service worker never reached the DOM. Confirmed by querying the parsed document: no script containing
`serviceWorker.register` existed, and a manual `register()` from the console worked immediately.

It was masked because `index.html` registers the worker for the whole `/PACT/` scope, which covers the
tools — so anyone arriving via the menu was fine. Anyone deep-linking straight to CharGen got **no service
worker at all**: no offline support, no caching. The `<ul>` and both enclosing `<div>`s were unclosed too.

The lost sentence is unrecoverable. The structure is closed and the gap is marked with a comment rather
than inventing documentation for a feature that may not exist.

**This is also why the test initially reported three vacuous passes.** With no service worker installed,
"the returning visit still boots" was measuring an ordinary page load. The first version waited on
`navigator.serviceWorker.controller !== undefined`, which is immediately true because `controller` is
`null` before activation. It now waits on `navigator.serviceWorker.ready` and then polls until the cache
is actually populated.

## Status

Done. The remaining half of `test/cloud-e2e` — the signed-in scenarios against a local `supabase start`
stack — is still open; `sql/schema.sql` + `sql/rls-policies.sql` were verified to reproduce production
exactly (8 tables, every column, 25 functions), so a test database can be built from them without
replaying 21 migrations.
