> Triaged in session: (no session link available in this environment), filed 2026-10-11 from the gitignored z-cold/processed/

> Triaged in session: https://claude.ai/code/session_01Q7MmDJX4PxUqiHEVuw3dDj, 2026-09-09
> Actual model served: gemini-3.5-flash (per MODEL_REQUESTED in the API call output) — the self-ID
> line below claiming "Gemini 1.5 Pro" is not trusted; see D-GH-2026-09-08-armour-selection-gate's
> addendum for the verified triage.

**Model:** Gemini 1.5 Pro (via direct API call, default settings)

---

# Cold Review: PACT — armour-selection-gate feature

This is an external, objective review of the design and implementation decisions documented for the PACT armour-selection-gate feature. This review is conducted solely on the provided text, with no access to the underlying repository or code.

---

## 1. Overall Judgment: Logic, Clarity, Scope, and Risk

### Logic & Clarity
The document is exceptionally clear, logical, and well-structured. It explicitly separates verified facts from assumed risks, lists verbatim requirements, and documents design trade-offs. The reasoning behind each implementation choice is easy to follow. 

### Scope
The scope of the changes is tight and disciplined. The developer successfully resisted scope creep (e.g., not adding category-wide bans, not altering core pricing/AC engines). However, the scope of *delivery* (shipping two features in one PR) represents a minor deviation from the initial plan, which is justified but carries integration risk.

### Risk
The primary risks are **user experience (UX) regressions** and **unreliable browser behavior**. 
1. **Rule Accuracy:** Enforcing a hard block on Strength requirements violates standard 5e tabletop conventions. In 5e, a character *can* wear heavy armor without meeting the Strength requirement; they simply suffer a speed penalty. Hard-blocking this selection prevents legal, albeit suboptimal, character builds (e.g., a Dwarf who ignores the heavy armor speed penalty due to racial traits).
2. **Technical UX Risk (Critical):** The implementation relies on native HTML "disabled option" behavior with tooltips. In many modern web browsers, native `<option disabled>` elements **do not fire hover/mouse events**, meaning tooltips (via the `title` attribute or custom JS) will not render when hovering over a disabled dropdown option.

---

## 2. Direct Answers to Specific Questions

### Does the described approach achieve the two stated goals?
**Yes.** The implementation successfully creates a DM-managed ban-list utilizing existing generic patterns, and it restricts selection based on character capability (proficiency and Strength).

### Is treating Strength as a hard selection-block defensible, or is warning-only more defensible?
**Warning-only for Strength is the more defensible reading.** 
* **The Rules Argument:** In D&D 5e (which this engine mirrors), lacking proficiency and lacking Strength have vastly different mechanical consequences. Lack of proficiency prevents spellcasting and ruins physical checks (effectively an error state). Lack of Strength only reduces movement speed (a trade-off/penalty). 
* **The "Dwarf" Exception:** Tabletop rules contain exceptions (e.g., Dwarves do not have their speed reduced by wearing heavy armor, even if they lack the required Strength). A hard block on Strength prevents these valid builds entirely.
* **The Owner's Request:** "link to str and proficency" does not explicitly mean "treat them with identical severity." Given the engine already had a built-in distinction between ⛔ (proficiency) and ⚠ (Strength), collapsing them into a single hard gate is an over-enforcement that degrades rules accuracy.

### Is disabled-with-reason the right UX choice over hiding ineligible/banned options entirely?
**Yes, in theory, but with a major technical caveat.** 
* **Why it's right:** Hiding options would lead to user confusion ("Is Plate armor missing from this campaign?"). Keeping them visible but disabled maintains transparency.
* **The Caveat:** Native HTML `<option disabled>` elements have highly inconsistent browser support for hover states/tooltips. If the implementation relies on standard HTML tooltips on disabled options, players on Safari or Chrome may see greyed-out text with *no explanation* as to why they cannot select it, resulting in a frustrating user experience.

### Is shipping both features in one combined change a reasonable practical call or a process violation?
**It is a reasonable practical call, but with a warning.** 
Because both features touch the exact same dropdown rendering function, splitting them into two PRs would have resulted in merge conflicts, double-handling, or artificial sequencing. However, the author must ensure that the code within the PR is modular enough that the "Strength hard block" can be easily excised/reverted without tearing down the "DM ban-list" or "proficiency block" logic.

### Is the grandfather-clause approach structurally sound?
**Yes, it is highly structurally sound.** 
Silently wiping out player data (deleting their equipped armor) when rules change is a terrible user experience. Flagging the now-illegal state as a visible violation allows the DM and player to resolve the issue collaboratively. The fact that the DM sees a violation flag without a "one-click fix" is a minor limitation, but entirely acceptable for a first iteration.

### Are any stated assumptions shaky?
**Yes. The assumption that "link to STR and proficiency" means "treat them with identical severity" is highly shaky.** 
This assumption conflates a hard rule (proficiency) with a soft penalty (Strength requirement) and ignores established tabletop conventions already partially respected by the codebase’s existing warning-severity hierarchy.

### Is there a better alternative not considered?
**Yes.** 
* **The "Asymmetrical Gate" Alternative:** Hard-disable options that lack **proficiency** (⛔). Allow selection of options that lack **Strength** (⚠), but display a persistent caution icon on the character sheet and apply the speed penalty automatically if the system tracks movement speed.
* **The "Force Select" Override:** Show a warning dialog allowing the user to bypass the restriction if they have a custom campaign rule or exception (like a magical item or class feature that waives the requirement).

### What's missing from this plan/description?
1. **Details on the Tooltip Implementation:** How are the tooltips rendered on disabled dropdown options? (If using native `title` on `<option>`, this will fail to render in many browsers).
2. **Dwarf/Special Case Handling:** No mention of how the engine accounts for racial traits or class features that bypass Strength requirements for armor.

### Is the Verification section objectively checkable, or too vague?
**It is mixed.**
* **Checkable:** "73 fixture checks passed" and "script blocks parse as valid code" are highly objective and verifiable.
* **Too Vague / High Risk:** The complete lack of manual UI testing is a glaring issue. Because this feature relies heavily on frontend dropdown rendering (disabled states and tooltips), skipping manual browser verification before merging is a significant risk, particularly given browser-specific quirks regarding disabled option tooltips.

### Should this be split into two separate reviewable items after all?
**No, do not split the PR now.** 
Since the code is already written, splitting it would be a waste of development cycles. Instead, the project owner should review the PR with the intent to **merge it only after the Strength hard-block is converted to a soft-warning**, or if they confirm they are comfortable with the hard-block despite the tabletop rule divergence.

---

## 3. Summary Recommendation to Project Owner

1. **Accept Feature A (DM Ban-list):** This is cleanly implemented using existing, proven patterns.
2. **Modify Feature B (Personal Gate):** 
   * Keep **proficiency** as a hard selection-block.
   * Demote the **Strength** check back to an advisory warning (or allow selection with a warning), to align with real tabletop rules and avoid breaking valid edge-case builds.
3. **Verify the UI:** Do not merge this PR until a developer manually tests the dropdown in Chrome, Firefox, and Safari to ensure the "disabled reason" tooltips actually render on hover.