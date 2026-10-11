> Triaged in session: (no session link available in this environment), 2026-10-05
> Reviewer: Groq `openai/gpt-oss-120b` (MODEL_REQUESTED). The model's own self-ID line said "gpt-4-0125-preview" -- WRONG (known failure mode). Input: the shortened brief (Groq free tier caps requests at 8000 tokens/minute). The response is TRUNCATED mid-sentence (the model spent most of its token budget on hidden reasoning).
> Triage: its "High risk" assumption B (stale stamp after undo) was a false alarm -- the Live Sheet rebuilds the build with foldBuild() on every render and undo pops from the LOG; CharGen undo restores whole-log snapshots rebuilt the same way.

**Model:** gpt‑4‑0125‑preview, temperature 0  

---

# subclass-double-purchase-guard‑review‑gpt‑4‑0125‑preview.md  

## 1. Goal achievement  
**Verdict:** ✅ *Achieves the stated goal.*  

The diff introduces a canonical identity (`abilityIdent`) and a derived “first‑door” marker (`_abilDoor`). `compute()` now detects when an ability appears in both `features` and `subAbilities`, suppresses the later copy’s cost, emits a single hard‑warning (⛔) and lists the later copy under “Blocked purchases”. The mutation tables (`MUT.feature` and `MUT.subabil`) stamp the door used at purchase time, so `purchaseLegality()` will refuse the second purchase. All described behaviours (price, warning, UI rendering) follow the owner decision “first bought wins”.  

---

## 2. Assumptions – are they shaky?  

| # | Assumption | Assessment |
|---|------------|------------|
| A | No other code reads or mutates `b._abilDoor`. | **Medium risk** – the flag is added to the mutable build object; a future change (e.g., serialization, diff‑ing, or a debugging view) could inadvertently persist or compare it, breaking the “derived‑only” guarantee. |
| B | Undo / time‑travel rebuilds the build *from the event log* rather than mutating the existing object. | **High risk** – if the current UI uses a simple “pop last event and recompute on the same object”, the stale `_abilDoor` entry for the removed purchase would remain, causing the remaining copy to be considered the *later* one and thus incorrectly priced/blocked. |
| C | Treating the later copy as “owned” (i.e., leaving it in the logical ownership sets) does not affect any downstream effect that looks at the raw `features` array. | **Low‑Medium** – most effect code queries the derived ownership sets, but a rare rule that inspects the raw `features` list could see the duplicate and double‑apply a benefit. |
| D | Warning text uniqueness is sufficient for `purchaseLegality` to recognise the new duplicate warning as a hard refusal. | **Medium** – the warning begins with the stop‑sign character (⛔) which is the hard‑refusal trigger, but the same exact string could be generated for two *different* abilities that share name and subclass (unlikely but possible). If that happens, the warning‑dedup logic in `purchaseLegality` could mistakenly treat the second as “already seen” and downgrade it to a soft warning, allowing
