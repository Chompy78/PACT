# PACT — Task Board

> Written for agentic assistants (VS Code Copilot & Claude Code). With `AGENTS.md` committed, you don't
> repeat project context — **paste one task at a time**, review the diff, accept. Each task ends with a
> **Done when** check.
>
> **Rules for this file** (see `AGENTS.md`):
> 1. Holds only **open / planned** work. When a task is DONE, **move it into `CHANGELOG.md`** in the same change.
> 2. **Single writer.** Agents: *output* new items in this format for the human to fold in — don't append directly.
> 3. One task per branch. The open git branch is the "in flight" signal.
>
> **`REV-NN` items** come from the 2026-06-29 code review. Full evidence, code, and acceptance criteria
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this task board so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.

## Harden the entire invitation system — TODO
Branch `fix/harden-invitation-system`. **Confirmed live privilege-escalation bug, not a design
nice-to-have** — verified 2026-08-08 by reading the actual schema/RLS on `preview`, not assumed:
`campaigns_select` RLS is `dm_id = auth.uid() OR is_campaign_dm(id) OR is_campaign_member(id)` — row-level
only, no column restriction — so any ordinary player (a campaign member) can `SELECT dm_invite_code`
straight off the `campaigns` table via PostgREST today, and `js/campaign.js` already exports a
SECURITY-DEFINER `joinAsDm(code)` RPC with no UI gate. A player who reads that column and calls the RPC
directly can self-promote to DM in production right now, no UI needed.

**Supersedes/folds in the NEXT-band "Wire up joinAsDm()" task** (removed from `docs/TASK_BOARD_NEXT.md` in
the same change this task was added) — that task's plan was to add a UI button redeeming
`dm_invite_code` as-is, which would have shipped a friendly front door onto the exact flow being replaced
here. Redeeming as a co-DM belongs as a step of this task, built on the new model, not the old one.

