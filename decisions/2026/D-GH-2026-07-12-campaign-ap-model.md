# D-GH-2026-07-12-campaign-ap-model — Build CharGen's cloud character-load now, rather than defer it

Status: Active

- **Context:** `feat/campaign-ap-model` set out to make CharGen and the Live Sheet display an identical
  spendable-AP total (`docs/plans/2026-07-12-campaign-ap-model-cold-review.md`), framed as
  "display/validation-only." Mid-task recon (the plan's own explicit "VERIFY FIRST" gate) found CharGen had
  **no cloud character concept at all** — only a campaign-*rules*-ban picker (`window._cloudCampaign`,
  D-GH44), unrelated to any saved character, no `.ap`/`campaign_id` in its JSON schema, no `js/sync.js`
  import. DM AP (`characters.ap`) was not just unwired — there was nothing to hang it off of.
- **Options:** (A1) build a full CharGen cloud character-load/save flow now, in this branch, mirroring the
  Live Sheet's `☁ Cloud` menu — real feature addition, bigger diff, but delivers the plan end-to-end today.
  (A2) wire only what's already available with zero new plumbing (`ignore_player_ap`, already fetched by the
  existing rules picker) and leave DM AP permanently in the "unavailable" state until a later task adds
  cloud load — smaller diff, matches the "display-only" framing, but ships a visibly incomplete feature.
  (A3) defer all CharGen work to a follow-up branch, ship only the Live Sheet fix this round.
- **Decision:** A1 — user's explicit choice when asked (AskUserQuestion), overriding the assistant's A2
  recommendation.
- **Why:** The plan's whole premise — CharGen and the Live Sheet as *interchangeable* tools — is hollow if
  CharGen can never actually show a cloud character's real DM AP; A2 would ship a feature whose primary use
  case (a campaign character opened in CharGen) never leaves the "unavailable" state. Reused CharGen's own
  existing, tested `_cgApplyEnvelope()`/`_cgEnvelope()` for the actual load/save rather than re-deriving
  Live Sheet's pattern from scratch — much smaller net-new logic than it first appeared once that reuse was
  identified. The DB schema (`characters.kind` check constraint) already listed `'chargen'` as a valid kind,
  suggesting this was always intended, just never built.
- **Also found — a separate, pre-existing Live Sheet bug, fixed in this same change once `/code-review`
  surfaced it (initially logged here as "deliberately not fixed," reversed once independent review flagged
  it twice as highest-confidence/highest-impact):** the Live Sheet's cloud "Load character" click handler
  assigned `window.LOG = d.LOG` / `window.SEQ = ...` / `window.__charId = rec.id` — but `LOG`/`SEQ`/
  `__charId` are top-level `let` bindings in the Live Sheet's main classic `<script>`, which do **not**
  become `window` properties; a `window.X =` write there is a dead write to an unused property, shadowed by
  (and never syncing back to) the real lexical binding every other function in the file actually reads.
  Verified in a real browser (Playwright): clicking "Load" updated `window._dmAp`/`window._ignorePlayerAp`
  correctly (those were never `let`-shadowed) but did **not** actually swap the character's LOG/SEQ/id —
  `render()`/`save()` kept operating on the previously-loaded character's data. Fixed to bare `LOG=`/`SEQ=`/
  `__charId=` assignment, matching the codebase's own already-correct `_lsConsumeHandoff()` pattern a few
  hundred lines away (the likely origin: an unintentional copy-paste of the correctly `window.`-scoped
  `_dmAp`/`_ignorePlayerAp` idiom onto fields that don't share that scoping). Re-verified post-fix in a real
  browser: LOG/SEQ/`__charId`/the rendered sheet name all correctly swap to the newly-loaded character.
  Also found and fixed in the same handler's neighborhood: `A.onAuthChange(function(s){...})` bound
  `_session` to `js/auth.js`'s `event` string (first callback arg), not the `session` object (second arg) —
  CharGen's own `campaign-ready` listener already had this right (`function (event, session)`); Live Sheet's
  now matches, and a `SIGNED_OUT` transition resets the AP-model globals it previously left stale.
- **Status:** In force. CharGen's cloud load/save and the Live Sheet fixes above all shipped in this change;
  parity 20/0, `js/engine.js` untouched.

---
