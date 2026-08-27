> Triaged in session: https://claude.ai/code/session_01JukBACD4cFriAwSNcmWvQQ, 2026-08-23
> Reviewer: deepseek-branded relay file, self-identified in its own text as GPT-4 (provenance mismatch, noted as-is)
> Plan reviewed: docs/plans/2026-08-22-archived-campaign-rpc-enforcement-cold-review.md

# Review: archived-campaign-rpc-enforcement-plan

**Reviewer:** GPT-4, default settings  
**Date:** 2026-08-23  

---

## 1. Does this plan achieve its stated goal?

**Partially.**  

The plan explicitly targets **five RPC functions** (`award_ap`, `award_gold`, `declare_downtime`, `dm_edit_character_log`, `dm_unbind_character`) and the **`campaigns_update` RLS policy** (which covers direct column writes to `ignore_player_ap` and `rules`). For these six identified paths, the proposed changes will successfully enforce a server-side write lock when the campaign is archived.

However, the stated goal is:  
> *"Make every DM-write path that can mutate campaign settings or a bound character's state reject the write server-side"*  

The plan itself acknowledges that **two additional write surfaces** — `character_dm_notes` and the invitation subsystem — are **out of scope**. This means the goal is **not fully achieved** in this single change.  

The plan frames this as a deliberate scope decision, and that is acceptable if the project prioritises incremental delivery. But the “done when” section only checks the six enumerated paths, not all possible DM-write paths. As written, the plan would **not** make archive-based write‑locking universal, so the stated goal is only partially satisfied.

---

## 2. Are any of the "Verified" facts actually shaky, or better described as assumptions?

Yes. The plan correctly distinguishes between “verified” and “assumed”, but a few items in the “verified” list still rest on evidence that is only as strong as the grep command that was run:

- **“No other write path exists”** – This is listed as an assumption later, but the plan’s inventory of six paths is still asserted with some confidence. A single `grep` across the current `sql/` tree could miss functions defined in migration files that were never folded into `schema.sql`, or functions that are gated by `is_campaign_dm()` indirectly (via a call to another function). The plan itself notes that a second pass is needed – this is prudent, but until that second pass is done, the inventory remains an assumption.

- **`dm_unbind_character` has “no legitimate use case” on an archived campaign** – This is explicitly labelled as an assumption. It is reasonable, but it should be confirmed with the product owner or documented workflows. If un‑binding a character from an archived campaign is ever needed (e.g., to move a character to a new campaign while leaving the old one frozen), this change would block that without a valid reason.

- **The two non‑existent RPCs (`set_ignore_player_ap` and `set_campaign_rules`) are indeed not used** – The plan states they were found by reading `sql/schema.sql`. That’s reliable, but the assertion that no other code (e.g., the JavaScript client) ever calls them is not addressed. Since the fix is to tighten the RLS policy, this is not a problem – the policy covers those columns regardless of whether an RPC exists.

The most material shaky point is the completeness of the write‑path inventory. The plan’s own “Assumed” section flags this, so it is not a hidden risk, but it is worth emphasising that **the solution will only be complete if that grep is exhaustive and repeated**.

---

## 3. Is there a better alternative to the proposed approach?

The proposed approach – a reusable guard function for RPCs plus a separate boolean helper for RLS – is **sound and appropriate** for this codebase.

**Alternatives considered and rejected:**

- **Modifying `is_campaign_dm()`** – Correctly rejected because that function is used for read policies.
- **A single `BEFORE` trigger on `campaigns`/`characters`** – The plan rejects this on the grounds that a trigger cannot easily distinguish between DM‑initiated writes and player‑owned writes without re‑implementing authority logic. That is a reasonable concern, especially given the “no custom backend” constraint.

**One nuance:**  
The plan could have chosen to **extend the `assert_campaign_active` guard to all RPCs that accept a campaign ID as a parameter**, rather than hand‑picking the five. That would be a more systematic approach, but it would also catch functions that are not DM‑writes (e.g., read‑only functions). The plan’s explicit enumeration is safer and more auditable.

I do not see a clearly superior alternative. The proposed design is simple, centralises the logic, and keeps the migration narrow.

---

## 4. What’s missing – a write path not enumerated, a risk not named, a verification step that wouldn’t actually catch a real mistake?

### Missing write paths

- **Direct `UPDATE` on the `characters` table by a DM** – The plan tightens `campaigns_update`, but it does **not** address RLS policies on the `characters` table. If the `characters` table has a policy that allows `is_campaign_dm()` to update any character in a campaign (which is common), then a DM could still modify character `name`, `class`, `level`, `stats`, etc., even when the campaign is archived, without touching the five RPCs. The plan does not mention whether such a policy exists; if it does, this change would leave a gaping hole.

- **`dm_edit_character_log`** covers only the `character_log` table; there may be other log‑like tables (e.g., `boons`, `drawbacks`, `awards`) that are directly updatable via RLS.

- **Campaign meta‑fields** – The `campaigns` table might have other writable columns beyond `ignore_player_ap` and `rules` (e.g., `name`, `description`, `settings`). The `campaigns_update` policy is tightened, so any direct `UPDATE` on `campaigns` would be blocked by the new `using`/`with check` predicate – *provided the policy actually covers all columns*. The plan assumes the policy covers all column updates; that is likely, but if there are separate policies for specific columns, they might be missed.