**Not green-field — audit before assuming scope.** A `campaign_invites` table already exists for
**player** invites (`decisions/2026/D-GH-2026-07-13-campaign-invite-tokens.md` and its neighbors): single-
use CSPRNG tokens, `create_player_invite`/`redeem_player_invite`/`list_campaign_invites`/
`set_invite_revoked` (revocation), `regenerate_invite_code` (regenerating invalidates the prior token).
That already covers a real chunk of the Model/Security requirements below for the player side. **DM
invites are NOT on that system** — `campaigns.dm_invite_code` is still a flat, reusable
`^[A-Z0-9]{6}$` code from `gen_invite_code()`, nowhere near 128 bits of entropy, and is the column leaking
per above. Also see the related (not overlapping, don't fold in) NEXT task "Let an invite link identify
its campaign before it is redeemed" — that task's token-peek RPC will need to target whatever unified
model this task produces, so sequence or cross-check against it.

**Model.** Design (or extend the existing `campaign_invites` table into) a unified invite system:
`campaign_id`, `type` (`PLAYER`/`DM`), `mode` (`SINGLE_USE`/`REUSABLE`), a ≥128-bit cryptographically
random token (store a hash, not usable plaintext, where practical), `created_by`, `created_at`,
`expires_at`, `revoked_at`, `redeemed_at`/`redeemed_by` for single-use, an optional redemption
count/limit for reusable invites. Defaults: player and DM single-use available by default; reusable
invites (either type) only exist when a DM explicitly generates them; every invite is revocable.

**Security requirements** (the critical ones from the finding above are 1 and 12; the rest close out the
class of bug so it can't recur elsewhere):
1. Remove `dm_invite_code` from `campaigns` (or otherwise make it unreadable by ordinary players) — this
   is the confirmed live leak.
2. Never expose invite secrets through tables, RLS, views, PostgREST, or client queries — plaintext
   secrets only ever leave the server at creation time, via an RPC return value.
3. ≥128 bits of cryptographic randomness per token; no short/predictable codes as the actual security
   primitive.
4. Store hashes, not usable plaintext, where practical.
5. No API to retrieve a previously-generated plaintext token — only the creation call returns it.
6. Redemption only through server-side `SECURITY DEFINER` RPCs, never client-side inserts.
7. Atomic expiry/revocation/type/campaign validation + single-use redemption so concurrent requests
   cannot double-redeem (this repo has hit exactly this race before in the join path — see
   `decisions/2026/D-GH-2026-07-13-campaign-join-race-friendly-error.md` — reuse that pattern).
8. Reusable invites: explicit enable/generate, revocable, expirable, regeneratable; regenerating
   invalidates the previous token (existing `regenerate_invite_code` already does this for the player
   shared code — extend the pattern, don't reinvent it).
9. Bind tokens server-side to their own campaign and type; never trust a client-supplied `campaign_id`.
10. Generic invalid/expired/revoked responses to reduce token enumeration.
11. Rate-limit/abuse-protect invitation redemption and generation.
12. A player must never be able to use, discover, modify, or manufacture a DM invitation.
13. Preserve campaign isolation and existing DM/player authorisation boundaries.
14. Do not weaken RLS or rely on UI hiding for security.

**Migration.** Safely migrate existing player/DM invitations and campaigns; do not expose the existing
`dm_invite_code` value during migration; decide and document (in `DECISIONS.md`) how existing reusable
DM/player codes are rotated or invalidated.

**Effort:** high · **Risk:** high — ambiguity is high (unifying two invite mechanisms into one model, and
deciding the migration/rotation story for existing codes, are genuine architectural calls with no single
obviously-right answer); damage scale is high (touches core auth/security schema, RLS, and all three
tools' campaign-join flows); damage likelihood is medium-high given this is security-critical
production auth code — worst-of lands at high, **never eligible for `/sweep-code-tasks`**. **Run
`/make-code-cold-plan-review` before implementation** — this meets every trigger in `AGENTS.md`'s own
rubric (multi-file, security/rules-adjacent, real design trade-off, and a wrong approach here costs far
more than one implementation cycle to undo).

```text
1. Audit ALL existing invite RPCs, RLS policies, views, and client code for other privilege-escalation
   paths before designing the fix — don't assume the dm_invite_code leak found here is the only one.
   Check every SELECT-able table/view for a column that shouldn't be player-readable, the same way this
   task's own finding was confirmed (read the actual RLS policy text, don't assume from a comment).
2. Design (or extend) the unified campaign_invites model per the Model section above; decide DM-invite
   generation/redemption to mirror the existing player Path A pattern (create_*_invite/redeem_*_invite/
   list_*_invites/set_*_revoked/regenerate_*), reusing those functions' shape rather than inventing new
   ones where the existing player-invite functions already solve the same problem.
3. Remove/neutralize `campaigns.dm_invite_code` per Security requirement 1; confirm via a fresh RLS read
   (not just code inspection) that no authenticated non-DM role can select it anywhere.
4. Wire DM-invite redemption through the new model (this is where the folded-in joinAsDm task's UI work
   belongs — DM Console needs a "Join/redeem as co-DM" affordance, but built against the new hardened
   RPC, not the raw dm_invite_code).
5. Write the migration: existing campaigns' dm_invite_code values must be rotated/invalidated, not
   quietly left live during the transition. Document the chosen approach in DECISIONS.md.
6. Add/update the full security test list from the task description: player cannot read any DM invite
   secret; player cannot escalate to DM; cross-campaign invite access fails; wrong invite type fails;
   expired/revoked invites fail; single-use invites cannot be redeemed twice including concurrently;
   reusable invites work only when explicitly enabled and can be revoked/regenerated; a client cannot
   choose the campaign during redemption; direct table/API manipulation cannot create memberships; invite
   secrets are never returned through normal campaign queries; existing RLS/auth/security tests still pass.
7. Run the Supabase advisor (`get_advisors`) and skim `get_logs` before opening the PR — this project has
   been bitten by RLS/grant drift twice before (D-GH15, D-GH12) and this change touches exactly that
   surface.
8. Run the full test/security suite; fix any regressions before declaring this complete.
```

**Done when:** `dm_invite_code` is no longer readable by ordinary players (verified against live RLS, not
just code); DM and player invites both run through the unified, hardened `campaign_invites` model with
server-side redemption RPCs; the full security test list above passes; the Supabase advisor reports no
new findings; `engine-parity.html` and the existing test/security suite are unaffected; the migration for
existing campaigns' codes is documented in `DECISIONS.md`.

## Split starting AP into creation AP + awarded AP (and fix CharGen's clunky budget entry) — TODO
Branch `feat/creation-vs-awarded-ap`. Owner's design, 2026-08-05. **Do this before
`fix/creation-lock-survives-reload`** — it removes that bug's cause instead of patching it.

**The idea.** A character's starting AP is currently one number, and the creation lock measures against a
flat `DATA.level1AP` (79). Those should be two different things:

- **Creation AP** — the default figure for the chosen track (Standard 79, Generous 83, Lean 75, Level-0
  prelude 55, or custom). This is what the creation lock measures, and creation prices and warnings apply
  while spending it.
- **Awarded AP** — everything above that. Treated exactly like DM-awarded AP in the Live Sheet: it is
  post-creation, so it buys at post-lock prices.

So a 5th-level starting character is given their full starting AP however the DM sets it, spends the first
~79 under creation pricing with the usual warnings, and the remainder behaves as awards. That is the
correct shape: a character who begins at level 5 has, in rules terms, already advanced.

**Why it matters beyond tidiness.** `_buildEventBurst` blanket-tags every event `noLock:true` purely so a
high-budget starting character isn't instantly locked (D-GH34). With the split, that reason disappears —
creation AP is always the default, so the threshold is never wrong — and with it goes the reload-unlock
bug: see `fix/creation-lock-survives-reload` above, where a reload currently launders a locked character
back to draft.

**Two UI pieces:**
1. **CharGen has no awarded-AP entry at all.** The Live Sheet does (`award()`, which appends a `type:'award'`
   event). CharGen needs the equivalent so a DM or player can set the extra AP on a starting character.
2. **CharGen's budget control is a dropdown and is clunky** (owner). Replace it with a plainer entry — a
   number field, or a track picker plus a number, so a custom figure doesn't mean hunting a list.

**Effort:** medium · **Risk:** medium — ambiguity medium (the split is decided, but where the boundary is
recorded in the LOG is an open design call); damage scale medium (touches the award/budget model both
tools read); damage likelihood low (parity + tool-pricing gates cover the numbers). Not sweep-eligible.

```text
1. Decide how the split is RECORDED before writing UI. The LOG already carries `award` events and
   `creationLockConfig{threshold}`. Natural shape: creation AP is the threshold (already an event, already
   append-only per D4), and awarded AP is one or more ordinary `award` events. Check that against how
   economy() computes earned/spent, and write the answer into
   decisions/2026/D-GH-2026-08-05-pricing-model.md as an amendment - it changes D3.
2. CharGen: add an awarded-AP entry mirroring the Live Sheet's award(). Route it through the LOG-mutation
   API (emit), not a DOM shim - readBuild() is foldBuild(LOG) since the Chunk 6 flip.
3. CharGen: replace the budget dropdown with a number entry (keep the track presets reachable - they feed
   DATA.levelBudgetCurves and the creation-AP confirm prompt already reads them).
4. Once creation AP is always the default, REMOVE the blanket noLock tagging in _buildEventBurst and
   confirm the D-GH34 case it protected is still safe: an imported higher-budget character must not
   self-trigger the lock on its own total. That is the whole point of doing this task first.
5. Gate it in testing/scripts/tool-pricing-ci.mjs: a character with creation AP 79 + 170 awarded must show
   creation pricing for the first 79 and post-lock pricing after, AND still be locked after a reload.
6. engine-parity must stay at 0 failed. If compute() output moves, update testing/expected/ and bump DATA.version
   in the same PR.
```

**Done when:** starting AP is split into creation AP and awarded AP, CharGen can set both, its budget
control is no longer a dropdown, a 5th-level starting character gets creation pricing only for the
creation-AP portion, the lock survives a reload, and engine-parity still reports 0 failed.

## Campaign binding is lost on refresh, and on the Live Sheet → CharGen switch — TODO
Branch `fix/campaign-binding-survives-reload`. Reported by the owner from real use, 2026-08-05: "when the
page is refreshed, it loses the connection to campaign and I need to reload the character. Same as when I
move from livesheet to chargen."

**NOT VERIFIED IN A BROWSER.** Both paths need a signed-in session and a real campaign, which a CLI
session has no credentials for. What follows is a code-level diagnosis — treat the first finding as solid
(it is a plain omission) and the second as a hypothesis to confirm before coding.

### Finding 1 — the local autosave drops `campaignId` (this is almost certainly the refresh bug)

`buildCharacterEnvelope()` takes a `campaignId` and includes it only when passed
(`js/character-store.js:83-86`). Three Live Sheet call sites, and they disagree:

| call site | passes `campaignId`? |
|---|---|
| `exportJSON()` — file save | yes |
| cloud save (`~:2009`) | yes |
| **`save()` — the localStorage autosave (`~:624`)** | **NO** |

The autosave is exactly what a page refresh restores from. `load()` then calls
`_lsResetCloudApState()`, which sets `window._lsCampaignId = null` — so after a refresh the binding is
gone and can only come back via the async cloud round-trip in `refreshCloudCampaignRules()`.

That round-trip is itself fragile: it resolves the campaign by re-fetching the character record with
`S.loadCharacter(window.currentCharId())`, and **`currentCharId()` MINTS A NEW RANDOM ID when `__charId`
is unset** (`~:428`). If the restore has not populated `__charId` before that runs, the lookup asks the
server for a character that has never existed, gets nothing, and concludes "no campaign" — and the tab is
now holding a different id than the character it is showing.

### Finding 2 — the switch to CharGen may be a boot-order race, not a missing value

The handoff baton DOES carry the binding (`writeHandoff` stores `campaignId`,
`js/character-store.js:147`; the Live Sheet passes it at `~:702`; CharGen calls
`_cgAdoptEnvelopeBinding(p)` right after applying the envelope). So the value is not being dropped —
which makes a race the likelier explanation. `_cgConsumeHandoff()` runs "at the very top of boot, ahead
of loadFromHash()/autosave", i.e. gated on `engine-ready`, while `_cgResolveDmApStatus()` needs
`window._campaignBridge`, which is published on the later `campaign-ready`. If the resolve fires before
that bridge exists it bails and the status stays `unavailable`.

**Both of these have been fixed once before, in a narrower form** — see the comment above
`refreshCloudCampaignRules()` (a reload used to leave the AP chip on "player only") and the comment in
`_cgConsumeHandoff` (switching tools used to silently zero a campaign player's AP). So this is a third
instance of the same class, which argues for fixing it where the value lives rather than per-path again.

**Effort:** medium · **Risk:** medium — ambiguity medium (finding 1's fix is obvious; finding 2 needs
confirming first); damage scale medium (touches the AP model both tools read, and a mis-minted
`__charId` could write a character under the wrong id); damage likelihood medium (no automated cover —
the cloud paths cannot run in the dependency-free gate). Not sweep-eligible.

```text
1. CONFIRM FIRST, with the owner or a signed-in browser: on refresh, does the AP chip read "player only"
   while the character data is intact? And does the tab's character id CHANGE across the refresh
   (compare currentCharId() before and after)? That second question separates a display bug from a
   genuine identity bug, and they need different fixes.
2. Fix finding 1 regardless - pass campaignId in save()'s buildCharacterEnvelope call, as the other two
   call sites already do. One argument, and it makes the binding survive without any cloud round-trip.
3. Guard currentCharId(): minting a fresh id inside a getter is the hazard. A read-only accessor for the
   "do we have an id yet" question would stop a lookup ever inventing one. Check the other callers before
   changing it - the minting behaviour is load-bearing for genuinely new characters.
4. For finding 2, if confirmed: order the handoff's campaign resolve after campaign-ready rather than
   engine-ready, or re-run it when that event arrives.
5. Add whatever cover is possible without credentials: the envelope-shape half (does save()'s envelope
   carry campaignId?) is assertable in testing/scripts/tool-pricing-ci.mjs with no sign-in at all.
6. engine-parity must stay at 0 failed.
```

**Done when:** refreshing a campaign-bound character keeps its campaign and AP without reloading, the
same holds after switching Live Sheet → CharGen, the character id is stable across a refresh, and a gate
asserts the autosave envelope carries the binding.

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# 🔴 NOW — high-severity fixes + cleanup

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.
