# Session: PWA vs. React/Vite/Capacitor migration assessment (and why PACT isn't moving)

**Date:** 2026-07-19 · **Decision:** `D-GH-2026-07-19-pwa-vs-capacitor-migration`

Why this note exists: the user brought in a detailed, structured migration-assessment prompt template
built for an entirely different project, asked to run it against PACT as a stand-in worked example, then
followed up with a sharper, PACT-specific question that the general template didn't cover. The final
answer (stay put) diverged from the user's own stated starting expectation, so the reasoning is worth
preserving in full rather than just the compressed `DECISIONS.md` entry.

## Where the prompt actually came from

The pasted template was written for a *different* real problem: children's/family PWA apps (reward
trackers, educational apps, games) installed on Android tablets managed by Google Family Link. The
author's kids hit their daily Chrome screen-time limit and the installed PWAs stop opening with it,
but setting Chrome itself to Unlimited Time would also unlock YouTube/browser/video access — not
wanted. The template's whole premise (Options 1–4, the Family Link section, the milestone plan) is
built around solving *that* problem for *that* kind of app.

PACT is not that app — no children, no Family Link, no screen-time constraint. The user explicitly chose
to run the assessment against PACT anyway ("this PACT repo, as a stand-in/example"), asked via
`AskUserQuestion` before doing any work, since the mismatch was real enough to be worth confirming rather
than guessing.

## What the assessment actually found (against PACT's real files)

Inspected directly rather than assumed: no `package.json`, no build tooling of any kind, a complete
`manifest.json` and a genuinely well-tuned `service-worker.js` (cache-first/network-first split already
exists and is deliberate, not accidental) — and three 320–520 KB single-file HTML tools plus a shared
~237 KB `js/engine.js`, the architectural opposite of a component-based SPA. `AGENTS.md`'s "vanilla JS
only, no build step" rule is stated as a deliberate, repeated house rule, not an oversight.

The key finding, which challenged the user's own stated starting position ("My current expectation is
... React + TypeScript + Vite + PWA + Capacitor Android"): **for an app that's already a working PWA
(manifest + service worker), Bubblewrap/Trusted Web Activity (Option 4) solves the actual Family Link
problem far more cheaply than the full Capacitor rewrite (Option 3)** — hours to a day, zero source
changes, versus weeks of porting for a codebase PACT's size. Capacitor only earns its much higher cost if
native device APIs are genuinely needed later, or the maintainability upgrade is wanted for its own sake
independent of Family Link. This was surfaced as the report's central "challenge your assumption" point,
per the user's own instruction to do so if the evidence warranted it.

For PACT itself, though, none of this mattered on its own merits — no Family Link problem exists here —
so the baseline recommendation for PACT was Option 1 (keep the current architecture), full stop.

## The follow-up question that actually settled it

The user then asked the sharper, PACT-specific version: *would Option 4 (Bubblewrap) be bad for PACT
specifically, and — the real crux — they want Android, Apple, **and** PC users to all be able to use it.*

This is the fact that closes the question cleanly: **Trusted Web Activity is Android-only.** There is no
Apple equivalent — Safari/WebKit has nothing like it, and a bare wrapped-website with no native
enhancement would likely fail Apple App Review's minimum-functionality bar even if attempted. So Option 4
cannot advance a "reach Apple users too" goal under any circumstances, only Android specifically — and
PACT's stated goal is exactly the three-platform one. Meanwhile the current plain-web-PWA architecture
*already* reaches Android, Apple, and PC identically, today, for free, since it's just a website. Nothing
about adding Bubblewrap improves that; it would only add an optional, Android-only Play Store presence on
top of what already works everywhere, at the cost of a second Android project to maintain, keystore
management if ever published, and a second "how do I install this" path for Android users specifically.

Capacitor (Option 3) is the only one of the four that could eventually reach iOS too — but that's a
from-scratch decision about wanting real native app-store presence on *both* platforms, not something
today's requirements are asking for, and still requires paying for the full rewrite cost established
earlier.

## Outcome

Decision: stay on Option 1, no migration. Logged as `D-GH-2026-07-19-pwa-vs-capacitor-migration` in
`DECISIONS.md`. No code changed as a result of this session's discussion — this is purely an
architectural evaluation and its resolution, not a shipped change, so there's no matching `CHANGELOG.md`
line.
