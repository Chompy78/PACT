# Plan: retire the PACTRULES code; carry campaign restrictions via a LOG rules-snapshot

> **Status: design capture (pre-implementation).** Supersedes the abandoned `refactor/house-rules-rename`
> task (see "Why the rename was abandoned"). Sibling of the campaign-model program.

## Goal
Consolidate PACT's restriction/ban system on the cloud campaign rules (DM-authoritative), retire the
redundant local "PACTRULES code" feature, and give characters a way to carry campaign restrictions offline
— reusing the engine's existing `validate()` / `cloudRuleBarred()` unchanged.

## Why the rename was abandoned (context)
Investigating `refactor/house-rules-rename` (rename local `b.campaign` → `b.houseRules`) surfaced two blockers:
1. **`b.houseRules` already exists** as a different, engine-read feature (DM customisations: custom
   boons/draws + the non-core/"Tasha" toggle; `compute()` reads it at engine lines 337–347). Renaming
   `b.campaign` onto it would merge two features and corrupt the engine-read one.
2. There are **three overlapping concepts**: (#1) cloud campaign membership+rules (`campaign_id` /
   `campaigns.rules`), (#2) `b.houseRules` DM customisations, (#3) `b.campaign` PACTRULES code-paste.

**Coverage check (decisive):** the PACTRULES code (#3) bars **boons / drawbacks / arts**; the cloud campaign
rules (#1, via `validate()` + `RULE_BAN_FIELDS`) bar **species / 2nd species / origin classes / masteries /
boons**. Overlap = boons. #3 uniquely does **drawbacks + arts**; #1 uniquely does species/classes/masteries
and is DM-authoritative. So #3 is largely redundant — retiring it only loses drawback/art bans, which we
add to #1.

## The design — a rules snapshot carried in the character's LOG (same pattern as the creation lock)
1. **Restrictions are authoritative at the campaign level** (`campaigns.rules`, cloud, DM-controlled). MVP.
2. **On bind + online, the client snapshots the campaign's ban-list into the character's own event log**
   (a rules-snapshot event), refreshed each sync. This replaces the old pasted code — same "restrictions
   travel with the character" capability, sourced from the real campaign rules.
3. **One resolver picks which rules apply:** live cloud rules when online-in-a-campaign (authoritative;
   player can't touch them); the LOG snapshot otherwise (offline, or after leaving/cloning). Non-destructive
   — precedence + refresh-on-sync, no "delete." (Same L4-style precedence as the creation lock.)
4. **The engine is reused wholesale:** `validate(b, rules)` and `cloudRuleBarred(kind, name)` already take a
   rules object — they don't care if it came from the cloud or the snapshot. No rules logic is duplicated;
   they're just fed from the resolver.
5. **Removing the snapshot is a logged action** (it's a LOG event) — a player who leaves a campaign and
   strips their restrictions leaves an auditable trail.

## Proposed approach
- **Retire #3:** remove `b.campaign`, `cat:'campaign'`, `MUT.campaign`, the PACTRULES encoder/decoder
  (`_campEnc`/`_campDec`), and the "House rules code / Campaign" UI in both tools. Remove `"campaign"` from
  test fixtures.
- **Extend #1 for parity:** add `bannedDrawbacks` + `bannedArts` to the campaign rules format —
  `validate()` + `RULE_BAN_FIELDS` + the DM Console rules editor. (validate() does not affect `compute()`
  pricing, so no `DATA.version` bump for pricing; add validate fixtures.)
- **Snapshot + resolver (the "ideal" layer):** a rules-snapshot LOG event (client-materialized on sync from
  `campaigns.rules`) + a small `resolveRules()` that returns live-cloud-rules when online-in-campaign else
  the snapshot; point `cloudRuleBarred()`/`validate()` call sites at it. Leaves `b.houseRules` (#2)
  untouched.

## MVP vs ideal
- **MVP (ship first):** restrictions at the campaign level, validated on join/save (largely already exists);
  add `bannedDrawbacks`/`bannedArts`.
- **Ideal (fast-follow):** the snapshot-into-LOG + resolver for offline carry (reuses the creation-lock
  materialization pattern — coherent, not bespoke).

## Out of scope
- `b.houseRules` (#2, DM customisations / non-core toggle) — untouched.
- Real cloud campaign membership (#1 identifiers) — untouched.
- Any `compute()` pricing change (validate/ban logic is separate from pricing).

## Alternatives considered
- **Rename #3 → houseRules** — rejected: name already taken by #2 (would merge two features).
- **Rename #3 to a distinct third name (e.g. `rulesCode`)** — rejected: keeps a redundant feature alive; the
  cloud rules already cover it better.
- **Keep #3 for the offline/no-login case** — rejected: campaign restrictions only matter when joining a
  campaign, which needs the cloud anyway; the snapshot covers offline carry without a separate mechanism.

## Risks / open questions
- **Feature parity:** confirm the DM Console rules editor can express drawback + art bans, and that
  `cloudRuleBarred()` wiring covers the `drawbacks`/`arts` picker kinds (today it wires `boons`).
- **Snapshot event format + resolver precedence** need spec care (last-wins, refresh-on-sync) — mirror the
  creation-lock materialization rules.
- Pre-launch: existing `cat:'campaign'` events / shared PACTRULES codes go inert (accepted — no real data).

## Verification
- `testing/tests/engine-parity.html` → still 20/0 (removing #3 and adding bans don't change `compute()`
  pricing output; add validate fixtures for `bannedDrawbacks`/`bannedArts`).
- Manual: a signed-in player building in CharGen against a campaign with banned drawbacks/arts sees them
  filtered; offline, the snapshot still bars them; removing the snapshot appears as a LOG entry.
- Confirm no residual `cat:'campaign'` / `b.campaign` / PACTRULES references; `b.houseRules` (#2) unaffected.

## Done when
- #3 (PACTRULES code) is removed; the cloud rules bar drawbacks + arts; a bound character carries a
  refreshed rules snapshot in its log that applies offline and is overridden by live rules online; removal
  is a logged action; parity still 20/0; #2 untouched.

---

## Readiness addendum (2026-07-13, code-verified pre-implementation — no code changed)

A read-only sweep of the current tree to confirm this plan still matches reality before anyone starts.
Findings for the implementer:

- **The "Extend #1 for parity" step is ALREADY SHIPPED (PR #174) — do not redo it.** `validate()` already
  emits `bannedDrawbacks`/`bannedArts` violations (`js/engine.js` ~675–681), `RULE_BAN_FIELDS` already maps
  `drawbacks`/`draws → bannedDrawbacks` and `arts → bannedArts` (~706–712), and DM Console already has the
  `ruleBannedDrawbacks`/`ruleBannedArts` editor grids wired through load + save
  (`tools/DM-Console.html` ~456–457, 1226–1227, 1269–1270, 1291–1292). So this task is now ONLY the two
  remaining halves: **(a) retire the PACTRULES `#3` path** and **(b) add the snapshot + `resolveRules()`
  resolver**.

- **This task DOES touch `js/engine.js`** (so treat the public API as under change, and it is a legitimate
  `/code-review` + cold-review candidate): the campaign mutator is a member of the exported `MUT` map —
  `export const MUT = {campaign:(b,p)=>{b.campaign=p.v;}, …}` at `js/engine.js:428`. Removing it (plus any
  `cat:'campaign'` handling in the fold/replay path) is an engine edit. `compute()` pricing is unaffected,
  so no `DATA.version` bump — but the parity gate (20/0) still applies because `MUT`/replay is exercised.

- **`#3` artifacts to remove and where they live** (verified present): `b.campaign` (6 refs),
  `cat:'campaign'` (3), `_campEnc`/`_campDec` PACTRULES codec (4+4), `PACTRULES` (11), `applyCampaignCode`
  (6) — all in `js/engine.js` + `tools/PACT-CharGen-Webtool.html` + `tools/PACT-Live-Char-Sheet.html`.

- **⚠️ TRAP — do NOT delete `campaignBound`.** `campaignBound` is a *different, keep-it* feature (the
  creation-lock ratchet: `js/engine.js` ~511, 529–536; fixtures `EV-007/008/009`). It is explicitly
  unrelated to the `cat:'campaign'`/`b.campaign` PACTRULES feature (the engine comment at ~510–514 says so).
  The plan's "drop campaign entries from `testing/fixtures/`" means only `#3` (`cat:'campaign'`) data —
  the `campaignBound` fixtures must survive untouched, or the creation-lock tests break. (Confirm which
  fixtures actually carry a `cat:'campaign'` buy event before deleting anything — several fixture hits on
  the word "campaign" are `campaignBound`, not `#3`.)

- **Snapshot/resolver materialization pattern to mirror:** the creation-lock's in-replay running-state
  bookkeeping at `js/engine.js` ~529–536 (`_locked`/`_spent`/`_campaignBound`, last-wins per event) is the
  precedent the rules-snapshot event + `resolveRules()` precedence should follow, per the plan's step 3.

**Recommendation:** implement in two PRs to keep each reviewable — PR-a (retire `#3`, engine + both tools +
fixtures, `/code-review` gate) then PR-b (snapshot event + `resolveRules()`). Given the engine surface and
the `campaignBound` trap, a cold plan review before PR-a is worthwhile (AGENTS.md "Cold plan review" trigger
is met: engine/rules + multi-file + a wrong retirement costs >1 cycle to undo).
