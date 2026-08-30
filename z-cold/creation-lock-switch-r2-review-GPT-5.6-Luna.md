GPT-5.6 Luna (default)

# Creation-lock switch — revision 2 review

## 1. Does the approach achieve the goal?

- **moderate / high confidence** — The plan now appears logically capable of achieving the stated pricing goal, but the strongest risk is not the engine semantics; it is the client-side materialisation path. The goal depends on campaign configuration actually becoming part of each player's append-only log. Without code access, I cannot verify that the equality checks, event construction, and load ordering really produce the intended state. The plan itself correctly identifies materialisation as the most intricate piece and gives it dedicated tests. fileciteturn0file0L109-L117

- **minor / high confidence** — The scope is internally coherent for v1: the explicit finalise switch, automatic threshold mechanism, DM unlock, and future-only pricing semantics are all specified. The important limitation is that availability blocking is explicitly deferred to Plan 2, so “finished” is currently a pricing/state concept rather than a complete prevention of creation changes. That is acknowledged rather than hidden. fileciteturn0file0L132-L135

## 2. Shaky assumptions

- **moderate / high confidence** — Materialisation-on-load remains the largest unverified assumption. The plan says configuration is reconciled into the player's log and that each append is equality-guarded, but there is no explicit test covering two competing configuration changes between player loads (for example, DM changes threshold A → B → C before the player reconnects). The latest config is intended to win, but the plan should verify that reconciliation does not accidentally append an obsolete intermediate state. fileciteturn0file0L101-L114

- **moderate / high confidence** — The assumption that re-adding `campaignBound` is sufficient to make it undo-resistant is plausible from the stated behaviour, but the plan only explicitly tests the simple sequence “undo marker → next load → re-add”. It does not explicitly test repeated undo/load cycles or undo after other events have subsequently been added. Those cases matter because the mechanism is deliberately client-side. fileciteturn0file0L64-L68 fileciteturn0file0L190-L194

- **minor / high confidence** — The defaults concern is substantially resolved by the documented historical behaviour: `auto` unset falls back to the historical `campaignBound` behaviour, while explicit `false` disarms it. However, because this is an intentionally non-obvious compatibility default, the plan would benefit from treating the exact truth table as a tested compatibility contract rather than relying primarily on prose. The existing fixture references help, but the review text does not show that every relevant combination is covered. fileciteturn0file0L73-L90

## 3. Two-mode lock model

- **moderate / high confidence** — The model is coherent after the refinement that `creationUnlocked` suppresses automatic relocking. Without that refinement, an unlock would indeed be ineffective for an over-threshold character. The current stated rule—explicit lock/unlock precedence by log order, while unlock suppresses automatic relocking—can produce predictable states. fileciteturn0file0L92-L100

- **minor / high confidence** — The coexistence of reversible automatic locking and future-only explicit locking is potentially surprising, but the plan explicitly documents this as intentional. The risk is therefore primarily UX/DM expectation rather than an unresolved rules contradiction. The plan already calls out that raising the threshold can make an automatic lock disappear and that explicit locking behaves differently. fileciteturn0file0L155-L166

- **minor / high confidence** — The phrase “last-write-wins” is clear for replay order, but the interaction between a later `creationUnlocked` and a later `creationLocked` should remain represented by fixtures, not merely documentation. The plan says this is tested, including unlock followed by re-finalise, which is the right verification. fileciteturn0file0L176-L180 fileciteturn0file0L190-L191

## 4. What's missing?

- **moderate / high confidence** — There is no explicit test for a DM changing the campaign threshold while a character is already above the old threshold but below the new threshold, then reconnecting. The stated model implies that automatic locking should un-fire when the effective threshold rises above cumulative spend, and this is important because threshold changes are one of the supported DM controls. The plan tests threshold raising generally, but an end-to-end campaign-settings → materialisation → replay case would close the gap. fileciteturn0file0L155-L163 fileciteturn0file0L193-L194

- **moderate / high confidence** — There is no explicit test for campaign membership being removed. The plan defines healing when membership says the character belongs to the campaign, but does not state what happens when membership no longer says that. Since `campaignBound` is append-only, this is potentially an important lifecycle edge case. The source does not specify whether leaving a campaign is supported, impossible, or intentionally out of scope, so this is a gap in the documented lifecycle semantics rather than a claim about the implementation. fileciteturn0file0L109-L114

- **minor / high confidence** — The plan says to open each character in all three tools after backfill and confirm recomputation, but does not explicitly say to perform the same cross-tool check after materialisation. Because the materialisation code lives in both the character generator and live sheet, while the DM console changes the source settings, an end-to-end check across those boundaries would be useful. fileciteturn0file0L121-L129

## 5. Are Verification and Done when objectively checkable?

- **solid / high confidence** — Yes, substantially. The verification section contains concrete pass/fail criteria: 20/0 parity, zero movement in existing fixtures, full folded-build and `compute()` diffs for backfill, explicit purchase-pricing checks, idempotent materialisation, undo healing, tier sensitivity, DM round trips, and static/end-to-end checks. fileciteturn0file0L169-L195

- **solid / high confidence** — The “Done when” section is also materially better than a vague behavioural statement because it separates behavioural completion from implementation checkpoints. The three behavioural bullets are directly testable, and the implementation checkpoints provide concrete acceptance evidence. fileciteturn0file0L197-L206

## 6. Is the honour-system v1 scope defensible?

- **moderate / high confidence** — Yes, as an explicitly bounded v1. The plan does not pretend that client-side finalisation is tamper-proof: it states that a player can undo their own finalise and explains why the spend threshold still makes keeping purchases while escaping the pricing state difficult. Server-side enforcement is explicitly deferred. fileciteturn0file0L16-L20

- **minor / high confidence** — The remaining concern is semantic rather than security-related: because availability blocking is also deferred, “finalised” currently cannot mean “the character can no longer make creation changes”. The plan is clear that this is Plan 2, so it is not a blocking flaw in this plan. fileciteturn0file0L132-L135

## Sections that are solid

- **Engine/API scope:** The plan clearly preserves pure log replay and the public `compute()` signature. fileciteturn0file0L73-L76
- **Campaign-bound decision:** The reversal from revision 1 is explained and internally reconciled with backfill and solo behaviour. fileciteturn0file0L84-L91
- **Threshold source:** The campaign creation budget is explicitly selected and the reason is documented against the real Amble/engine mismatch. fileciteturn0file0L101-L108
- **Backfill safety criterion:** Requiring a zero full-state diff, rather than aggregate equality, is appropriately conservative for live character data. fileciteturn0file0L183-L187
- **Version-bump rule:** The “if and only if identical inputs produce different `compute()` output” rule is objectively testable and protects against an unnecessary rules-version change. fileciteturn0file0L169-L175

## Overall assessment

**No blocking finding.**

Revision 2 has addressed the major contradictions identified in revision 1. From the document alone, the remaining risks are concentrated in the client-side reconciliation/materialisation lifecycle and a small number of campaign-state edge cases. Those are testable implementation risks rather than evidence that the underlying design is incoherent.

The highest-value additional verification would be an end-to-end matrix covering **DM setting changes → player reconnect → materialisation → replay → pricing**, including threshold changes and repeated undo/heal cycles. The plan is otherwise sufficiently specified to proceed to implementation without another architectural rewrite.
