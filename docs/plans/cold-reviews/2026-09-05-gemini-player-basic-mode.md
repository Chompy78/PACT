Reviewer: Gemini API, model endpoint `gemini-3.6-flash` (free tier). Note: the model's own self-identification
line below claims "Gemini 2.5 Pro" — this is factually wrong; the API call was made against
`gemini-3.6-flash` (confirmed by the request itself, not the model's self-report). Logged here rather
than silently corrected, since self-ID accuracy is the reviewer template's own first instruction and the
model got it wrong about itself.

---

```markdown
# Review: Account-level "basic mode" plan (`player-basic-mode-review-gemini-2-5-pro.md`)

**Reviewer Model:** Gemini 2.5 Pro (via Gemini API)  
**Evaluation Mode:** External Cold Review (strict adherence to document text alone)

---

## 1. Does this plan actually achieve its stated goal?

**Yes, conditionally.** 

The revised plan (incorporating the post-cold-review feedback) adequately addresses the primary enforcement gaps identified in earlier iterations (namely, the `archived_at` un-archive bypass and the concurrent insert race condition).

However, there is still a minor hole in enforcement logic in **Proposed approach (2a)**:
* **The `owner_id` change edge case:** The plan proposes a trigger firing `BEFORE INSERT OR UPDATE OF archived_at`. If the system or database allows updating a character's `owner_id` (e.g., transferring character ownership from Player A to Player B), a flagged player B could receive a transferred active character without `archived_at` changing. This would bypass the count check. To fully prevent direct DB bypass, the trigger must fire `BEFORE INSERT OR UPDATE OF archived_at, owner_id`.

---

## 2. Are any of its "Verified" claims suspicious?

* **"There is exactly ONE code path in the whole app where a genuinely new character row gets inserted..."**  
  *Suspicious / Over-confident:* The verification note mentions checking both "character-editing tools," but does not explicitly mention DM tools, campaign roster setup tools, or character import functions. If a DM can clone or assign an existing template/character to a player, or if an import tool exists, those might represent unverified insert/copy paths.
* **DM Authorization Baseline:**  
  *Missing Context:* The plan states that the player-accounts table has no role/flag columns and no admin role exists, claiming authority derives solely from "is this user the DM of this specific campaign." However, the "Verified" section does not document the schema/structure of the `campaigns` or `campaign_members` tables that store this DM relationship, despite relying heavily on DB functions checking this relationship in Step 3.

---

## 3. Is there a better alternative to the proposed approach that the plan didn't consider?

* **Use a dedicated `SECURITY DEFINER` RPC function for character creation/un-archiving instead of raw table `INSERT`/`UPDATE` grants + error-string matching.**  
  While the plan explicitly considers and defers this in "Alternatives considered" (citing consistency with existing precedent), relying on matching error message strings from DB exception triggers remains fragile. Using a database function (RPC) for character creation/restoration allows explicit, transactional execution of business logic, returning structured error codes (e.g., `{ success: false, reason: 'BASIC_MODE_LIMIT_EXCEEDED' }`) without relying on free-text exception matching.
* **Advisory Lock Keying Strategy:**  
  If Option (a) is selected, using `pg_advisory_xact_lock(hashtext(NEW.owner_id::text))` is clean and avoids locking physical rows in `player_accounts` or `characters` table directly during an insert. The plan mentions advisory locks as an option but doesn't commit to a specific implementation pattern.

---

## 4. What's missing?

* **Edge Cases & Failure Modes:**
  * **Updating `owner_id`:** As noted in Question 1, `owner_id` changes are not listed under trigger update targets.
  * **Advisory lock key collision / performance:** If `pg_advisory_xact_lock` is used, the hashing strategy for `owner_id` must avoid colliding with any other advisory lock namespaces in the application.
  * **Client UI State Synchronization:** If a DM toggles `basic_mode` ON for a player while that player is actively logged in and working in the character editor, what happens on their next auto-save attempt? The plan notes catching the error on save, but doesn't specify if the client UI should clear or update local cached state when this error occurs to prevent continuous failed background auto-saves.
* **"Done when" list checkability:**
  * *"A DM sharing a campaign with a player can flag that player's account"* — This lacks specific UI placement criteria (it says "small affordance wherever a DM already manages...", which is somewhat subjective). Adding explicit file targets or specific screen locations would make this objectively verifiable.

---

## 5. Should this be split into more than one plan?

**Yes.** Even though the authorization rules were successfully resolved via Decision Record `D-GH-2026-09-05-player-basic-mode.md`, the remaining execution work spans database safety and dual-app UI surfaces. It should be split into two implementation plans:

1. **Backend & Database Infrastructure Plan:**
   * Schema migration (`player_accounts` columns).
   * Broadened trigger with lock-guarding logic (covering `INSERT` and `UPDATE OF archived_at, owner_id`).
   * Database functions for DM set/unset and Player self-unset.
   * Automated tests for concurrency, trigger locking, un-archiving behavior, and RLS/advisor security policy checks.

2. **Frontend & UI Surface Plan:**
   * DM Campaign Roster toggle UI.
   * Player Settings "Basic Mode" display & self-unset UI.
   * Error handling wrapper updates at the shared save/sync call site in both character-editing tools.

---

## Summary Verdict

**Conditionally Accept with Minor Revisions:**
The plan logic is sound and well-thought-out following its prior iteration. It can move to implementation once the trigger specification is updated to include `owner_id` updates (`BEFORE INSERT OR UPDATE OF archived_at, owner_id`) and the execution scope is cleanly split between database enforcement and frontend UI tasks.
```
