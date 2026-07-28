# D-GH14 — Campaign rules enforcement: separate `validate()` export, blocked at cloud push

Status: Active

- **Context:** the roadmap item ("DM campaign rules — configure and enforce") asked for DMs to ban
  species/masteries/boons/origin classes/origin species and toggle multi-discipline per campaign, with
  Live Sheet hard-locking characters that violate them. Its draft text said "assign D-GH7" for this
  decision, but D-GH7 was already taken (dual-source AP/co-DMs) by the time this was picked up — same
  situation Feature A/B hit with D-GH3 — so this is filed as the next free code instead. Two questions
  needed answers: (1) does enforcement live inside `compute()` or a separate export, and (2) where does
  Live Sheet actually block — every local edit, or only the point data leaves the browser?
- **Options (API shape):** (i) fold rule-checking into `compute()`'s existing `warnings` array — no new
  export, but couples an optional, campaign-scoped, DM-authored check into the one function every build
  op depends on, and every caller (fixtures, CharGen, DM Console's own embedded pricer) would need a
  `campaignRules` argument whether or not it applies to them; (ii) **a new pure `validate(b, rules)`
  export**, called only where campaign enforcement actually matters.
- **Decision (API shape):** (ii). `validate()` (`js/engine.js`, exported after `rebuildStateFromEvents`)
  takes a build and the campaign's `rules` JSON and returns `{ ok, violations: [{code, message}] }`. It
  never touches `compute()`, pricing, or `DATA` — so `DATA.version` does not bump and every existing
  fixture/caller is unaffected by this change.
- **Options (where Live Sheet blocks):** (i) run `validate()` on every keystroke/purchase and block the
  offending buy inline — most "hard-lock", but Live Sheet's local autosave (`save()`, line ~800) fires
  continuously and isn't itself a submission to anyone; blocking it would make the tool unusable offline
  and for solo play; (ii) **block only the "☁ Save to cloud" push** (`js/sync.js`'s `saveCharacter`
  caller in Live Sheet) — the one point a build actually leaves the browser and reaches the shared
  campaign.
- **Decision (where):** (ii). Local edits and localStorage autosave are never blocked; a rule-violating
  character can still be built and played solo. Clicking "Save to cloud" for a character with a
  `campaign_id` fetches that campaign's live `rules` via `getCampaign()` and calls `validate()`; on any
  violation the push is aborted with an `alert()` listing every broken rule (message text, not just a
  code), and nothing reaches Supabase.
- **Why:** this matches the architecture's existing trust boundary — the server enforces what actually
  matters (RLS on `characters.ap`, `campaign_id`), and the client enforces UX-level guardrails that can't
  be bypassed by a normal player workflow but aren't trying to survive a hostile client (same posture as
  the pre-existing local `PACTRULES:` boon/drawback/art barring already in Live Sheet, which this doesn't
  replace — that mechanism is offline/code-shared and unrelated to the new Supabase-backed campaign
  object). Gating at push means the one expensive, meaningful check (a live campaign lookup) happens once
  per save, not on every render.
- **Schema:** `campaigns.rules` (jsonb, default `{}`) — `{ bannedSpecies: [], bannedOriginSpecies: [],
  bannedOriginClasses: [], bannedMasteries: [], bannedBoons: [], multiDisciplineAllowed: true,
  houseRules: {} }`. Every field defaults to "no restriction" so an empty/missing rules object never
  produces a violation. No new RLS policy was needed: `campaigns` has no column-level `UPDATE` grant (the
  blanket table grant covers every column) and the existing `campaigns_update` row policy already
  restricts writes to `is_campaign_dm(id)`; players get read-only visibility via `campaigns_select`.
- **Status:** IN FORCE as of 2026-07-02. Engine: `js/engine.js` `validate()`. Migration:
  `sql/migrations/2026-07-02-campaign-rules.sql`. DM UI: `tools/DM-Console.html` Campaign Rules panel.
  Enforcement: `tools/PACT-Live-Char-Sheet.html` `cloudSaveBtn` handler.