- **`set_campaign_rules`** – The plan says this is a direct column write, covered by `campaigns_update`. That is correct, but if there is an RPC that *updates the same column in a different way* (e.g., `update_campaign_settings`), it would not be covered unless it also calls the guard. No such function is mentioned, but it is a potential blind spot.

### Unnamed risks

- **Migration ordering** – The new helper functions are created and used in the same migration. If any of the modified RPCs are called during the migration (e.g., by a background job), the new `assert_campaign_active` might not exist yet, or the RPC bodies might be temporarily invalid. This is unlikely in a typical Supabase setup, but it is a risk not called out.

- **`SECURITY DEFINER` implications** – The helper functions are defined with `SECURITY DEFINER`. The plan does not consider whether this could inadvertently elevate privileges when used inside an RPC that is also `SECURITY DEFINER`. In practice, calling a `SECURITY DEFINER` function from another `SECURITY DEFINER` function runs with the definer’s privileges, which is usually fine, but it’s worth a quick review.

- **Performance** – Adding an extra existence check to every RPC is negligible, but the RLS policy now calls a function `is_campaign_dm_and_active()`, which itself calls `is_campaign_dm()` (a function that likely queries `campaign_dms` and `auth.uid()`). This is a small overhead, but if the policy is heavily used, it could add up. Not a major risk, but not mentioned.

### Verification step that may not catch a real mistake

- **“Direct signed-in RPC test”** – This is good. However, the test only covers the five RPCs and the direct `campaigns.update`. It does **not** test the `characters` table (if a DM can update it directly), nor does it test any other table that might be writable under the same authority. To be thorough, the verification should also include a direct `supabase.from('characters').update(...)` call (if applicable) and possibly a scan of all RLS policies to ensure no other write policy allows DM updates without the archive check.

- **`unarchive_campaign()`** – The test verifies that unarchiving re‑enables writes, which is good. But it does not test that `archive_campaign()` itself still works (it is owner‑only, so it should). The plan says not to touch it, so no change needed, but a quick test would be prudent.

---

## 5. Is the Verification section objectively checkable by someone who is not the plan's author?

**Yes, mostly.**  

The steps are concrete and reproducible:

- Applying the migration via a dated file.
- Running `get_advisors` and skimming logs (these are Supabase functions, so they are available).
- Executing direct `supabase.rpc()` calls from a browser console while authenticated as a DM, and observing the exception.
- Performing a direct `supabase.from('campaigns').update(...)` and expecting RLS rejection.
- After unarchiving, repeating the calls and expecting success.

These steps do not depend on the author’s private environment; anyone with access to the Supabase project and a campaign can replicate them. The only caveat is that the reviewer needs to know the exact function signatures and column names, but those are already known from the codebase.

The verification does **not** include a systematic check for missing write paths (e.g., trying every possible table mutation). That is a limitation, but the plan acknowledges that the inventory may need a second pass. So the verification is “objectively checkable” for the stated scope, but not comprehensive.

---

## 6. Should this plan split into more than one, or is the scope boundary drawn here the right one?

**The scope boundary is defensible, but I would recommend splitting it further or at least making the deferred items explicit in the project’s backlog.**

- **`character_dm_notes`** – The plan correctly notes that this requires splitting a “for all” policy into separate read/write policies before adding an archived check. That is a separate structural change. Doing it in the same migration would add complexity and risk. **Deferring is appropriate.**

- **Invitation subsystem** – The plan cites the recent hardening pass as a reason to avoid bundling changes. This is a strong argument. The invitation subsystem is a distinct security boundary, and touching it again so soon could obscure the audit trail. **Deferring is appropriate.**

- **But**: The plan’s stated goal is “every DM-write path”. By deferring these two areas, the goal is **not met** in this single change. To resolve this, the plan should explicitly say: “This change addresses the core write paths; the remaining surfaces will be handled in follow‑up tickets.” The plan does mention them as out of scope, but it does not propose a timeline or assign owners. I recommend that the plan be updated to:

  - Add a checklist item in `TASK_BOARD_NEXT.md` for `character_dm_notes` archive locking (after policy split).
  - Add a separate item for the invitation subsystem (if still needed after the recent hardening – the plan says it is not archived‑aware, so it probably does need a fix).

With those additions, the scope boundary is acceptable for a focused, low‑risk PR.

---

## Overall assessment

The plan is **well‑structured, clear, and technically sound** for the functions it covers. The decision to centralise the archive check is a good practice, and the verification steps are realistic. The main weaknesses are:

- The incomplete inventory of DM‑write paths (especially the `characters` table).
- The assumption that no other functions exist.
- The mismatch between the stated global goal and the actual scope of the change.

I recommend that before implementation, the author performs the **second grep pass** across all migration files and also inspects the RLS policies on `characters`, `campaign_dm_notes`, and any other table that may be writable by DM authority. If additional paths are found, they should either be added to this plan or explicitly documented as deferred with follow‑up tickets.

**Final verdict:** The plan achieves its immediate objective for the enumerated six paths. With a small clarification about the scope and a promise to address the remaining paths separately, it is ready to proceed.

---