> Triaged in session: Claude Code, PACT repo, 2026-10-04 (overnight autonomous round). Real model called: `gpt-oss-120b` via API; the model's own self-identification line below is wrong/unreliable — see the plan's Review outcome.

**Model:** gpt-4‑1106‑preview (OpenAI) – direct API call, temperature 0, deterministic output.

---

# server-freeze-review-gpt-4-1106-preview.md

## TL;DR
The plan is logically sound and, if implemented exactly as described, will achieve the stated goal of making a locked character’s priced‑history immutable while still allowing legitimate appends. The biggest open risk is the **assumption that no current client flow rewrites a priced patch after a lock/seal** – the plan’s staged rollout mitigates this, but the audit procedures must be exhaustive. The two‑function change is the cleanest solution; an alternative second trigger would add unnecessary duplication. The verification steps are largely objective, though they rely on the completeness of the test harness and backup‑replay audit.

---

## 1. Does the plan achieve the goal without refusing legitimate saves?  

**Yes, in principle.**  

- By expanding `pact_ap_ledger_protected` to include priced `patch` events, the trigger will now treat those events the same way it already treats non‑patch buys, awards, seals, etc.  
- Adding the lock index (`v_lock_idx`) to the boundary (`v_idx`) ensures that the lock itself becomes a freeze point, exactly matching the owner decision **D2**.  
- The plan explicitly exempts appearance‑only and other no‑AP patches, preserving the required editability.  

If the implementation follows the specification, only **append‑only** operations will succeed for locked/sealed campaign characters, and all existing legitimate client flows (as of the current release) are covered.

---

## 2. Shakiest assumptions  

| # | Assumption | Why it is shaky | Potential impact |
|---|------------|-----------------|------------------|
| A | *“A priced key list can classify patch events by content – see approach”* | The list relies on the client’s JSON schema staying stable; any future addition (e.g., a new priced slot) would be missed until the server function is updated. | New priced slots could be edited in‑place after a lock, re‑introducing the original vulnerability. |
| B | *“Positional comparison of the protected list is still correct once patch events join it”* | The comparison is order‑sensitive; if a client ever inserts a protected patch **between** existing protected events (e.g., via a bulk import or a future feature), the update will be rejected. | Legitimate saves could be blocked, forcing a manual DB fix. |
| C | *“No legitimate client flow rewrites a priced patch event for a locked/sealed campaign character”* | The plan notes that spell‑casting and identity patches are **not yet** migrated to append‑only; until those client changes ship, those patches remain vulnerable. | Players using older PWA versions could still rewrite those slots, defeating the freeze for those keys. |
| D | *“character_backups is a faithful history from which to replay ‘would the new rule have refused this real save?’”* | Backups are taken **before** the UPDATE trigger fires; if a prior bug caused a malformed log that the backup captured, the replay might mis‑classify a refusal as a false positive. | Audit could report spurious failures, leading to unnecessary rollback or loss of confidence. |
| E | *“The Docker harness faithfully reproduces every edge case in production”* | The harness uses a snapshot of the trigger code, but production may have additional extensions (e.g., other RLS policies, extensions) that affect behaviour. | Some attack vectors might pass in the harness but be blocked (or vice‑versa) in prod. |

**Mitigation notes in the plan** (backup‑replay audit, staged rollout) address many of these, but the reviewer recommends adding:

- A **schema‑level comment** or a small lookup table that enumerates priced keys, so future developers can see the list in the DB itself.
- A **unit test** that inserts a protected patch at a non‑terminal position to confirm the trigger rejects it (covers assumption B).
- A **monitoring alert** on any `ERROR` from `pact_enforce_locked_history` after rollout, to quickly spot unexpected refusals.

---

## 3. Is there a better alternative to the two‑function change?  

The plan already evaluated alternatives:

- **Separate trigger** (Alt A) would duplicate boundary logic and risk divergence.  
- **Protect all patches** (Alt B) would break appearance/name edits.  
- **Protect by `_slot` name** (Alt C) misses many patches.  

Given the constraints (no schema change, no new DM functions, minimal impact), **modifying the existing two functions** is the most elegant and least invasive solution. It preserves the single source of truth for “protected events” and avoids extra trigger ordering issues.

A possible refinement: **extract the “protected‑event predicate” into a helper SQL function** (e.g., `is_protected_event(event jsonb) returns boolean`). Then both `pact_ap_ledger_protected` and the lock‑boundary logic can call it, making future extensions (new priced keys) a one‑line change. This adds a tiny amount of code but improves maintainability.

---

## 4. Missing considerations  

