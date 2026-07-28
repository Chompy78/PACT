# D-GH-2026-07-19-pwa-vs-capacitor-migration — stay on the current vanilla-JS PWA architecture

Status: Active

- **Context:** A migration-assessment prompt template — written for a different project (a children's/
  family PWA constrained by Google Family Link's per-app screen-time limits, where the author's stated
  goal was letting specific installed apps be marked Unlimited Time without doing the same for Chrome) —
  was run against PACT's real codebase as a worked example, at the author's explicit choice, even though
  PACT itself has no children/Family Link use case. Inspected PACT's actual `manifest.json`,
  `service-worker.js`, and confirmed no `package.json`/build tooling exists anywhere (a deliberate
  `AGENTS.md` rule, not an oversight). A follow-up question then asked specifically whether Bubblewrap/
  Trusted Web Activity (Option 4 of the four assessed) would be worth doing for PACT itself, given the
  author's real cross-platform requirement: Android, Apple, and PC users must all be able to use PACT.
- **Options:** (1) keep the current architecture as-is. (2) React+Vite PWA, still web-only, no native
  wrapper. (3) React+TypeScript+Vite+PWA+Capacitor Android — the author's own initial stated leaning,
  producing one codebase for web/PWA/Android-APK/future-Play-Store. (4) Bubblewrap/TWA — wraps the
  *existing*, unmodified PWA in a thin native Android shell with its own distinct package identity, no
  source rewrite required.
- **Decision:** (1) — keep PACT's current vanilla-JS, zero-build-step, GitHub-Pages-hosted architecture.
  No migration to React/TypeScript/Vite/Capacitor/Bubblewrap for PACT.
- **Why:** PACT has no actual Family Link/children's-screen-time requirement — the entire problem the
  source template exists to solve doesn't apply here, so none of the migration cost it justifies transfers
  over uncritically. `AGENTS.md` already commits, repeatedly and deliberately, to "vanilla JS only — no
  frameworks, bundlers, TypeScript, or npm" and "GitHub Pages only — no custom backend code"; reversing
  that is a governance change, not a routine upgrade, and nothing surfaced here justifies it. Critically,
  the author's real stated requirement — Android, Apple, and PC users must all be able to use PACT — is
  already fully satisfied today, at zero cost, by the current plain-web-PWA architecture; none of Options
  2–4 improve on that. Option 4 (Bubblewrap) was evaluated on its own merits for PACT specifically and
  rejected: it's additive and non-destructive (doesn't touch the existing site), but Trusted Web Activity
  is Android-only — Apple has no equivalent mechanism, and a bare wrapped-website with no native
  enhancement would likely fail Apple's own App Review (Guideline 4.2, minimum functionality) even if
  attempted — so it does nothing to advance the one goal named as most important, while adding real
  ongoing maintenance surface (a separate Android project, keystore management if ever published, Google
  Play policy compliance, and a second "how do I install this" path for Android users specifically).
  Option 3 (Capacitor) is the only one of the four that could eventually reach iOS too, but only by first
  paying for a full, multi-week rewrite of three existing 320–520 KB monolithic tools plus the shared
  ~237 KB `js/engine.js` — a cost nothing in this project's actual requirements calls for today. The
  existing engine-parity test harness (20/0), the three-tool module-bridge pattern, and the already
  well-tuned service worker (cache-first/network-first split, D-GH-2026-07-16 and D-GH-2026-07-19 entries)
  are solid engineering already matched to this project's real scale and single-maintainer-plus-agent
  workflow.
- **Status:** Active — no code changed as a result of this evaluation. Revisit only if a concrete, real
  trigger appears later: genuine need for Play/App Store distribution, native device APIs a PWA can't
  provide, or the monolithic-tool architecture becoming unmaintainable on its own merits, independent of
  any Family-Link-shaped problem (PACT has none today).
