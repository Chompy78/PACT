<!-- Reviewer actually called: Groq API (openai/gpt-oss-120b). It self-identified as "gpt-4 (OpenAI)", which is wrong (models routinely misidentify themselves). Raw output below, unedited. -->

**Model:** gpt‑4 (OpenAI), running via direct API call  

---

### (i) Does the plan achieve the goal?  
Yes. Design A records the full roll, cuts it at the creation‑ceiling, stores the leftover steps, and on “Accept” locks the character and re‑plays those steps as in‑play purchases. The described UI changes (Accept button, visibility logic) and the unattended `_cgPostLockAppend` satisfy the requirement that a player can lock a rolled character and have the remaining AP spent automatically.

### (ii) Which assumptions look shaky, and what would you check first?  

| Assumption | Why shaky | First check |
|------------|-----------|-------------|
| Unknown LOG event types are ignored by the engine and server freeze logic. | The server may reject any unrecognised event, breaking persistence of the pending remainder. | Verify the server’s whitelist of event types and test saving a dummy custom event. |
| In‑play prices never exceed the creation‑price budget, so the “remainder” will always fit (or be skipped). | In‑play costs can be higher (e.g., traits cost more); a large remainder could be entirely unaffordable, leading to an empty Accept. | Simulate a roll where a cheap creation purchase becomes expensive in‑play and ensure the skip‑and‑report path works. |
| `buildToSteps` can express *any* difference between two builds. | The author admits it may return an error; edge cases (e.g., complex multi‑slot features) could abort the Accept unexpectedly. | Write unit tests that compare `cut + steps` → final build for a diverse set of random rolls. |
| The names gate can be satisfied automatically without breaking R1–R4. | Auto‑naming could introduce a new drawback (granting AP) or violate the “no new drawback after lock”. | Inspect the naming UI flow; ensure auto‑naming only fills empty strings, never adds new categories. |
| Autosave will not push a half‑finished state that the server rejects. | Autosave is debounced but may fire after the lock but before all steps are appended. | Instrument the autosave trigger sequence during an Accept to confirm ordering. |

### (iii) Is there a better alternative to Design A and B, and which would you pick?  

A hybrid approach: keep Design A’s deterministic cut **and** generate the remainder steps *after* the lock using the in‑play price function (i.e., a lightweight second pass that only converts the already‑chosen differences, not a full re‑roll). This guarantees the remainder respects in‑play costs while preserving the player’s visible choices. It avoids the heavy refactor of splitting the 540‑line roller (Design B) and sidesteps the risk that `buildToSteps` cannot represent some differences (by using the same logic the engine already employs for in‑play purchases). **Pick this hybrid** because it balances implementation effort, testability, and correctness.

### (iv) What is missing from the risks or the verification?  

* **Concurrency / race conditions**: Accept could be clicked twice, or a background autosave could interleave with step appends.  
* **Rollback on partial failure**: If a step fails (e.g., wallet shortfall) after some have been appended, the character could end up in an inconsistent state.  
* **User‑experience edge cases**: Dialogs from other parts of the UI (e.g., trade‑offer confirmation) might still appear despite “unattended” mode.  
* **Security / tampering**: Storing the pending remainder in a custom LOG event could be manipulated client‑side; server‑side validation is not mentioned.  

Verification additions:  
* Test double‑click of Accept and ensure idempotence.  
* Simulate a wallet‑shortfall after a few steps have been appended and verify that the state either rolls back or remains consistent.  
* Verify that no unexpected modal/dialog appears by mocking the UI layer during Accept.

### (v) Is the Verification section objectively checkable — name any item that is not.  

Most items are testable, but **(d) “no dialog opens during Accept”** requires instrumentation of the UI framework to detect hidden or asynchronous dialogs, which may be flaky without a deterministic UI test harness. Also, **(e) “reload with a pending remainder still shows the button”** depends on the chosen persistence mechanism; if (a) a custom LOG event is used, the server must accept it—this part cannot be verified purely from the client code.

### (vi) Should this be split into several plans, and if so where?  

Yes.  
1. **Plan A – Capture & Store Remainder** – design and implement `buildToSteps`, decide persistence (LOG event vs. local storage), add tests for deterministic cut.  
2. **Plan B – Accept Flow** – UI button, unattended `_cgPostLockAppend`, handling of names gate, skipping unaffordable steps, and autosave interaction.  
3. **Plan C – Server Integration & Validation** – ensure the server tolerates the custom event, add server‑side checks, and define API contracts for the pending remainder.  

Separating concerns isolates the most risky parts (state persistence and server compatibility) and allows parallel work.

### (vii) Recommendations for Q1–Q5  

| Q | Recommendation | Reason |
|---|----------------|--------|
| **Q1** | Choose the hybrid of Design A with a post‑lock step conversion. | Keeps deterministic cut while respecting in‑play pricing without full refactor. |
| **Q2** | Open the Name dialog first; do not auto‑name. | Guarantees player intent and avoids hidden rule violations. |
| **Q3** | Store the pending remainder as a new LOG event *only* after confirming the server ignores unknown types; otherwise fallback to per‑character `localStorage`. | LOG persistence survives reloads and syncs across devices; localStorage is a safe fallback. |
| **Q4** | Skip unaffordable steps, report them, and allow the player to confirm any trade offers up front. | Prevents Accept from aborting mid‑process while still informing the player. |
| **Q5** | Keep cloud autosave running; debounce it to fire after all steps are appended. | Guarantees the latest state is persisted without requiring a separate pause. |

---  

*End of review.*