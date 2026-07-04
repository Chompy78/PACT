# PACT — Decisions (why it's built this way)

> Authoritative record of decisions **still in force**. One entry per decision:
> **Context → Options → Decision → Why → Status.** Newest at the TOP.
> `CHANGELOG.md` records *what* changed; this records *why*.

---

## D-GH19 · `ai-lessons-learned` auto-load in remote sessions: nudge-and-let-the-agent-decide, not auto-clone
- **Context:** a `SessionStart` hook (`.claude/hooks/session-start.sh`) was built to auto-load a
  separate, private cross-project repo (`chompy78/ai-lessons-learned`) into every remote/cloud
  session's context, using a fine-grained PAT (`AI_LESSONS_TOKEN`) to `git clone` it. Retesting
  with a freshly regenerated, correctly-scoped PAT still failed identically. Root-caused: remote
  sessions route all `github.com`/`api.github.com` traffic through a policy-enforcing proxy that
  injects the *session's own* scoped GitHub App credentials, overriding any PAT in the URL —
  a session can only reach repos in its explicit scope, and `ai-lessons-learned` wasn't in it.
  The only working fix was calling the `add_repo` agent tool from inside a turn — which a
  non-interactive shell hook cannot do, and which is documented to be invoked only when a task
  actually calls for it, not unconditionally every session.
- **Options considered:** (A) split into a private source repo + a public mirror containing only
  `INDEX.md`, auto-published by a GitHub Action, fetched by the hook via a plain unauthenticated
  `curl` of `raw.githubusercontent.com` — empirically verified viable (that domain is *not*
  gated by the session's GitHub-scoping proxy: tested against a public repo and a public Gist
  fully outside this session's scope, both returned real content; the private repo's raw URL
  correctly 404s unauthenticated); (B) GitHub Pages built from the private repo — dead end, Pages
  from a private repo still requires GitHub auth to view, hitting the same scoping wall; (C) drop
  automatic fetching entirely — the hook just prints a short reminder in remote sessions, and the
  agent calls `add_repo` + reads `INDEX.md` itself only when the current task looks relevant.
- **Decision:** (C). Rewrote `.claude/hooks/session-start.sh` to remove all `git
  clone`/`AI_LESSONS_TOKEN` logic; it now only prints a fixed, small reminder string in remote
  sessions pointing at the repo and telling the agent to pull it in itself if warranted.
  `AI_LESSONS_TOKEN` is no longer read anywhere in this repo.
- **Why:** the user expects `ai-lessons-learned` to accumulate a lot of private session detail
  over time and wants it to stay **fully** private — not "mostly private with a small public
  index," which is what option A would have required (once `INDEX.md` is published anywhere
  public, even a curated summary, it's a permanent trust boundary: cached/scraped copies can
  outlive a later switch back to private). Given that, the token cost of "fully automatic every
  session" (paying to load `INDEX.md` even on sessions that never touch it) was judged not worth
  crossing that boundary for. Option (C) trades full automation for near-zero cost on unrelated
  sessions and a full pull-in on sessions that actually need it.
- **Status:** DONE. Hook rewritten and verified (remote: prints reminder, exit 0; non-remote:
  silent, exit 0). Local-machine loading (`~/.claude/CLAUDE.md` `@`-import of `INDEX.md`) is
  unaffected — it never went through this proxy in the first place.

---

## D-GH18 · CharGen's `liveBase()` field diff vs `baseBuild()`: fixed the missing array, left `inPlay` out on purpose
- **Context:** CharGen's `⇆ Live Sheet` export crashed for any character with ≥1 species/racial trait —
  `buildToLiveLog()`'s local `liveBase()` (its own hand-copied duplicate of `js/engine.js`'s `baseBuild()`
  shape) was missing `racialTraits:[]`, so the local MUT's unguarded `b.racialTraits.push(p.v)` threw on
  `undefined`. The roadmap task asked for a full field diff against `baseBuild()` plus an audit of every
  other `.push()` in that local MUT, not just the one-line fix.
- **Options:** (i) add every field `liveBase()` is missing relative to `baseBuild()`, for full structural
  parity; (ii) add only `racialTraits:[]` plus whatever else the audit shows is actually load-bearing.
- **Decision:** (ii). Added `racialTraits:[]` only. The rest of the diff — `languageNames`, `grantNames`,
  `dabblerCantripNames`, `innateNames`, `featNames`, `size` — is never reached via an unguarded `.push()`
  in `buildToLiveLog`'s local MUT (every read elsewhere is already `||[]`/`||{}`-guarded), so leaving them
  unset causes no crash. One field, `inPlay`, was deliberately **not** copied even though it's in
  `baseBuild()`: all three tools' own hand-copied pricing logic branches racial-trait tier cost on
  `b.inPlay` (grown-into-tier MASTER pricing vs. origin/creation pricing), and Live Sheet's own code
  explicitly recomputes on `inPlay:false` for imported characters "so an imported creation character shows
  no phantom drift" (`tools/PACT-Live-Char-Sheet.html` ~L907). `liveBase()`'s `run`/`base0` already get
  the correct (undefined → falsy → creation-basis) pricing for a freshly-exported character; adding
  `inPlay:true` would have silently switched exported racial traits onto in-play tier pricing and changed
  `compute()` output for every export with a racial trait.
