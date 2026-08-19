# D-GH-2026-08-19-version-labels-paint-after-engine-ready — a version label must be repainted, not just initialised

**Status:** DONE · display-only, no `DATA.version` bump

## Context

Reported from real use, all on one page load with the engine on **v0.356**:

| surface | showed |
|---|---|
| CharGen header chip + `<title>` | v0.356 ✓ |
| **CharGen info popup** | **v0.339** ✗ |
| Live Sheet | v0.356 ✓ |
| **DM Console footer** ("rules engine") | **v0.176** ✗ |

Two tools, two different wrong numbers, and neither matched the engine.

## Root cause — one shape, twice

Both labels were painted **at parse time from a hardcoded fallback and never repainted**. The tools'
engine symbols arrive via a deferred `<script type="module">` bridge that fires `engine-ready` *after*
the classic scripts have run (this is the documented reason every UI bootstrap is gated on that event) —
so anything that reads a version during classic-script execution reads the literal, not the engine.

- **CharGen**: `#infoVersions` is composed from what is *on screen* (`.sub` + `#cgPactver`) precisely so
  it cannot invent its own numbers — a good design that has to run **after** the bridge replaces
  `#cgPactver`'s fallback. As a bare IIFE it ran before, capturing `v0.339` from line 500's fallback.
- **DM Console**: `$('rulesVer').textContent = RULES` runs in the classic script body at parse time,
  while `RULES = window.DATA.version` is set later in `_dmBoot()`. The DOM therefore kept `v0.176` — the
  fallback literal — for the life of the page, even though `RULES` itself became correct.

## Decision

Paint on `engine-ready` / after the assignment, not only at parse time.

- CharGen: the composer becomes `_cgPaintInfoVersions()`, called immediately **and** on `engine-ready`.
- DM Console: the paint becomes `_dmPaintRulesVer()`, called immediately **and** again in `_dmBoot()`
  right after `RULES` is set.

Both keep the parse-time call so the label is never blank while the bridge loads; the second call is
what makes it correct. The fallback literals stay as fallbacks — deleting them would trade a stale
number for an empty one, which is worse on a slow load.

## Why nothing caught this

Every existing check reads `DATA.version` directly. **None asserted what the page actually renders**,
which is the only thing a player sees. `tool-pricing-ci` now compares the rendered text of CharGen's
header chip, `<title>` and info popup, and the DM Console's footer, against `DATA.version` — 146 → **148**
checks. The assertion is deliberately "does the rendered string contain the live version", not a fixed
number, so it never needs updating on a version bump.

## Note

The Live Sheet's `<title>` still reads *"PACT — Live Character Sheet (prototype)"*. That is a
**deliberate label**, not a version, and is out of scope here — flagged rather than silently changed.
