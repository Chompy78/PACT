# PACT version sync

Two **separate** version numbers live in this repo. Don't conflate them.

| Axis | What it is | Where it lives |
|------|-----------|----------------|
| **Build version** (`v0.10x`) | Cosmetic web-tool/build number | `js/engine.js` → `export const BUILD` (**single source of truth**), mirrored by the 3 tools |
| **Rules version** (`v0.3xx`) | The rules dataset | `DATA.version` inside the engine + each tool |

## Build version — single source of truth

`js/engine.js` holds the canonical build number:

```js
export const BUILD = "v0.107";
```

Everything else must **match** that value:

- `tools/PACT-CharGen-Webtool.html` — line-1 comment, `<title>`, and the header `<span class="sub">Web Tool · vX</span>`
- `tools/PACT-Live-Char-Sheet.html` — line-1 comment
- `tools/DM-Console.html` — `var TOOL_VERSION = 'vX'`
- `index.html` — **don't touch.** It reads `BUILD` from `js/engine.js` at load and displays it, so it can never drift.

## To bump the build version

1. Change `BUILD` in `js/engine.js`.
2. Make the four tool labels above equal the new value.
3. Leave `DATA.version` alone (that's the rules version — bump it only when the rules data actually changes).

### One-line prompt

> Sync PACT build versions to the value of `BUILD` in `js/engine.js` (or the value I name): update the line-1 comment, `<title>`, and header `.sub` label in PACT-CharGen-Webtool.html; the line-1 comment in PACT-Live-Char-Sheet.html; and `TOOL_VERSION` in DM-Console.html. Do **not** touch `index.html` (it reads BUILD live) or any `DATA.version` / rules string. Report old → new per file.
