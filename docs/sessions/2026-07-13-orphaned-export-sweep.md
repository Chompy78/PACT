# Orphaned-export sweep — `js/engine.js` (2026-07-13)

Roadmap item **A9** (⚪ LATER): grep every named export in `js/engine.js` and confirm each is referenced
by at least one of the three tools. Find-and-report only — **no code was changed**. Any confirmed
zero-reference export is filed as its own follow-up roadmap item below (same pattern as REV-13's dead
grant maps).

## Method
- Enumerated every `export function|const|let|class NAME` in `js/engine.js` (14 named exports).
- For each, `grep -rnwE` across `tools/*.html` and `js/*.js` (excluding `js/engine.js` itself), then
  widened to the whole repo (`index.html`, `testing/**`) for the ones that came back empty.
- Excluded `docs/history/` (retired architecture) and `node_modules/`.

## The 14 exports and where they're used

| Export | Referenced by | Verdict |
|---|---|---|
| `BUILD` | `index.html` (`m.BUILD`, read live for the build label) | ✅ used (tools *mirror* it as a hardcoded string rather than importing — by design, see VERSION-SYNC) |
| `DATA` | all 3 tools (imported) | ✅ used |
| `compute` | all 3 tools (imported) | ✅ used |
| `baseBuild` | all 3 tools (imported) | ✅ used |
| `MUT` | all 3 tools (imported) | ✅ used |
| `activeEvents` | all 3 tools (imported, aliased in LS/DM) | ✅ used |
| `economy` | all 3 tools (imported, aliased in LS/DM) | ✅ used |
| `foldBuild` | all 3 tools (imported, aliased in LS/DM) | ✅ used |
| `rebuildStateFromEvents` | **no tool**; used by `testing/scripts/engine-parity-ci.mjs` + `testing/tests/engine-parity.html` | ⚠️ see note 1 |
| `validate` | CharGen + Live Sheet (imported) | ✅ used |
| `RULE_BAN_FIELDS` | CharGen + Live Sheet (imported) | ✅ used |
| `SIG_ALG` | **nothing outside `engine.js`** (used only internally at lines 826, 843) | 🔴 **zero-reference export — note 2** |
| `signPayload` | `js/character-store.js` (reached by tools via `buildCharacterEnvelope`) | ✅ used |
| `verifyPayload` | `js/character-store.js` (+ DM Console imports it for tamper-evidence read) | ✅ used |

## Notes

**Note 1 — `rebuildStateFromEvents` is not orphaned.** No tool references it (the tools event-source via
`foldBuild`), but it is the documented event-replay entry point and is exercised by the engine-parity gate
(both the browser `engine-parity.html` and the headless `engine-parity-ci.mjs`) at 2 call sites each. It is
part of the tested public contract, so it stays exported. Worth a one-line doc note that its *only* current
consumers are the tests, but that is not a defect — it is the canonical "replay a LOG onto a snapshot" API
the parity fixtures assert against.

**Note 2 — `SIG_ALG` is a genuine zero-reference export.** `export const SIG_ALG = 'PACT-SHA256-v1'`
(line 733) is used *only* inside `engine.js` — by `signPayload` (line 826, stamps `out.sig.alg`) and
`verifyPayload` (line 843, checks `obj.sig.alg !== SIG_ALG`). Nothing in `tools/`, `js/`, `index.html`, or
`testing/` imports or reads it. Exporting it is unnecessary surface: the algorithm tag is an internal
implementation detail of the sign/verify pair, and the envelope already carries the tag in its own `sig.alg`
field, so a consumer that needed to branch on it would read *that*, not the constant. This is filed as a
follow-up below (de-export, or keep exported only if a future external consumer is intended — see the task
for the decision it leaves open).

## Follow-up roadmap item (for the human to fold in)

````
## REV — de-export (or justify) the unused `SIG_ALG` export in `js/engine.js` — TODO
```
The orphaned-export sweep (docs/sessions/2026-07-13-orphaned-export-sweep.md) confirmed `export const
SIG_ALG = 'PACT-SHA256-v1'` (js/engine.js ~line 733) has ZERO references outside engine.js — it is used
only internally by signPayload()/verifyPayload(). Decide and apply ONE of:
  (a) drop the `export` keyword so it becomes a module-internal const (shrinks the public API surface;
      byte-identical runtime — signPayload/verifyPayload still reference it in-module), OR
  (b) keep it exported but add a one-line comment stating the intended external consumer (e.g. a future
      migration/verifier tool that must recognise the tag), so the next sweep doesn't re-flag it.
Recommendation: (a) — nothing consumes it and the tag already travels inside each envelope's `sig.alg`
field, so external code that needed to branch on the algorithm would read the envelope, not this const.
This touches js/engine.js, so treat the public API as the thing under change: after editing, run
testing/tests/engine-parity.html (expect 20/0) — compute() output is unaffected, so no DATA.version bump
and no testing/expected/ update. Note in CHANGELOG only. Keep signPayload/verifyPayload/their behaviour
exactly as-is; this is an export-visibility change, not a crypto change.
```
**Done when:** `SIG_ALG` is either no longer exported or carries a comment naming its intended external
consumer; signPayload/verifyPayload behave identically; engine-parity 20/0; logged in CHANGELOG.
````

## Bottom line
13 of 14 exports are referenced. One confirmed orphan (`SIG_ALG`) — filed above as a self-contained
follow-up. No code changed in this sweep.