- **Why:** the two objects (`liveBase()` vs. `baseBuild()`) aren't actually meant to be identical —
  `baseBuild()` represents a generic engine-default build, while `liveBase()` specifically seeds a
  *freshly created, not-yet-in-play* export. Blindly closing every diffed field for "parity" would have
  fixed a docs-style mismatch while introducing a real pricing regression. Future field-diff sweeps
  between these two (or the eventual Task 6 bridge migration) should re-check `inPlay`'s semantics before
  copying it forward.
- **Status:** DONE. `racialTraits:[]` added; export verified in-browser (species with a racial trait no
  longer throws); the other diffed fields left as-is with this note explaining why.

---

## D-GH17 · REV-07: invite codes from `gen_random_bytes`, code length/rate-limiting deferred
- **Context:** `gen_invite_code()` built each of 6 characters via `floor(random()*36)` — Postgres's
  plain PRNG, not cryptographically secure. Invite codes gate `join_campaign`/`join_as_dm` and function as
  shared secrets, so a predictable generator is a soft spot even though the review rated it MEDIUM (a
  successful guess only lets an attacker create their own character in someone else's campaign; RLS still
  scopes all other data). The review's fix suggested three independent moves: (1) switch to a CSPRNG, (2)
  consider lengthening codes to 8 chars, (3) consider rate-limiting `join_campaign`.
- **Options:** (i) all three in one change; (ii) CSPRNG only, leave length/rate-limiting as follow-ups.
- **Decision:** (ii). `gen_invite_code()` now pulls 6 bytes from `gen_random_bytes()` (pgcrypto, already
  enabled) and reduces each mod 36 onto the existing alphabet — same 6-char length, same
  `^[A-Z0-9]{6}$` check regex, only the entropy source changes.
