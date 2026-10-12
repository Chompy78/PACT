# D-GH-2026-10-12-audit-fix-followups-2026-10-12 — four choices in the audit-fix follow-ups

**Context.** The adversarial reviews of the 2026-10-12 audit fixes (PRs #633–#638) left eight small follow-ups on the board
(`chore/audit-fix-followups-2026-10-12`). Four of them hid a choice the owner would normally make. The owner was away; each
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
  - **Consequence handled in the same change (review of #643):** keeping the id means a roll UPDATEs the real row, so the
    server's creation-lock guard (`pact_enforce_creation_lock`: the old lock family must be an exact prefix of the new one)
    now sees it. The roll therefore carries the whole lock family — every `creationLockConfig` (threshold and auto-arm),
    `creationLocked` and `creationUnlocked` — back in its original order, dropping the rebuild's fresh auto-arm when one was
    carried. Carrying only threshold/lock events had turned an invite-seeded `[threshold, auto]` into `[auto, threshold]`;
    a throwaway Postgres with the live guard and freeze stack refused that save and accepts the fixed one.
- **Item 3 — which id an untagged Live Sheet file opens under (review of #643).** CharGen's branch for untagged files
  rebuilds the LOG from the folded build, dropping lock events, awards, seals and purchase lines. Keeping the file's id lets
  the binding be confirmed, but the next save then UPDATEs the real row with that rebuilt history: refused for good on a
  campaign row with lock events ("a creation-lock entry cannot be removed"), silently replaced on a solo row.
  - A. Always keep the id. B. Never keep it (the old behaviour: a separate copy, no binding). C. Keep the id and binding only
    when the LOG has no lock-family event, award or session seal; otherwise B, with a flash saying it opened as a copy.
  - **Decision: C.** It fixes the case the task named (a plain export of a character in a campaign) without letting a rebuild
    overwrite protected history.
- **Item 2 — when CharGen's creation-AP controls are refused.** Before: hidden only on a server-CONFIRMED campaign binding.
  While a binding was still being confirmed (or on a finished character whose binding could not be confirmed) a choice wrote
  a `creationLockConfig` threshold the server's guard refuses for a campaign character — the "history is locked" stuck state.
  - A. Refuse on any binding, confirmed or not. B. Refuse while confirming and on a finished character; keep an unconfirmed
    binding on an unfinished character (offline) usable, with its note. C. Leave as is.
  - **Decision: B**, as the task asked. A would lock a possibly-solo player (unbound by the DM since the file was saved) out of
    their own creation AP whenever they are offline; the server refuses the write anyway if the character really is bound.
    The "confirming" window is `window._cgBindingPending`, set when `_cgAdoptEnvelopeBinding()` starts and cleared when it
    finishes, when the character changes, or when a newer `_cgResolveDmApStatus()` (cloud load, join, claim) takes over —
    which also drops a stale `_cgPendingCampaignId`.
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
