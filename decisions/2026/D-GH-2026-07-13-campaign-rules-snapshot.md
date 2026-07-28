# D-GH-2026-07-13-campaign-rules-snapshot — Carry campaign rules offline as an engine-inert LOG event, resolved live-first

Status: Active

- **Context:** Part (b) of the retire-pactrules task (`docs/plans/2026-07-12-campaign-rules-snapshot.md`).
  After retiring the local PACTRULES code (part a), a campaign character enforced restrictions only while
  *online* (`window._cloudCampaignRules`, fetched from `campaigns.rules`). Offline — or when the cloud
  rules were momentarily unreachable (`_rulesStatus==='unavailable'`) — the pickers fell open. The task:
  give the character an offline copy of its bans without re-implementing rule logic.
- **Options:** (A1) a new **engine** event type materialized into the folded build by `_replay`. (A2) a
  **tool-local** `rulesSnapshot` LOG event the Live Sheet reads itself, with the engine untouched. (A3)
  store the snapshot in a side channel outside the LOG.
- **Decision:** **A2** — a `rulesSnapshot` LOG event, resolved by a tool-local `resolveRules()`
  (`tools/PACT-Live-Char-Sheet.html`); `js/engine.js` untouched.
- **Why the engine stays out of it:** campaign rules are *validation context*, never *pricing input* —
  `compute()` has never read them (the existing cloud-rules path already fed `validate()`/`cloudRuleBarred()`
  from tool-local `window` state). And the engine already treats any unknown non-`buy` event as inert:
  `_spendCost()` returns 0 for it (so `economy()`/the creation-lock threshold ignore it) and `_replay()`
  does `if(e.type!=='buy')continue;` (so it never mutates the folded build). Verified directly: a LOG with a
  `rulesSnapshot` yields identical `economy().spent/earned`, `compute().total`, and `foldBuild().budget`,
  with no field leaked onto the build. So parity stays **20/0** with **no engine edit and no `DATA.version`
  bump** — strictly better than adding an engine event type (A1), which would have needed a data migration
  the moment any real character carried one.
- **Precedence (trust boundary):** `resolveRules()` returns the **live cloud rules first** whenever
  `_rulesStatus==='active'` (server-authoritative, the player can't edit them), and only falls back to the
  LOG snapshot when *not* active. So a player can't weaken an active campaign's bans by hand-editing the
  snapshot in their save — online, the live rules always win; the snapshot only governs the offline case,
  which was already an honor-system tier.
- **Leave = a logged clear:** on a confirmed transition to standalone (leave/clone — `rec && !rec.campaign_id`),
  a `rulesSnapshot{campRules:null}` is appended, so a character that left a campaign stops applying stale
  bans offline, and the departure is auditable in the LOG. Snapshot writes are **deduped** (skip when
  unchanged) to avoid LOG churn on every sync.
- **UX seams:** `undo()` drops trailing `rulesSnapshot` events (they're sync-written metadata, not user
  actions, and re-materialize on the next online sync) so it never gets "stuck" undoing a snapshot; the
  history ledger hides snapshot rows (they carry no AP), while the raw LOG/JSON export still shows them for
  audit.
- **Status:** **In force.** Completes the retire-pactrules task (part a + b).