- **Why:** the review's own acceptance criteria for REV-07 only requires the CSPRNG swap (codes stay
  unique, still match the check regex, sourced from `gen_random_bytes`) — length and rate-limiting were
  phrased as "consider" / optional hardening, not required. Lengthening ripples into the `check` constraint
  and any UI that assumes 6 chars; rate-limiting needs a new attempt-tracking table or edge-function config.
  Both are real, separable follow-ups better scoped and reviewed on their own rather than folded into a
  MEDIUM entropy fix. mod-36 over the raw byte has a small bias toward earlier alphabet characters (256
  isn't a multiple of 36) — judged negligible for a 6-char invite code; rejection sampling was not worth
  the added complexity here.
- **Status:** DONE for the CSPRNG swap. Code length and `join_campaign` rate-limiting remain open,
  lower-priority hardening — not re-filed as a new roadmap item since the original REV-07 entry already
  covers them if picked up later.

---
## D-GH9 · Feature A found Live Sheet does NOT bridge DATA/compute/MUT from js/engine.js — edited both copies
- **Context:** The roadmap task (and `AGENTS.md`'s Architecture section) describe Live Sheet and DM Console
  as already on a "module bridge" that imports `DATA`, `compute`, `baseBuild`, `MUT`, `activeEvents`,
  `economy`, and `foldBuild` from `js/engine.js` onto `window`, with only CharGen still embedding its own
  copy (Task 6). While implementing Feature A's `found`/`dbound` MUT extension, direct inspection showed
  this is false for the mutation/pricing layer: Live Sheet's only `<script type="module">` block imports
  `validate` (from `js/engine.js`) plus sync/auth/campaign helpers — `DATA`, `compute`, `MUT`,
  `activeEvents`, `economy`, and `foldBuild` are separate, hand-written top-level declarations in the same
  file, and the file's own header comment (line 27) explicitly documents this as intentional: *"SHARED,
  DUPLICATED CODE ... copy-pasted into BOTH html files and must stay byte-for-byte in sync."* DM Console
  has the identical pattern (its own local `compute()`/`MUT`, only auth/campaign/dm helpers bridged). So
  editing `js/engine.js`'s `MUT` alone would have been a no-op for the actual running tool — the "Engine
  first, then the tools" task ordering only holds if you also patch the tool's own copy.
- **Options:** (i) trust `AGENTS.md`'s claim and edit only `js/engine.js` (would silently produce
  non-functional "Add discipline"/"Open another tradition" buttons — engine tests would stay green while
  the live tool didn't work); (ii) **edit both `js/engine.js`'s `MUT` and Live Sheet's local `MUT`
  identically**, keeping the two byte-for-byte in sync per the file's own stated invariant; (iii) use this
  task to actually migrate Live Sheet onto a real bridge for `DATA`/`compute`/`MUT` (out of scope — that's
  a separate, larger migration essentially identical to Task 6, not something to fold into a pricing
  feature).
- **Decision:** (ii). `found` (extended to add a discipline to an already-open tradition, not just found a
  new one) and the new `dbound` setter were added to both copies in lockstep. `compute()` itself needed no
  change in either file — both copies already priced `d.bound` and iterated all traditions/disciplines
  correctly before this change (dead code, unreachable via any UI path until `found`/`dbound` could
  produce that state), which is why the original task's "Engine first... ZERO compute() change" framing
  was directionally right even though its premise about the bridge was wrong.
- **Why:** `AGENTS.md` is supposed to be the single, trustworthy source of architecture truth for any agent
  picking up a task cold — "Engine first, then the tools" only makes sense read literally if the tools
  actually consume the engine. Silently going along with the stale claim would have shipped a feature that
  passes `engine-parity.html` (which only ever imports `js/engine.js`) while doing nothing in the browser.
- **Status:** IN FORCE. `AGENTS.md`'s Architecture bullet ("Three UI-only tools... load the engine via a
  module bridge") is now known to be accurate only for `validate()` plus sync/auth/campaign/dm helpers —
  `DATA`/`compute`/`MUT`/`baseBuild`/`activeEvents`/`economy`/`foldBuild` are still copy-pasted into Live
  Sheet and DM Console exactly as CharGen's are. Correcting `AGENTS.md`'s wording, and/or actually
  finishing the bridge migration for all three tools (Task 6 currently only scopes CharGen), is filed as a
  new roadmap item rather than done here — out of scope for a spellcasting pricing feature.

## D-GH15 · Function EXECUTE grants: explicit `authenticated`, not implicit `PUBLIC`
- **Context:** Supabase's security advisor (run via the newly-connected Supabase MCP) flagged `award_ap`
  and the now-dropped `award_xp` as callable by the unauthenticated `anon` role via `/rest/v1/rpc/*`.
  Investigation showed this wasn't specific to those two functions: every `SECURITY DEFINER` function in
  the schema still carried Postgres's default EXECUTE-to-`PUBLIC` grant, which none of the migrations had
  ever explicitly revoked — confirmed live via `has_function_privilege('anon', ..., 'EXECUTE')` returning
  `true` across the board. `award_ap` itself was never actually exploitable (its `is_campaign_dm()` guard
  rejects any caller without a real `auth.uid()` match, and `anon` has zero table-level grants anywhere in
  the schema), but the grant not matching intent is exactly the kind of drift that turns into a real bug
  later if an internal guard is ever refactored without someone re-checking the grant surface.
- **Options:** (i) leave it — internal guards already prevent exploitation; (ii) **revoke the default
  `PUBLIC` grant on `award_ap`, matching the explicit `authenticated` grant it already has** (this
  decision's scope); (iii) do the same across all ~12 flagged functions in one pass, including the
  RLS-helper predicates (`is_campaign_dm`, `is_campaign_member`, etc.) that have no explicit grant at all
  today and rely solely on `PUBLIC` for `authenticated` to work.
- **Decision:** (ii) for now — `award_ap`'s `PUBLIC` grant revoked, `award_xp` dropped outright (dead code
  from the XP → AP rename, zero references in `js/` or `sql/`). (iii) was investigated and confirmed safe
  (verified `anon` has no SELECT/INSERT/UPDATE/DELETE on any table, and every client-facing RPC call in
  `js/` maps only to functions that already have an explicit `authenticated` grant) but deliberately not
  applied in the same pass — it touches ~12 functions across the schema, which is a larger blast radius
  than what was being discussed when the fix was requested. Left as a scoped, ready-to-apply follow-up.
- **Why:** a `SECURITY DEFINER` function's grant should express who is *meant* to call it, not rely purely
  on internal logic to reject the rest — the internal guard and the grant are two independent layers, and
  this project has already been burned once (REV-04, D-GH12) by a case where only one of those layers was
  actually enforcing the boundary.
- **Status:** IN FORCE as of 2026-07-02 for `award_ap`/`award_xp`. The broader ~12-function grant cleanup
  is scoped and safe but NOT yet applied — pending a separate explicit go-ahead.

---
## D-GH16 · Campaign rules follow-up: live-filter pickers where a pick surface exists, not everywhere
- **Context:** D-GH14 shipped enforcement, but only at the last possible moment — Live Sheet's "Save to
  cloud" click. A player who builds around a banned choice only finds out after the fact and has to undo
  work. The obvious full fix (give CharGen, where species/origin class are actually chosen, live
  campaign-rule awareness) needs sign-in + campaign selection in a tool that has neither today, plus Task
  6 (CharGen isn't on the shared engine bridge yet) — real scope, filed separately as its own roadmap item
  rather than rushed in. This decision covers the smaller, immediate piece: what Live Sheet itself can
  live-filter right now.
- **Options:** (i) leave enforcement at cloud-push only (status quo, cheap, but doesn't touch the actual
  complaint); (ii) **live-filter every banned category everywhere the app could conceivably show it**;
  (iii) **live-filter only categories Live Sheet actually lets a player pick**, and be explicit that the
  rest stay push-time-only.
- **Decision:** (iii). Checked what Live Sheet actually exposes as a live pick: weapon masteries and
  boons are genuinely selectable there, so both are now filtered out of their pickers the moment a
  banned item's campaign rule is known — a banned option simply never appears to select. Species,
  origin class, and multi-discipline are **not** pickable in Live Sheet at all (species/origin class are
  fixed at character creation — set in CharGen or the initial build — and multi-discipline purchasing
  doesn't exist yet, pending Feature A); there is no picker to filter, so those three stay enforced only
  at "Save to cloud" (D-GH14), same as before this change.
- **Decision (owned-but-now-banned items):** an item the player already owns stays visible in the picker
  list (shown as owned, not hidden) even if a DM later bans it. Hiding it entirely would make it
  unmanageable through the UI — the owned-item control is also how a player would undo/sell it back — so
  filtering only ever removes *not-yet-purchased* banned options, never something already on the sheet.
  D-GH14's "Save to cloud" block still catches the already-owned case if it's ever pushed.
- **Decision (when rules are fetched):** Live Sheet has no automatic server reconcile on a plain page
  load — cloud sync only happens when the player interacts with the cloud menu. Added a fetch on
  sign-in/session-ready (`refreshCloudCampaignRules()`) so filtering is live from the moment the page is
  usable, not just after an explicit "Load"; the existing "Load a saved character" flow was extended to
  reuse its already-fetched campaign object instead of a second network round-trip. The authoritative
  check at cloud-push in D-GH14 still re-fetches fresh rules independently — the live-filter is a UX
  layer on top, not a replacement for it.
- **Why:** matches the same trust posture as D-GH14 — client-side guardrails for honest workflows, not a
  security boundary — and avoids overselling what this pass delivers: it measurably shortens the
  "build → get blocked → go back" loop for masteries/boons, and is honest that species/class/multi-disc
  still can't be caught early until the CharGen work lands.
- **Status:** IN FORCE as of 2026-07-02. `tools/PACT-Live-Char-Sheet.html`: `cloudRuleBarred()`,
  `refreshCloudCampaignRules()`, mastery/boon picker filters. Follow-up filed as a new roadmap item
  ("CharGen campaign-rules awareness") for the species/origin-class/multi-discipline gap.

## D-GH14 · Campaign rules enforcement: separate `validate()` export, blocked at cloud push
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

## D-GH13 · Regression gate design: CSV baseline + two-mode runner
- **Context:** REV-01 found the parity gate hard-coded `pass: true` and left `expected-results.csv` blank, so it only proved `compute()` doesn't throw, not that outputs are correct. The fix needed to assert real values, but the baseline values had to be confirmed by a human against the PHB before being committed — the agent can't verify rule correctness independently.
- **Options:** (i) hardcode expected values directly in the JS; (ii) **store expected values in a CSV** loaded at runtime, with a separate "Capture" mode to dump the live engine output for human review; (iii) a Node.js CI script (deferred as REV-11 — Node not required for the app).
- **Decision:** (ii). `engine-parity.html` has two buttons: **Capture baseline** (runs all fixtures, outputs ready-to-paste CSV rows for human review) and **Run tests / assert** (fetches `expected-results.csv` at runtime and fails any fixture whose actual value differs from the stored expected). CG-003 additionally hardwires `remaining < 0` and the "OVER BUDGET" string check regardless of the CSV, since those are structural invariants of the fixture.
- **Why:** the CSV is human-editable and lives next to the fixtures — a future agent updating a fixture can update its expected row in the same PR without touching JS. The two-mode split enforces the "human reviews before committing" policy without blocking the gate indefinitely. Note: **CG-001 total = 2 AP, not 0** — an "empty" build still pays for Hit Die 1: `DATA.HD[0].cum = 2`. Every character pays this; it is the entry cost for existing. Languages at 1, all stats at 10, and everything else on the empty fixture are all 0 AP.
- **Status:** IN FORCE as of 2026-07-01 (REV-01). Gate: `testing/tests/engine-parity.html`; baseline: `testing/expected/expected-results.csv`.

## D-GH12 · Campaign RLS: `campaign_id` column locked to SECURITY DEFINER path
- **Context:** REV-04 found that the player UPDATE grant on `characters` included `campaign_id`. A player could set their own `campaign_id` to any campaign UUID, bypassing the `join_campaign()` invite-code flow and joining campaigns without the DM's knowledge or invite code.
- **Options:** (i) add a row-level policy that validates the target campaign exists and the player holds an invite — this requires reading `campaigns` from inside an RLS policy, hitting the same recursion problem that forced SECURITY DEFINER elsewhere (D-GH4); (ii) **remove `campaign_id` from the column-level UPDATE grant** so no direct write to that column is possible at all; DM-side paths that need to set it use SECURITY DEFINER functions that bypass RLS.
- **Decision:** (ii). `campaign_id` removed from the player column-level UPDATE grant. The INSERT policy also tightened with `AND campaign_id IS NULL` so a player cannot insert a character pre-joined to an arbitrary campaign. `join_campaign()` (SECURITY DEFINER) is the sole path for assigning `campaign_id` on a character.
- **Why:** column-level grants are the only airtight guard at the Postgres layer — a row policy can be satisfied by a carefully crafted update that meets the condition; removing the column from the grant makes the write structurally impossible regardless of row state. The SECURITY DEFINER trust boundary is already established (D-GH4); this extends it consistently to cover campaign membership.
- **Status:** IN FORCE as of 2026-06-30 (REV-04). Migration: `sql/migrations/2026-06-30-rev04-campaign-rls.sql`.

## D-GH11 · Service worker caching strategy: network-first for app shell + engine
- **Context:** `service-worker.js` used a single cache-first path for all same-origin requests. A fix shipped to `js/engine.js` or any HTML page would not reach returning users until the SW's own bytes changed and the browser re-installed it — potentially days later.
- **Options:** (i) **network-first** for `*.html` + `engine.js`, falling back to cache offline; (ii) **stale-while-revalidate** (serve cache immediately, revalidate in background — fix takes a second visit); (iii) **derive `CACHE_NAME` from `BUILD`** so activate purges old caches on each release (SW can't `import` ES modules, so reading `BUILD` requires a string-grep or hardcoded sync step); (iv) keep cache-first everywhere (current, breaks prompt delivery of fixes).
- **Decision:** (i) network-first for `*.html` pages (`/\.html$/` + `/PACT/$`) and `js/engine.js`. All other same-origin assets (icons, supporting JS) remain cache-first. `CACHE_NAME` stays static — the activate handler already purges old caches when it changes manually. Option (iii) deferred: benefit is automatic purging, cost is a build-step or string-sync just to read one constant.
- **Why:** a rules fix that doesn't reach users until the next SW update is a silent correctness regression. Network-first is minimal overhead: one extra round-trip on warm hits, offline still works via cache fallback.
- **Status:** IN FORCE as of build v0.107 (REV-03).

## D-GH7 · Campaign play: dual-source AP, co-DMs, and an award ledger
- **Context:** wiring cloud save into the Live Sheet collided with the AP model. The Live Sheet self-awards
  AP via log events (player-writable), but `characters.ap` was meant to be DM-authoritative and
  uncheatable. We also need to know *which* DM gave an award, and a campaign can have more than one DM.
- **Options (AP):** (i) server `ap` is the only budget (breaks solo/honor-system play); (ii) log stays the
  only source (players can self-grant infinite AP by editing their log — defeats the security goal);
  (iii) **both sources coexist, with a per-campaign toggle.**
- **Decision (AP):** (iii). Budget = DM-granted (`characters.ap`) **+** player-entered (log awards), unless
  the campaign's `ignore_player_ap` flag is on, in which case only DM-granted counts. Solo characters (no
  campaign) just use player-entered. Tools show the breakdown and flag any difference.
- **Decision (DMs):** a campaign can have **multiple DMs**. `campaigns.dm_id` stays as the *owner/creator*;
  a new `campaign_dms` table lists everyone who can DM. `is_campaign_dm()` checks membership, so all DM
  powers extend to co-DMs. Two ways to become a co-DM: a **separate DM invite code** (`join_as_dm`) and the
  **owner promoting an existing member** (`promote_to_dm`, owner-only).
- **Decision (attribution):** AP awards are recorded in an `ap_awards` ledger (character, dm_id, amount,
  note, time); `award_ap()` writes a ledger row stamped with the calling DM and updates the running
  `characters.ap` total. So every award is attributed and auditable.
- **Why:** dual-source keeps security available *where the DM wants it* without crippling solo/honor play;
  the ledger gives attribution + history (matching the Live Sheet's event-sourced ethos); a membership
  table is the only way to express co-DMs, and offering both join paths covers self-service and curated add.
- **Status:** IN FORCE. Supersedes D-GH4's "one DM per campaign / single `ap` write". Schema + RLS updated;
  client (DM Console, Live Sheet AP combination) follows.

## D-GH4 · Data model: per-campaign non-exclusive roles, no player cap, ap locked at the column level
- **Context:** Task 3 needed the Supabase schema + RLS. The plan assumed a global Player/DM role, a 5-player
  cap, and "the characters UPDATE policy must exclude the [points] column from player writes." (The plan
  called the DM-awarded points "xp"; PACT's currency is **AP**, so the column is `ap` — see also the rename.)
- **Options (roles):** (i) global role flag on the profile; (ii) roles derived per-campaign from the
  relationship (DM = `campaigns.dm_id`; player = owning a character in that campaign), allowed to overlap
  even within one campaign.
- **Options (ap):** (i) a row policy / trigger that rejects ap changes; (ii) revoke blanket UPDATE and grant
  UPDATE only on player-writable columns, with a DM-only `award_ap()` SECURITY DEFINER RPC as the sole ap
  write path.
- **Decision:** per-campaign overlapping roles (no stored role column); **no player cap** (overrides the
  plan's "up to 5"); ap protected by a column-level GRANT plus `award_ap()`. Joining and code regeneration go
  through SECURITY DEFINER RPCs (`join_campaign`, `regenerate_invite_code`) so players never need broad read
  access to `campaigns`. Cross-table RLS checks live in SECURITY DEFINER helpers to avoid policy recursion.
- **Why:** the same person can run one table and play at another (or even play in their own game), which a
  global flag can't express. Postgres RLS can't scope an UPDATE to columns, so the column GRANT is the only
  airtight ap guard — a row policy would still let a player set ap in an otherwise-valid update.
- **Status:** IN FORCE. Plan doc (`docs/PWA-BUILD-PLAN.md` Task 4) still says "up to 5 players" and needs
  updating to match.

## D-GH8 · PWA service-worker registration lives in every tool page (Task 1)
- **Context:** the PWA shell (manifest, `service-worker.js`, `404.html`, icons) had landed and `index.html` registered the SW, but the three `tools/*.html` pages did not — so installing/offline only worked from the menu, not the tools themselves.
- **Options:** (i) register the SW only from `index.html` and rely on scope to cover the tools; (ii) add the registration block to each tool page explicitly.
- **Decision:** (ii). The shared registration script + `<link rel="manifest" href="/PACT/manifest.json">` were added to all three tool pages, using absolute `/PACT/` paths, with an in-page "new version ready / Reload" bar on `updatefound`.
- **Why:** each tool is a directly-bookmarkable/installable entry point; explicit per-page registration guarantees the manifest + update prompt regardless of how the user arrived. Engine logic untouched.
- **Status:** IN FORCE.

## D-GH6 · Versioning scheme — three independent numbers
- **Context:** the header now displays version info and it was ambiguous which number means what.
- **Decision:** keep three independent counters: **(1) Tool/build version** — the `v0.x` in each tool's top comment, `<title>`, and header label (CharGen & Live Sheet bumped 0.106 → **0.107**); **(2) PACT rules version** — `DATA.version`, canonical and stamped on saved JSON, shown as "PACT rules · v0.322", kept in sync CharGen ↔ Live Sheet and bumped only when mechanics change; **(3) DM Console** — its own `TOOL_VERSION` counter (0.014 → **0.015**).
- **Why:** rules changes and cosmetic tool changes have different audiences and cadences; conflating them would force needless `DATA.version` bumps (and re-validation) for pure UI work.
- **Status:** IN FORCE.

## D-GH5 · Mobile header uses an "app-shell" layout, not `position:fixed/sticky`
- **Context:** after the header rebuild, the header would not stay pinned on a real Pixel, even though it worked on desktop and in a narrow desktop window.
- **Investigation:** a self-reporting diagnostic proved the header was *positioned* correctly on the phone — `getBoundingClientRect().top === 0` at full scroll, `scrollingElement === <html>`, no inner scrollers — but it wasn't being **repainted** at top:0 while the whole window scrolled a heavy (~500 KB) page (a mobile-Chrome compositor limitation). A `transform:translateZ(0)` GPU hint didn't fix it; switching `fixed`↔`sticky` made no difference.
- **Options:** (i) keep fighting the compositor with GPU hints / position tweaks; (ii) stop scrolling the window on mobile altogether and adopt an app-shell.
- **Decision:** (ii), mobile (≤768px) only: `body` becomes a flex column with `height:100dvh; overflow:hidden`; the header is a **static** `flex:0 0 auto` bar; `.layout` becomes its own scroll area (`flex:1; overflow-y:auto`). The header is no longer inside the scrolling region, so it can't scroll away. Desktop keeps `position:sticky` + window scroll. "Jump to section" scrolls the inner area via `scrollIntoView` when the header is static. **Header information architecture** alongside this: desktop = 4 rows (name+AP · title+versions+last-edited+theme · action buttons · nav chips); mobile = 2 rows (name+AP · Random/Reset/Jump-to-section). Breakpoints kept independent: header 768px, layout grid 920px, phone tuning 600/380px.
- **Why:** robust on real hardware and the correct base for the planned PWA (app-shell is the standard PWA layout). Trade-off: in a plain browser tab the mobile address bar no longer auto-hides on scroll — moot once installed as a PWA.
- **Status:** IN FORCE.

## D-GH3 · CharGen exports now match the Live Sheet's native event format
- **Context:** CharGen → Live Sheet exports were bundling itemized purchases into coarse patch events, so imported drawbacks could not be bought off and ledger entries were missing for individual purchases.
- **Options:** (i) keep the coarse patch export and patch the Live Sheet to infer itemized buys from patches; (ii) change the exporter to emit discrete native buy events for each itemized purchase while preserving the existing totals and ordering.
- **Decision:** (ii). The export now writes the same discrete buy events the Live Sheet would create when an item is bought natively, while keeping structural patches for scalar and blob-style fields.
- **Why:** imported characters should be indistinguishable from hand-built ones in the Live Sheet, including buy-off behavior, per-item ledger lines, and per-item cost drift.
- **Status:** IN FORCE.

## D-GH2 · Carry the changelog / decisions / narrative discipline into the GitHub repo
- **Context:** the pre-GitHub Cowork project kept a rich `CHANGELOG.md`, `DECISIONS.md`, and session
  narratives. The new GitHub repo had an architecture instructions file (`pact-agent-instructions.md`) but
  no logging discipline — so context would stop travelling between AI sessions.
- **Options:** (i) keep the logging notes only in Cowork; (ii) move the three logging docs into the repo and
  make the AI-agent instructions require updating them on every change.
- **Decision:** (ii). One master instructions file (`AGENTS.md`, copied to `CLAUDE.md` +
  `.github/copilot-instructions.md`) now carries BOTH the architecture/PWA plan AND a "log as you go" rule
  that points every agent at `CHANGELOG.md` / `DECISIONS.md` / `docs/sessions/`.
- **Why:** in-repo docs version with the code and show up in every diff/PR, so the discipline is enforced by
  review instead of memory; one master file copied to the tool-specific names means Copilot and Claude both
  follow identical rules without re-pasting context each session.
- **Status:** IN FORCE.

## D-GH1 · Repo layout: one shared `js/engine.js`, tools are UI-only, deploy via GitHub Pages
- **Context:** moving PACT from Cowork (engine inlined into each standalone HTML tool) to GitHub Pages.
- **Options:** (i) standalone single-file tools with the engine inlined in each; (ii) centralise the engine
  in one `js/engine.js` and have the tools import it via a module bridge; (iii) both.
- **Decision:** (ii) — `js/engine.js` is the single source of truth; `tools/*.html` import it; the site is
  served by GitHub Pages at `/PACT/`.
- **Why:** one engine to edit means the three tools can never silently diverge; Pages gives a free public
  URL. Trade-off: tools are no longer single-file/offline (the PWA task restores offline via a service worker).
- **Status:** IN FORCE.

## D-014 · PHB pages + drawback text are display data — fill them, keep `DATA.version` v0.322, bump build to v0.106
- **Context:** the long-standing open thread was "PHB page numbers + 69 drawback descriptions, awaiting John's source." John supplied a PHB-rules JSONL (`Feat`/`Equipment` entries carry a `page`) and the Players-Guide **v0.324** HTML (drawback table). On inspection the tools showed `drawbackFx` was **already fully populated** (69 strings) — the restart-status note was stale — and `masteryFx` already carried the effect text with `page:null`.
- **Options:** (i) treat the new guide as authoritative and **overwrite all 69** drawback strings; (ii) **reconcile** — diff the engine text against the guide and change only what differs; (iii) skip drawbacks (already filled) and only add pages. Also: whether to bump `DATA.version` to v0.324, and whether to bump the build counter.
- **Decision:** (ii) reconcile. Pages: `masteryFx[*].page`=214 (all 8, from the JSONL `Equipment` "(mastery)" rows) and `page` on **41/43** arts matched by name to the JSONL `Feat` rows (Blessed/Druidic Warrior absent → left page-less, no fabrication). Drawbacks: **53 already identical**, **10 synced** to the guide's fuller wording, **6 split `Affliction —` rows kept** (guide stores them as one combined row). `DATA.version` **stays v0.322**; build bumped **v0.105→v0.106**.
- **Why:** the 10 drawback diffs only *added* DEX/WIS cap clauses that `drawbackMaxStats` **already enforces** — so the change is display-only, not a rules/mechanics change, and bumping `DATA.version` (→ gate expectations in G4/G5) would misrepresent that. Overwriting all 69 (i) risked clobbering correct text with parse noise; reconciling is the minimal, auditable change. A build bump is the CONTEXT §6 convention for a significant build and keeps John's original v0.105 tar a distinct artifact. Surgical `JSON.stringify` round-trip replacement on `src/engine/data.js` (verified the serialization appears verbatim first) kept the diff to exactly the three sub-objects.
- **Status:** DONE (v0.106) — 46 gates green; G1 (build-check) + G3 (version-consistency) verify the bump is consistent. **One open question for John:** the 6 `Affliction —` entries have no cap clause in their text (caps still enforced via `drawbackMaxStats`); append "…capped at 10" to each for parity with the synced 10, or leave split-and-terse? Awaiting his call.

## D-013 · Outline labels never reset within a session (continue A→Z→AA, not restart at A1)
- **Context:** the INDEX "Output format (ALWAYS)" rule restarted the outline at A1/B1 at the top of **every** response, so a handle like "A1" was unique only *within one message* and collided across turns — the user could not reliably refer back to an item from an earlier reply ("I get confused as you reuse the A1, A2").
- **Options:** (i) per-response number prefix — stamp each reply, handles become `2A1`, `3B2`; (ii) **don't reset the capital letters** — keep climbing A…Z then AA, AB… across the whole session, item numbers reset within each group; (iii) topic/semantic group tags (`BUILD-1`, `FIXTURES-2`).
- **Decision:** (ii) — never reset the letters. Each response continues at the next free letter where the last one stopped; spreadsheet-style AA, AB… after Z; numbers reset to 1 inside each new group.
- **Why:** reuses the A1/A2 syntax the user already knows (no new prefix to learn) while making every handle globally unique for the life of the session, so "D2" addresses exactly one item. Per-prefix (i) was heavier to type/track; semantic tags (iii) can still collide when a topic recurs.
- **Status:** DONE — INDEX "Output format (ALWAYS)" updated. Style-only convention (not gate-enforceable — same class as the other prose-style rules, per D-005: gates verify version *strings*, not output *style*).

## D-012 · Character test fixtures — engine-verified generation (SPEC'D, not built)
- **Context:** need sample character files for GitHub testing.
- **Scope:** 1 empty character · 4 valid CharGen builds at **50 / 150 / 250 / 500 AP** (diverse archetypes, ~90–100% of budget) · 4 invalid builds (spread: **over-budget · missing-prereq · illegal-buy · cap/duplicate**) · the 4 valids re-expressed as **Live-Sheet histories** folding to the *identical* build · a manifest. Output: `tests/fixtures/samples/`. Stamp `rules:"v0.322"`.
- **Options:** hand-author the JSON · generate by driving the real engine.
- **Decision:** generate by driving the engine — `loadEngine` (from `scripts/headless.cjs`) → `foldBuild`/`setLOG`/`compute`/`economy`; price every buy via the marginal delta `compute(after).total − compute(before).total`; verify each file (legal + within budget for valids; the intended ⛔/over-budget for invalids); CharGen flavour = one award + bulk build, Live-Sheet flavour = multiple awards + granular buys folding to the same build.
- **Why:** AP pricing/legality is too complex to hand-write; engine-verification guarantees the fixtures actually load and validate. Files are `{rules,name,LOG,SEQ}` event logs (build is folded from the LOG).
- **Status:** CLOSED (v0.104) — **John authored the sample fixtures manually**, outside this record's engine-generation plan; no longer an action item. Record kept for the rationale (per D-003). *(Optional follow-up: the manual files can still be validated by loading them through the engine — `loadEngine` → `foldBuild`/`compute` — to confirm they load and price legally, which was the original reason for engine-generation.)*

## D-011 · GitHub hosting model — CLOSED (standalone single-file / offline)
- **Context:** project will be published to GitHub; want "a single DM section where DMs do everything".
- **Options:** (i) GitHub Pages site loading one shared `engine.js` (true on-disk dedup, online only); (ii) standalone single-file downloads (offline, what we have); (iii) both — `src/` as source, Pages for the live site + built single-file downloads for offline.
- **Decision (v0.104, CLOSED per John — "close permanently"):** commit to the **standalone single-file / offline model** (option ii) as the delivery format — the engine stays **inlined** in each tool via `src/engine/*.js` + `scripts/build.cjs` (already in place per D-009). Standing up a GitHub **Pages** site (i/iii) is **no longer an open blocker**: if ever wanted it is purely **additive** (a Pages front-end over the same `src/`) and does **not** change the offline downloads or reopen this question.
- **Why:** the offline single-file path is a hard constraint (`PACT-CONTEXT.md` §4.1 — runs from `file://`, no network/build step), so the delivery format was effectively forced; committing now unblocks the DM-console merge (D-010 / G2) without waiting on a publishing decision.
- **Status:** CLOSED (v0.104). Reversible only by a deliberate new decision if publishing requirements change.

## D-010 · DM consoles — merge into one "DM section" (DONE v0.105)
- **Context:** two consoles (CardGrid, DataTable) are the same tool, two layouts; user wants one DM home.
- **Options:** keep two files · merge into one console with a Card/Table toggle.
- **Decision:** merge — but as its own verified step, **not** folded into Option A.
- **Why:** it's a UI change needing visual QA (not a provable mechanical one); Option A already de-dups their engine, so the remaining win is product/UX, not tokens. Tied to D-011 (hosting → CLOSED single-file/offline).
- **Status:** DONE (v0.105). Merged into `dm-consoles/DM Console - Unified-v0.015.html` (CardGrid card view default + DataTable table view, topbar toggle, one shared engine/roster). The two originals were retired; John signed off ("I like the unified dm console"). integrity-audit **M6** now expects 1 console; build-check **G1** + 46 gates green.

## D-009 · Option A — single-source engine via in-place byte-identical build (not templates, not file-merge)
- **Context:** the engine (~238 KB) was duplicated byte-identical across 4 HTML tools; edits were hand-mirrored.
- **Options:** leave as-is · merge the two big tools · external `engine.js` via `<script src>` (breaks standalone) · templates + markers + build · in-place brace-match build that rewrites the engine block inside each tool.
- **Decision:** in-place build — `src/engine/*.js` is the source; `scripts/build.cjs` re-inlines it into each tool.
- **Why:** the first build is **provably byte-identical** (tools unchanged), so adoption was non-destructive and verifiable; tools stay standalone single files; reuses the existing brace-matcher; minimal churn. The engine stays physically inlined (standalone requirement) — dedup is at the *source/edit* level, not on disk.
- **Status:** DONE. Enforced by `build-check` (gate G1).

## D-008 · Don't merge CharGen + Live-Sheet
- **Context:** they're the two biggest files and share the engine.
- **Options:** merge into one build-to-play tool · keep separate.
- **Decision:** keep separate.
- **Why:** different jobs and different economic models (builder budget-meter vs in-play event log + frozen pricing); merging is a risky product change for a partial win. Option A is the better token fix.
- **Status:** DONE (decided). Could revisit only as a deliberate product goal.

## D-007 · Three-layer history docs + log-as-you-go
- **Context:** need to capture *why* and *discussion*, not just *what*, without bloating the changelog.
- **Options:** put reasoning in the changelog · separate docs per concern.
- **Decision:** CHANGELOG = *what* (condensed); `DECISIONS.md` = *why* (this file); `archive/sessions/` = *discussion/dead-ends* (history). Log substantive changes before finishing a session.
- **Why:** keeps the changelog scannable; makes "why is it this way" findable; matches the changelog's own "reasoning lives in archive/" note.
- **Status:** DONE.

## D-006 · Addressable test codes (A–G), not renamed test files
- **Context:** ~45 gates with domain names; user wanted to run them by short handle ("run test C3").
- **Options:** rename files to generic codes · add a code layer on top.
- **Decision:** code layer — keep the meaningful filenames; `audit-all.cjs` runs by code/group/`--list`; catalogue in `tests/TESTS.md`.
- **Why:** renaming loses the meaning that tells you what failed and risks breaking the suite; a lookup layer gives addressability with zero risk.
- **Status:** DONE.

## D-005 · Machine-checkable version marker + gates, because a doc can't watch itself
- **Context:** front-door docs can silently go stale (the v0.313/v0.309 note already had).
- **Options:** trust discipline · gate it.
- **Decision:** a `<!-- PACT-CURRENT … -->` marker checked against the tools by `version-consistency` (G3); plus `changelog-gate` (G6) for undocumented version bumps.
- **Why:** a gate can verify a version *string*; it can't verify prose *style* (that stays an instruction). Enforce what's enforceable.
- **Status:** DONE.

## D-004 · File types: prose = Markdown, flat tables = TSV, queried records = JSON
- **Context:** "should some docs be JSON/JSONL for efficiency?"
- **Decision:** keep prose in Markdown; tabular data in TSV (no repeated keys); nested records in JSON.
- **Why:** converting prose to JSON *adds* tokens and hurts readability; TSV is the leanest for tables. The project already split this way (prices = TSV, spells = JSON).
- **Status:** DONE (confirmed; no change needed).

## D-003 · Keep history (archive), don't delete
- **Context:** cleanup of stale/finished files (CHANGELOG, ki-audit, old restart sections, fuzz harness).
- **Decision:** move them to `archive/` (marked non-authoritative, never auto-read) — don't delete.
- **Why:** deletion is irreversible and loses rationale (e.g. the ki-audit's source-verified tagging); archiving removes the token cost without destroying the record. Originals also survive in the input tar.
- **Status:** DONE.

## D-002 · Many small single-purpose files + archived history, NOT a merged megafile
- **Context:** "can we combine the md files and stay token-efficient?"
- **Decision:** keep small focused files; move history out of the live read-path into `archive/`.
- **Why:** token cost = content *loaded*, not file count; small files let a session open only what it needs. Merging forces loading everything (or fragile anchors). Live read-path trimmed ~111 KB → ~32 KB.
- **Status:** DONE.

## D-001 · Front-door `INDEX.md` as the single entry point
- **Context:** a fresh session loaded too much (or the wrong/stale doc) to orient.
- **Decision:** one small `INDEX.md` read first — bootstrap line, read-order, file map, conventions; everything else subordinate and linked.
- **Why:** a session orients from ~8 KB instead of ~2 MB and is told what to open; the bootstrap line (or an auto-loaded pointer) is what makes a session actually read it.
- **Status:** DONE.
