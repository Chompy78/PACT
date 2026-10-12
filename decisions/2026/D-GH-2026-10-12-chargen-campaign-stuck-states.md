# D-GH-2026-10-12-chargen-campaign-stuck-states — CharGen trusts a campaign binding only once the server confirms it

**Context.** CharGen offered campaign characters two controls (Building level, "Confirm or change" creation AP) that write a
`creationLockConfig` with a `threshold`. The server's creation-lock guard (`sql/migrations/2026-10-04-creation-lock-guard.sql`,
rule 2) refuses that from anyone but the campaign DM, and autosave then dead-ended. Hiding them on campaign characters raised two
questions in review (PR #634):
1. Where does "is this a campaign character" come from? A file, local autosave or handoff baton records the campaign the
   character was in *when it was written*. After `dm_unbind_character` that record is stale, but the server guard returns early
   for a solo character, so hiding the controls would lock a solo character out of its own settings for no reason.
2. The binding is resolved asynchronously (`_cgAdoptEnvelopeBinding`). If the player switches character during the awaits (New
   Character, Undo/Redo across characters, another load), a late result could bind the wrong character. That binding would then
   ride into its autosave, baton and files, and through `js/sync.js`'s legacy-id migration it could adopt the campaign's real row.

**Options.**
- A. Trust the envelope's `campaignId` (the first version of #634): simple, but wrong after an unbind, and racy.
- B. Confirm the binding against the server row (`characters.campaign_id`, readable by the owner under the existing `select`
  grant and RLS). Hide the controls only on a confirmed binding. When it cannot be confirmed (offline, signed out, no row), keep
  the binding for AP purposes but leave the controls usable, with a note. Give each resolve a generation and drop stale results.
- C. Hard-refuse whenever any route names a campaign. This is the most conservative option, but it strands unbound characters.

**Decision.** B. `js/sync.js` gains `refreshServerBinding(id)` → `{ap, campaignId}` or `null` (unconfirmed). It is one read and
pushes nothing. `window._cgBindingConfirmed` is set by `_cgResolveDmApStatus`: true for server-sourced ids (cloud load, join,
claim) and for a server-confirmed envelope. `_cgCreationApIsDms()` gates the controls. `window._cgBindGen` is bumped by
`_cgResetCloudApState()` and by every fresh resolve; a resolve re-checks it after every await. History frames also carry
`campaignId` and a DM copy's display state, so Undo/Redo across characters restores both.

**Why.** The server is the authority on the binding. When it can't be asked, the server guard is still the backstop: an
unconfirmed campaign character that edits its threshold gets the existing refusal, which is no worse than before. The
generation check is the only way to make the async adopt safe against character switches without serialising every load.

**Status.** Accepted (requested by the orchestrator's review of PR #634); reversible client-only change, no migration.
