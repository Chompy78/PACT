# 2026-09-03 — the false constraint, the whole rotten block, and the guard that read my comment

Kept because the shape of this session repeats one from two days earlier: the shipped work was small and
correct, and almost everything worth recording is about **claims that turned out to be false** — three
of them mine, made in this session, after a session two days ago whose own note opens with the same
admission. That recurrence is the point.

## What started it

A task on the NOW board said CharGen displayed rules `v0.339` while the engine was at `v0.364`. That
task was mine, from the previous session, and it was **wrong** — written from a `grep` without loading
the tool. Disproving it in a browser is what surfaced the real finding.

The stale literals a `grep` sees are *fallbacks*. All three tools read `DATA.version` live at
`engine-ready`, so over http the labels are correct. The literals are only ever visible when the module
bridge fails to run — and the one documented way to make it fail is the way both tool headers were
telling people to run the app:

```
 HARD CONSTRAINTS (do not break)
   • Single self-contained .html: … Must run by opening the file directly (file://).
```

Measured in headless Chromium, each tool opened off disk: engine not loaded, `DATA.version` `null`, all
three. Not degraded — non-functional. Browsers refuse ES-module loads from a `file://` origin, and
D-GH26 moved the rules engine into `js/engine.js` as a module. The "do not break" line had not held for
months.

## The decision, and the half that was deferred

Restoring `file://` needs the engine inlined at build time, and `AGENTS.md` bars a build step outright.
So it is not an implementation task; it is a request to relax a hard rule. The owner's call was to drop
the claim and keep the idea: the line goes, and restoring the capability becomes a LATER consideration
with **"declined" named as a legitimate closing outcome**, so it cannot sit open forever as an implied
obligation.

The datum that made it LATER rather than NEXT: this broke at D-GH26 and **nobody reported it in the whole
window since**.

## Where it grew: `/code-review ultra`

The review found the fix had stopped one sentence short — the rest of the same READ FIRST block was still
false, and it applied this session's own reasoning back at it (*a false line under a "do not break"
heading is worse than no line*). Nine findings, all verified against the files before acting:

| the block said | what is true |
|---|---|
| `READ FIRST (PACT tools · v0.339)` | rules were `v0.364`; no version is stamped there now, by design |
| `see PACT-CONTEXT.md (authoritative)` | does not exist anywhere in the repo |
| `Rules source of truth: …v0.303.docx` | no `.docx` exists; it is `js/engine.js` |
| `compute()`/`DATA` "copy-pasted into BOTH files", **with a RULE to keep mirroring them** | both live only in `js/engine.js` since D-GH26 — obeying that RULE means re-implementing the engine inside a tool, the one thing `AGENTS.md` forbids outright |
| `Single self-contained .html … NO external deps` | both tools import 6–7 modules from `js/` |
| `Exports a "-livesheet.json"` handoff | deleted by D-GH40 |

**One was player-facing, not a comment.** The Live Sheet's in-app Tool Guide told players to click
`⇆ Live Sheet` "to download a `-livesheet.json` file". That button is `⇆ Open in Live Sheet`, calls
`switchToLiveSheet()`, and downloads nothing — players were sent to their Downloads folder for a file
that is never produced.

**The review was also wrong once, and following it blindly would have caused a new defect.** It implied
the whole shared-code block was obsolete. Four of its six entries (`renderCharSheet`,
`buildPortraitPrompts`, `hydrateSheet`/`csSave`) are still genuinely copy-pasted into both tools —
checked, not assumed. Deleting the block would have replaced one false statement with another.

## The bug I shipped, and why the fix went in the prose

The de-rot asserted that neither tool declares a local `compute()` and **proved it by quoting the
grep** — writing the literal `function compute(` into both files. `audit.py`'s drift guard matches that
against raw file text, comments included. The sentence claiming the guard finds nothing was the thing it
found. CI went red at 27/2.

Rewording the prose was the right fix, not teaching the guard to skip comments: a commented-out engine
symbol is one keystroke from live, and the guard protects the single source of truth. Full reasoning in
Addendum 2 of `D-GH-2026-09-02-file-protocol-support-or-drop-the-claim`.

The real failure was upstream of the bug. Four gates were run locally before pushing and `audit.py` was
not — a check that exists, runs in CI, and catches exactly this class of edit. Afterwards the gate list
was **derived from `.github/workflows/*.yml` instead of recalled**: twelve gates, nine of which run in a
cloud container, three needing Playwright which is not installed there.

## Three claims of mine that were wrong, and how each was caught

1. **"All three tools carry the `file://` claim."** Only two do; DM Console has an incidental
   storage-fallback comment. Caught by grepping when asked to explain the claim. The correction then had
   to be made *twice* — it went into the decision record but not the task board, and the board is the
   file whoever picks the task up will actually read.
2. **"The `tool-pricing-ci` failure is the known flake"** — asserted before checking. It was not: the
   clean tree passed 189/0 on the first run. Only after stashing and running **three times each way**
   did it hold up — the clean tree produced the worst run of the six (183/1). Right conclusion, reached
   the wrong way first.
3. **"Background `sleep` doesn't consume wall-clock time here."** Stated as a fact about the
   environment, in a wrap-up, as a lesson to carry forward. False: a timer measured itself at exactly
   200s. The actual mistake was launching background timers and then polling the API in the same turn
   without ever waiting for them, so seconds passed where I inferred minutes.

Nos. 2 and 3 share a root: **inferring a measurement instead of taking one**, which is the same defect
as the `grep`-written task that started the session.

## Collision with a concurrent session

Mid-work, another session promoted `v1.503` and filed the `tool-pricing` readiness flake as a NEXT task
(#502) — the same flake being characterised here, independently. The first push was rejected as
non-fast-forward; rebasing was clean. Both edits survived (line-1 build labels vs line-45 header prose,
different hunks). Worth remembering that the repo's multi-session assumption is not theoretical.

## Shipped

Promoted as **`v1.504`** (PR #504), regular merge commit per `docs/VERSION-SYNC.md` — verified after the
fact that `main`'s head really carries two parents. No tag, per
`D-GH-2026-08-20-tag-only-meaningful-promotions`. Verified live by fetching `js/engine.js` off GitHub
Pages and spot-checking the shipped prose, rather than stopping at "merged".

## Open, and found while closing

`close-session-logging-core.md` — which `close-code-session-jc` and `close-chat-jc` both delegate four
procedures to — **does not exist anywhere in the synced skills tree.** Every `-jc` skill folder holds
only `SKILL.md`, while Anthropic-authored skills in the same tree (`pdf/`, `skill-creator/`) do carry
their sibling files. So the sync mechanism transports siblings fine; this file is absent from the source.

That is partial evidence for the open NOW task (*"find where `~/.claude/skills/` syncs from, and confirm
the close-session patch survived"*) — and it was obtained from a cloud session, after I twice told the
owner that task needed a local machine. It does not answer what writes the Windows directory, but it
does show the shared file is missing from the synced distribution, which makes four documented
procedures unreachable for any session running off these skills.
