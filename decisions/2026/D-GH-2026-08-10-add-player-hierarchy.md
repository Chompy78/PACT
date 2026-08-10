# D-GH-2026-08-10-add-player-hierarchy — invite link is the default route into a campaign

Status: **Active**, 2026-08-10.

## Context

DM Console offered three differently-scoped ways to get a player into a campaign, presented with equal
visual weight and no guidance: the reusable **Players code** (binds a character the player has ALREADY
built, grants the campaign's starting tier), a **single-use invite link** (creates a NEW character,
grants a per-player amount the DM sets), and the **local-file import** card (read-only viewing of an
already-exported `.json`, not part of the cloud campaign roster at all). Filed from the 2026-08-04
usability review as MEDIUM, recorded NOT DONE at the time because picking a default is a product call,
not a mechanical fix.

## Options

- **A — Invite link (new character) as the default.** Most players meeting a DM for the first campaign
  session have no character yet; the reusable Players code and file-import stay available, just
  de-emphasized. (Chosen.)
- **B — Players code as the default.** Treats "player already has a character" as the common case a DM
  meets first.
- **C — Local file import as the default.** Treats bringing in an already-built file as the common case.

## Decision

**Invite link is the default, visually first with a "✓ Usual choice — new player, no character yet"
badge.** The reusable Players code follows directly below it, inside the same "Invite new player"
panel, captioned "Use this instead when the player has already built a character elsewhere." The
local-file-import panel — a separate, genuinely different capability (read-only viewing, not a roster
join) — gained its own caption distinguishing it from both: "Use this when you just want to look at a
player's exported file — not to add them to a cloud campaign roster."

## Why

Most DMs meeting this panel for the first time are onboarding a brand-new player, not reuniting with one
who already has a character built elsewhere — the invite-link flow is the one that needs zero
prerequisites from the player. Making it the visually-first, badged option means a DM can act without
reading all three descriptions first; the badge and captions are still there for the DM whose situation
is the exception. The two Campaign-panel routes were kept together (reordered, not separated into
different panels) since both grant campaign-bound AP and belong under "Invite new player"; local import
stayed in its own "Local files & grant codes" panel since it is a genuinely different capability (no
campaign binding, read-only) that the pre-existing `importCampNote` already flags as separate when a
cloud campaign is loaded.

## Verification

Display/copy-only — no `DATA.version` change. `testing/scripts/dm-console-ui-e2e.mjs` (the project's
Playwright-based DM Console gate) could not run in this session — Playwright is an npm dependency and
AGENTS.md forbids npm in this repo, so that gate has never been runnable from a CLI session (same
limitation noted for the other Playwright-based e2e scripts). Verified instead with an ad-hoc CDP check
(same technique as the dependency-free `tool-pricing-ci.mjs`): the page loads with no JS errors, all
existing element ids are intact, the badge precedes the invite-link block in DOM order, the Players-code
block now follows it, and the import panel's new caption is present. Confirmed visually via a headless
screenshot with the campaign panel forced open. `testing/scripts/engine-parity-ci.mjs` and
`tool-pricing-ci.mjs` are unaffected (no engine or Live Sheet/CharGen code touched) and still report 0
failed.

## Related

- 2026-08-04 usability review — original finding, recorded NOT DONE pending this decision.
