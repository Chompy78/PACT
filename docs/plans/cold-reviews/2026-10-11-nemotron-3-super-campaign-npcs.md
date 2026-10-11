Model: unknown (API call; no model identifier provided)

# Review of Plan — campaign NPCs (`feat/campaign-npcs`)

## Does this achieve the goal?
Yes. The plan enables a DM to bind any of their own characters to a campaign as NPCs, award AP via the existing `award_ap` RPC, and keep NPCs out of all player‑facing party‑wide mechanics (AP award select‑all, skill matrix, downtime, basic‑mode count, etc.). The proposed schema change (`is_npc` flag) and the new `dm_bind_npc` RPC satisfy the functional requirements while preserving existing guarantees for player characters.

## Shaky assumptions
1. **DM never needs an NPC to also be a player character** – This is reasonable for the current use case, but the design makes it impossible to later repurpose an NPC as a PC without first unbinding it (which clears `is_npc`). If future features ever require dual‑role characters, a migration would be needed.
2. **Players never see NPC sheets** – The plan relies on the existing read policy (owner or DM of campaign) and the explicit exclusion of NPCs from UI lists. If any future feature reads the `characters` table directly (bypassing the filtered roster arrays), NPCs could inadvertently appear to players.
3. **Party‑wide downtime applying to NPCs is harmless** – The plan assumes no player‑visible effect. While NPCs do not appear in UI, any downstream logic that treats downtime as a game‑state change (e.g., resource consumption, story flags) would still affect NPCs. The design notes this as harmless, but it is an assumption that should be validated against any existing downtime side‑effects.
4. **NPCs need no player‑facing visibility** – The plan explicitly hides NPCs from player views, but it does not address scenarios where a player might gain DM privileges (e.g., co‑DM) and thereby see NPC rows via the DM console. This is acceptable if co‑DMs are trusted, but worth noting.

## Places where an NPC could still be treated as a player’s character
- **Direct SQL queries** that select from `characters` without the `and not is_npc` filter (e.g., ad‑hoc reports, future RPCs, or raw Supabase calls) could return NPC rows. The plan mitigates this by auditing all current usages (`grep inventory`), but any new code must remember to add the filter.
- **`is_campaign_member`** is used in several policies and checks; the plan adds `and not is_npc` to it. If any future policy reuses the base function without the NPC exemption, NPCs could gain unintended read/write rights. The plan includes unit tests, but the risk remains for future additions.
- **Basic‑mode trigger (`pact_enforce_basic_mode`)** counts active characters per owner. The plan modifies its count to exclude NPCs. If the trigger is bypassed (e.g., via direct `UPDATE` that avoids the trigger), an NPC could incorrectly count toward the limit. The trigger is defined as `BEFORE UPDATE`; direct `INSERT`/`UPDATE` that skip triggers is not possible in Postgres unless using `ON CONFLICT DO NOTHING` or similar, which still fires triggers. Still, a risk exists if the trigger is altered or disabled.
- **`dm_unbind_character`** reuses the existing unbind RPC; the trigger clears `is_npc` when `campaign_id` goes null. If any other path sets `campaign_id` to NULL without invoking the trigger (e.g., via `ON DELETE SET NULL` on a campaign deletion), the trigger fires because it’s a `BEFORE UPDATE` on the row; the FK `ON DELETE SET NULL` results in an UPDATE, so the trigger fires. This appears safe.

## Ways a non‑DM could create an NPC
- The `dm_bind_npc` RPC checks `is_campaign_dm(p_campaign)` and is `SECURITY DEFINER` but only granted to `authenticated`. A non‑DM who owns a character could call the RPC, but the DM check would fail. No column grant exists for `is_npc`, so a player cannot set the flag directly via `INSERT`/`UPDATE`. The only plausible escape would be if a future RPC mistakenly omitted the DM check or if the `is_campaign_dm` function were compromised. The plan includes a test for non‑DM refusal.

## Verification objectively checkable?
Yes. The verification section lists concrete, automatable SQL tests:
- DM can bind multiple NPCs to a campaign.
- Player still refused a second join (unique index).
- Non‑DM/player calling `dm_bind_npc` is refused.
- Player cannot set `is_npc` via insert/update.
- Another player cannot read an NPC row (RLS).
- No starting‑AP ledger row on NPC bind.
- Unbind clears the flag.
- `is_campaign_member` false for a DM owning only NPCs.
- Basic‑mode count ignores NPCs.
- Existing baseline test (`rls-baseline-test.sql`) passes.
- Engine parity shows zero failures.
- UI checks (NPC section renders, Select‑all excludes NPCs).
These are all observable and can be run in CI; they provide objective evidence.

## Should this split into several plans?
The change is tightly scoped: a single schema addition, one new RPC, a few targeted exclusions, and UI adjustments. Splitting it would add overhead without clear benefit, as each piece depends on the others (e.g., the NPC flag is useless without the RPC and the index adjustment). The plan is coherent and manageable as a single unit. However, if the team prefers to isolate risk, they could split into:
1. **Schema migration** (add `is_npc`, adjust index, trigger).
2. **Backend RPC** (`dm_bind_npc`) and associated tests.
3. **UI & integration** (DM Console changes, roster splitting, label updates).
Given the current size and interdependence, a single plan is acceptable, but a phased rollout (schema first, then RPC, then UI) could ease verification.

## Final verdict
The plan is logical, addresses the stated goal, and mitigates the primary risks through schema guards, RPC‑only mutation, and targeted exclusions. The assumptions are largely sound for the current feature set, though future extensions should revisit the NPC‑vs‑PC distinction and the handling of downtime effects on NPCs. The verification plan is concrete and objectively checkable. No major gaps are evident; the plan can proceed as‑is, with the recommendation to maintain the audit grep for any future additions that touch the `characters` table or the listed helper functions. 

--- 

*End of review.*