# `roll-headless.mjs` — headless PACT 🎲 roller, for AI agents in other projects

You are reading this because your project needs randomized PACT characters (party-spread analysis,
combat-balance testing, sample data, etc.) and someone pointed you at this file. You do not need any
other context from PACT's repo or its chat history — this document is self-contained.

## What this is

A Node script, `roll-headless.mjs`, that generates real PACT characters by driving PACT's actual
character-generator web tool (`tools/PACT-CharGen-Webtool.html`) in a real headless Chromium browser, and
returns the results as JSON. It is **not** a reimplementation of PACT's character rules — it drives the
genuine tool, so its output is exactly what a person would get clicking the 🎲 button in a browser.

**Do not try to read PACT's rules source and reimplement random character generation yourself.** That has
already gone wrong once in this project's history — a prior attempt extracted the generator function's
source code out of its file and ran it in isolation, which silently broke one of its internal checks
(a function it called was no longer in scope) and produced wrong characters with no error at all. This
script exists specifically to avoid that failure mode by running the real thing, unmodified, in its
normal environment.

## Requirements

1. **Node.js** (any reasonably recent version — the script uses only built-in modules, no `npm install`).
2. **A Chromium/Chrome browser binary** on the machine. The script auto-detects common locations
   (`/opt/pw-browsers/...`, `/usr/bin/chromium`, `/usr/bin/google-chrome`, etc.); if none is found, set the
   `CHROME_BIN` environment variable to a binary's path.
3. **A checkout of the PACT repository** (github.com/Chompy78/PACT), reachable on disk — the script serves
   the tool's real HTML/JS files over a local HTTP server, so it needs the actual files present, not just
   this script. See "Getting a PACT checkout" below if you don't already have one.

## Quick start

```bash
# 1. Get a PACT checkout if you don't have one (shallow clone is enough, this is read-only):
git clone --depth=1 https://github.com/Chompy78/PACT.git /tmp/pact-repo

# 2. See what's available — themes and the AP-budget/level table — without rolling anything:
node /tmp/pact-repo/testing/scripts/roll-headless.mjs --repo=/tmp/pact-repo --list-themes

# 3. Roll characters. Example: 50 "Frontline Bruiser" characters at 295 AP:
node /tmp/pact-repo/testing/scripts/roll-headless.mjs --repo=/tmp/pact-repo \
  --theme=bruiser --budget=295 --count=50 --out=rolls.json
```

If you already have PACT checked out somewhere (a sibling directory, a submodule, this script copied
alongside a vendored PACT tree), point `--repo` at that path instead of cloning a fresh one. If this
script happens to live INSIDE a PACT checkout already (its normal home, `testing/scripts/` in that repo),
you can omit `--repo` entirely — it defaults to its own repo root.

Full flag reference: `node roll-headless.mjs --help` (works with zero setup — no repo, no Chromium needed
to see the help text).

## Reading the output

Each element of the output JSON array looks like:

```json
{
  "themeKey": "bruiser",
  "budget": 295,
  "forcedClass": null,
  "build": { "species": "...", "originClass": "...", "hd": 10, "stats": {"STR":18,...},
             "skills": [...], "boons": [...], "arts": [...], "racialTraits": [...],
             "drawbacks": [...], "armour": {...}, "weaponProf": {...}, "hardy": 1, "tough": 2, ... },
  "result": { "hp": 84, "ac": 18, "spent": 293, "spendable": 295, "warnings": [], "init": 3,
              "speed": 30, "saveDC": 15, ... }
}
```

- `build` is the character's raw purchases — everything a player chose. Field names match what a PACT
  character sheet stores; if a field's meaning isn't obvious, run `--list-themes` and compare against a
  few real rolls, or ask whoever maintains the PACT repo rather than guessing.
- `result` is everything PACT's rules engine *derives* from `build` — hit points, armour class, spell DC,
  warnings about illegal combinations (there should never be any — see "What 'no warnings' means" below).
- Nothing in either object is invented by this script. It is the tool's own internal state, copied out
  after a real roll.
- **A row can instead carry `error` in place of `build`/`result`** — `{themeKey, budget, forcedClass,
  error}` — when that character had no AP to spend at that budget (a DM-AP-only character with no grant
  yet, or a `--budget` of 0). That's PACT's roller correctly refusing to build anything, not a script bug
  — but it means the row has no character in it. **Always check for `error` before reading `build`/
  `result`** — a row never carries both. The script itself treats any `error` row as a failure (exits 1
  and prints a summary to stderr) rather than letting it pass silently as an ordinary result.

## What "no warnings" means

A real roll should always come back with `result.warnings` empty (or containing only advisory/soft
warnings, not hard ones). If you see hard warnings on every roll, or the script's own error output, do
not work around it in your project — that means PACT's roller has a real bug. Report it back to the PACT
project (its `docs/TASK_BOARD_NOW.md`) rather than filtering the warning out or coercing the numbers
yourself; PACT's own regression gate (`testing/scripts/random-quality-ci.mjs`) has already caught two real
bugs of this kind (D-GH-2026-08-31-random-char-generator-optimize,
D-GH-2026-09-05-roller-build-shapes) and would rather know about a third than have it silently worked
around downstream.

## Keeping this current

This script and its themes can change as PACT's rules or generator evolve. If you vendored a copy of this
file (rather than pointing `--repo` at a live checkout you keep updated), it will drift from PACT's actual
generator over time — re-pull it from `testing/scripts/roll-headless.mjs` in the PACT repo periodically,
the same way PACT's own guide project vendors and periodically re-syncs a snapshot of PACT's rules engine
(`py/vendor/engine/` there, if you want a working example of the pattern). Do not hand-edit a vendored copy
to "fix" behaviour you don't like — file that as a PACT task instead, the same as any other bug.

## Provenance

Added 2026-09-05 as part of `D-GH-2026-09-05-roller-headless-access` in the PACT repo, in response to the
Hit-Dice roller bug (`D-GH-2026-09-05-roller-build-shapes`) that this exact kind of headless access had
found and then, via its own source-extraction technique, made harder to diagnose. See those two decision
records in PACT's `decisions/2026/` for the full history if you need it.
