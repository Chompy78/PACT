# D-GH-2026-10-12-audit-fix-followups-2026-10-12 — three choices in the audit-fix follow-ups

**Context.** The adversarial reviews of the 2026-10-12 audit fixes (PRs #633–#638) left eight small follow-ups on the board
(`chore/audit-fix-followups-2026-10-12`). Three of them hid a choice the owner would normally make. The owner was away; each
was taken under standing instruction **H2** (pick the most conservative option: the one that refuses, locks or hides rather
than grants AP or opens an edit).

**Options and decisions.**

- **Item 5 — CharGen's 🎲 Randomise minted a new character id.** `randomizeRoll()` rebuilds from `clone(readBuild())`, which
  carries no `b.id`, so `applyBuild()` gave the rolled character a fresh id. Every re-roll of a saved character then became a
  NEW cloud row, and the original was left behind; on a campaign character the new row carried the same campaign binding.
  - A. Keep minting (a roll is a new character). B. Keep the id (a roll re-builds the same character).
  - **Decision: B.** No code, decision or changelog line says a new id is intended, and the code says the opposite in two
    places: the creation-state carry in `randomizeRoll()` is justified as "a roll is the same character by definition (the
    button keeps species, class and name)", and the appearance/notes carry (`D-GH-2026-10-12-livesheet-name-description-notes`)
    is "Randomise re-applies them (same character)". B is also the conservative side: it cannot create a second row that a
    DM roster would show as another character. "New Character" still mints a new id; a player who wants a separate rolled
    character starts there.
- **Item 2 — when CharGen's creation-AP controls are refused.** Before: hidden only on a server-CONFIRMED campaign binding.
  While a binding was still being confirmed (or on a finished character whose binding could not be confirmed) a choice wrote
  a `creationLockConfig` threshold the server's guard refuses for a campaign character — the "history is locked" stuck state.
  - A. Refuse on any binding, confirmed or not. B. Refuse while confirming and on a finished character; keep an unconfirmed
    binding on an unfinished character (offline) usable, with its note. C. Leave as is.
  - **Decision: B**, as the task asked. A would lock a possibly-solo player (unbound by the DM since the file was saved) out of
    their own creation AP whenever they are offline; the server refuses the write anyway if the character really is bound.
    The "confirming" window is `window._cgBindingPending`, set when `_cgAdoptEnvelopeBinding()` starts and cleared when it
    finishes or the character changes.
- **Item 4 — what counts as "campaign" for the Live Sheet's non-core (Tasha) switch.** CharGen keys its DM-call lock on a
  CONFIRMED binding; the Live Sheet has no confirmed/unconfirmed distinction.
  - A. Lock on `window._lsCampaignId` (any route), as the Live Sheet's self-award block already does. B. Add a confirmed flag to
    the Live Sheet first.
  - **Decision: A** — the Live Sheet's own existing test (`_lsSelfAwardBlocked`), plus the engine's creation-lock state for a
    finished character. B is a larger change for a switch that prices nothing on its own.

**Why.** Each choice refuses a write the server would refuse anyway, or that a player could use to make a second character
row, without taking an edit away from a solo player who is still building.

**Status:** provisional — owner away, taken under standing instruction H2, reversible (each is a few lines in
`tools/PACT-CharGen-Webtool.html` / `tools/PACT-Live-Char-Sheet.html`; the gate is `testing/scripts/audit-followups-e2e.mjs`).
