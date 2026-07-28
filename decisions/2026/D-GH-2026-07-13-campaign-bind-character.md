# D-GH-2026-07-13-campaign-bind-character — Campaign join/invite UI, Deliverable 2 (Path B): bind an existing character

Status: Active

- **Context:** Deliverable 1 (Path A, `D-GH-2026-07-13-campaign-invite-tokens`) covers a DM inviting a
  brand-new player. Path B is the other half: a player who already has a built character (own creation
  log, possibly with purchases made with no campaign context at all) binds it to a campaign via the
  campaign's *existing* shared `invite_code` — no new token table needed, since this isn't single-use or
  DM-curated with a preset budget the way Path A's token is. Re-verified `docs/plans/2026-07-11-campaign-
  join-invite-flow.md`'s B1-B3 steps against the current code before implementing (Revision 4 note in
  that file): all facts still held (`bind_character_to_campaign` didn't exist yet;
  `characters_update`'s grant still excludes `campaign_id`, confirming a SECURITY DEFINER RPC is the
  only write path; `validate(b, rules)`'s signature unchanged; `saveCharacter`/`pushCharacter` inserts a
  row if none exists yet for that id, needed since the bind RPC requires an existing owned row).
- **Options (UI placement):** (A) beside the header's campaign-rules picker (`#cgCloudCampSel`), as the
  plan originally suggested. (B) inside the existing ☁ Cloud menu (`#cgCloudMenu`, built for Path A),
  next to Save/Load.
- **Decision (A):** (B) — `#cgCloudCampSel` is a display-only *rules preview* picker, independent of any
  specific character (lets a signed-out-of-a-campaign player still preview a campaign's rules while
  building). Binding is a per-character action; the ☁ Cloud menu is already where players look for
  actions on the character they currently have open, and reuses an existing menu surface instead of
  adding a second one.
- **Options (rule-violation handling on join):** (A) block the bind entirely if `validate()` finds
  violations (matches the Live Sheet's existing *save-time* engine-`validate()` check, which does block
  saving new purchases for an already-bound character that would break rules). (B) bind regardless, show
  violations as non-blocking warnings.
- **Decision (B):** the plan's original choice, re-confirmed on its own merits (not because it "matches"
  an existing pattern — checked, and it doesn't: the Live Sheet's check is a *blocking* `alert()`, for a
  different scenario). An independently-built character joining a campaign for the first time may
  already carry purchases that predate any campaign context; refusing the bind over that would make the
  feature unusable for exactly the case it exists to serve. CharGen's own live rule-filtering
  (`_cloudCampaign`/`cloudRuleBarred`), which Path B's bind activates the same way Path A's redemption
  does, already softly guards against *new* violations after the join — no extra save-time gate needed.
- **Why:** matches decision 2 from the shared plan (rebind contract: bind only if unbound; same-campaign
  is an idempotent no-op; different-campaign is rejected — no transfer/leave-campaign in v1) and decision
  1 (one-character-per-player-per-campaign, enforced server-side, same pattern as Path A/`join_campaign`).
- **Status:** Shipped (`feat/campaign-bind-character`). Migration applied to the live Supabase project;
  advisor shows no new class of finding (same accepted "authenticated can execute this SECURITY DEFINER
  function" WARN pattern as every other campaign RPC). `bind_character_to_campaign` confirmed
  `SECURITY DEFINER` via introspection.
- **Follow-up: `/code-review ultra` pass (2026-07-13), 10 finder angles, 7 findings, all fixed before
  merge.** Two were genuine correctness bugs the plan's design review didn't catch: (1) the
  one-character-per-player-per-campaign check (an unlocked `EXISTS`-then-write, the same shape already
  used by `join_campaign`/`redeem_player_invite`) had a TOCTOU race — two concurrent bind calls could
  both pass the check before either commit. Closed with a `unique index on characters(owner_id,
  campaign_id) where campaign_id is not null`, which is authoritative for **all three** functions at
  once (not just the new one), plus a friendly `unique_violation` handler in
  `bind_character_to_campaign` for the race window specifically. (2) `onJoinCampaignClick`'s success
  message and `validate()` rules read `window._cloudCampaign`, a global also written by the *unrelated*
  campaign-rules preview picker — after a successful bind, that global could already reflect a
  different campaign than the one just bound, showing the wrong name/rules. Fixed by having
  `_cgResolveDmApStatus()` **return** the freshly-resolved campaign object so callers use that local
  value instead of trusting the shared global. Also fixed: `bind_character_to_campaign` returned `void`
  instead of the bound campaign id, forcing an extra `loadCharacter()` round-trip the client no longer
  needs; the "already bound" banner claimed a player could "switch" campaigns by entering a different
  code, which the rebind contract always rejects — the join form is now hidden (not just relabeled) once
  a character is actively bound; an offline save wasn't detected before attempting the bind, producing a
  confusing raw network error instead of a clear message; a code comment claiming the pre-bind save was
  "a no-op if unchanged" was factually wrong (it always writes). **Deferred, not fixed:** the SQL
  duplication of the "campaign lookup by code" and "already joined" patterns across three functions —
  fully consolidating it would mean touching already-shipped `join_campaign`/`redeem_player_invite`,
  which is out of this PR's scope; filed as a roadmap follow-up.

---
