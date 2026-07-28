# D-GH44 — CharGen campaign-rules awareness: separate module script for the cloud bridge; no campaign_id carry-forward yet

Status: Active

- **Context:** the roadmap task (`feat/chargen-campaign-rules`) asked CharGen to import `validate()` from
  `js/engine.js`, add sign-in + campaign selection matching Live Sheet's bridge pattern, live-filter banned
  species/origin classes/masteries/boons out of CharGen's pickers, and decide whether CharGen's "Export to
  Live Sheet" handoff should carry the selected `campaign_id` forward automatically. Two implementation
  questions came up that weren't in the task text: (1) CharGen's engine module bridge had zero network
  dependency before this task — does adding `js/auth.js`/`js/campaign.js` change that, and (2) can
  `campaign_id` actually be carried forward given how campaign membership works today.
- **Finding (1) — a real regression, caught before merge:** `js/auth.js` and `js/campaign.js` both
  transitively import `js/supabase-client.js`, which loads `@supabase/supabase-js` from a CDN (`esm.sh`).
  Live Sheet and DM Console already import auth/campaign in the *same* `<script type="module">` block as
  their engine bridge (`DATA`/`compute`/etc.) — an ES module's imports are all-or-nothing, so a failed CDN
  fetch (offline, blocked network) throws and aborts that whole script, taking `engine-ready` down with it.
  Verified directly: dropping the same imports into CharGen's existing single engine-bridge script made
  `#form` render nothing at all under a blocked CDN (confirmed against the pre-change file in the same
  network conditions, which still booted normally — no such import existed before). CharGen's header badge
  explicitly promises "no sign-in, no cloud sync" still works with no network at all; silently breaking that
  for the sake of a nice-to-have cloud feature would be a regression, not a trade-off worth making.
- **Options (module structure):** (i) leave auth/campaign in the same script as Live Sheet/DM Console do —
  consistent with the existing pattern, but inherits the same latent fragility (untested here, out of
  scope to fix in this task); (ii) **split CharGen's cloud imports into their own, independent
  `<script type="module">`** — a failed import there only loses the new cloud-campaign UI (which already
  has a correct, static signed-out fallback in the HTML), never `engine-ready`.
- **Decision:** (ii), for CharGen only. Live Sheet/DM Console are unchanged (out of scope for this task —
  they already have cloud UI as their primary interaction mode, whereas CharGen's core promise is
  offline-first with cloud as a pure add-on, so the asymmetry in how much this matters per tool is real).
  Verified post-split: CharGen boots fully (species/origin-class/mastery pickers all populate) under a
  blocked CDN; a mocked signed-in session with a campaign carrying banned items still correctly filters all
  three pickers once the cloud import succeeds.
- **Finding (2) — `campaign_id` carry-forward isn't just a metadata pass-through:** `campaign_id` lives only
  as a column on the Supabase `characters` table, set exclusively by the `join_campaign(code)` RPC — which
  itself *creates* a new blank `characters` row bound to that campaign as its join mechanism (`sql/schema.sql`
  `join_campaign`). CharGen has no `characters` row of its own (no `sync.js` wiring at all) to bind. Forwarding
  a bare `campaign_id` value through the existing handoff baton (`writeHandoff`/`takeHandoff`,
  `js/character-store.js`) would currently do nothing: Live Sheet's own `campaign_id` is read exclusively
  from the loaded cloud character record (`rec.campaign_id`) after `loadCharacter()`, never from the handoff,
  and neither `saveCharacter()` nor `pushCharacter()` ever write `campaign_id` client-side. Actually wiring
  automatic carry-forward would need new plumbing (e.g. a way to bind an already-built LOG to a
  freshly-joined campaign) that doesn't exist yet — beyond this task's "small, standalone" framing.
- **Decision (data flow):** do not carry `campaign_id` forward in this task. CharGen's cloud campaign
  selection stays purely informational/live-filter — it never writes anything back to Supabase. A future
  task can revisit this once (or if) CharGen gains its own `characters` row/cloud-save path.
- **Also discovered, not fixed here:** `joinCampaign(code)`/`joinAsDm(code)` (the only way a *player* becomes
  a campaign member today) has **no production UI anywhere in the app** — the only caller in the whole repo
  is `testing/campaign-test.html`. `listMyCampaigns()` only returns campaigns you're already a member of
  (RLS: `dm_id = auth.uid() or is_campaign_dm(id) or is_campaign_member(id)`), so a player who has never
  joined a campaign (e.g. via that missing UI) sees an empty list in CharGen's new campaign picker — it works
  today only for a DM/co-DM previewing their own campaign's rules, or a player who already has a
  campaign-bound character from some other route. Filed as a new roadmap item below.
- **Addendum (same PR, cleanup pass on `/code-review` findings):** two of the review's cleanup findings
  needed a scope call. (a) `cloudRuleBarred()`'s kind→rules-field mapping was hardcoded a second time here,
  duplicating both `validate()`'s own schema and a third, narrower copy already in Live Sheet — fixed by
  exporting it once from `js/engine.js` as `RULE_BAN_FIELDS` (display-only, next to `validate()`, never
  read by `compute()` — no `DATA.version` bump, same precedent as `racialFx`/`drawbackFx`/`masteryFx`) and
  having CharGen consume it. Live Sheet's own copy is deliberately **not** touched here — updating it is a
  second tool's file, outside this PR's stated scope, and a legitimate small follow-up rather than
  something worth expanding this branch for. (b) `window._cloudCampaignRules` (a second global, derivable
  from `window._cloudCampaign.rules` and only ever written alongside it) is gone, replaced by a
  `cloudRules()` accessor — removes a class of drift bug with no behavior change.
- **Status:** IN FORCE as of 2026-07-11. Engine: `js/engine.js` gains `RULE_BAN_FIELDS` (display-only,
  addendum above); `validate()` itself predates this, D-GH14. Tool: `tools/PACT-CharGen-Webtool.html` —
  two-script module bridge, header campaign widget, `buildSpeciesSelects()`/`buildOriginClassSelects()`/
  `buildMasteryGrid()`/`cloudRuleBarred()`/`cloudAllowedList()`/`cloudRules()`.