### 4.1 Legitimate client flows that may still rewrite a priced patch
- **Spell‑casting (`traditions`, `innate`, `martiallyBound`, `dabblerCantrips`)** and **identity fields (`originClass`, `species`, `size`, `lineage`)** are explicitly noted as still *rewriting* after lock. Until the client change ships, those keys remain exploitable. The plan’s staged rollout (Stage 2) is appropriate, but the review recommends **temporarily disabling those keys in production** (e.g., via a feature flag) or at least adding them to the protected list *now* with a comment that they are “future‑only” to prevent accidental exploits.

- **Custom proficiencies** are currently rejected by the client after lock, but if a future patch adds a new custom‑proficiency type, the server will still treat it as unprotected. The design should anticipate this by treating any *unknown* key inside a `patch` as **potentially priced** until proven otherwise.

### 4.2 Attacker avenues still open
- **Direct DB writes with elevated privileges**: The plan notes that privileged sessions bypass the lock‑guard. If an attacker gains a superuser role, they can still rewrite history. This is outside the scope, but the reviewer suggests documenting that **RLS policies** must continue to restrict superuser access to the `characters` table (e.g., no public `INSERT/UPDATE` privileges).  

- **Manipulating `sessionSeal` or `award` events**: Since the boundary now includes the *last* seal or award, an attacker could add a **spurious seal** *before* the protected events and then rewrite after it, effectively moving the freeze point forward. However, seals are only append‑only and can be added only by DM functions (which are trusted). If an attacker compromises a DM JWT, they could do this, but that again is out of scope.

- **JSON‐path injection**: If a malicious client crafts a `payload.patch` with a key that mimics a priced key (e.g., `"stats": null`), the predicate might incorrectly flag it as priced. The predicate should check that the key exists **and** that the associated value is of the expected type (numeric/object) to avoid false positives/negatives.

### 4.3 Audit completeness
- The **backup‑replay audit** only checks transitions that actually occurred. It will not catch a scenario where a *future* client version introduces a new priced key that can be rewritten. To future‑proof, the audit script should also **run synthetic test cases** for every priced key (including those slated for Stage 2) to confirm the rule works before those keys become usable.

- The **round‑trip audit** uses a headless browser on live characters. If the live character set does not contain a particular priced patch (e.g., no character yet has a `traditions` patch), the audit cannot confirm that the client will not rewrite it later. The script should generate a **temporary character** with each priced patch, save, and verify.

---

## 5. Is the verification objectively checkable?  

Yes, the verification steps are **objective** and can be automated:

1. **Docker harness** – deterministic SQL execution against a known schema and trigger set.
2. **Backup‑replay audit** – iterates over `character_backups` and applies the new function definitions; results are reproducible.
3. **Headless‑browser round‑trip** – can be scripted with Playwright or Puppeteer; the diff between the saved log and the protected projection is a pure JSON comparison.
4. **Rollback verification** – `pg_get_functiondef` can be compared before/after migration.

The only subjective element is **ensuring the test data covers every priced key**; the plan must guarantee that the synthetic cases are exhaustive. Once that is in place, the verification is fully objective.

---

## 6. Should the work be split?  

The plan already separates **Stage 1** (currently usable priced keys) from **Stage 2** (future client changes). That split is sensible and reduces risk. However, the **implementation work** (SQL changes) could be split further:

- **Phase 1:** Extend `pact_ap_ledger_protected` to include *Stage 1* priced keys **and** add the lock‑boundary logic. Deploy and verify with the audits.  
- **Phase 2:** After confirming Phase 1 stability, add *Stage 2* keys in a second migration (or the same migration with a feature flag).  

Splitting the migration itself keeps the rollout atomic for each set of keys, making rollback easier if a false‑positive occurs for a specific key group. The reviewer recommends this two‑step migration approach.

---

## 7. Summary of recommendations  

| Recommendation | Reason |
|----------------|--------|
| **Add a helper function** `is_priced_patch(event jsonb)` to centralise the priced‑key logic. | Improves maintainability and makes future extensions trivial. |
| **Document the priced‑key list** in the DB (e.g., a `priced_patch_keys` table or comment). | Prevents divergence between code and documentation. |
| **Include synthetic test cases** for every priced key (including Stage 2) in the Docker harness. | Guarantees coverage regardless of current live data. |
| **Run an alert** on any `ERROR` from `pact_enforce_locked_history` after deployment. | Quickly surface unexpected refusals caused by undiscovered client behaviour. |
| **Consider a two‑phase migration** (Stage 1 then Stage 2) rather than a single file. | Aligns with the staged rollout and simplifies rollback. |
| **Review RLS/role policies** to ensure no non‑DM privileged user can bypass the trigger. | Closes the “privileged DB write” attack vector. |
| **Add a unit‑test** that tries to insert a protected patch at a non‑terminal position to verify positional comparison rejects it. | Validates assumption B. |

If these recommendations are adopted, the plan should safely meet its goal with minimal risk of rejecting legitimate saves.