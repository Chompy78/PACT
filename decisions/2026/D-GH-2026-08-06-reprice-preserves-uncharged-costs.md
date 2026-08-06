# D-GH-2026-08-06-reprice-preserves-uncharged-costs — `compute()` prices `maneuverBuys`, and the pricing escape is deleted rather than kept

Status: Active. Shipped 2026-08-06. **Supersedes the pricing half of
`D-GH-2026-08-06-maneuver-afford-gate`**, which chose option C (a separate `_UNCHARGED_PRICERS` table)
and explicitly deferred this. That record's *Outstanding* section is now closed.

> The branch slug this ID is built from (`fix/reprice-preserves-uncharged-costs`) is a misnomer in
> hindsight — it names option B from the task, not the option taken. Kept anyway: the ID scheme is
> collision-proof *because* it is mechanical, and renaming it to read better would break that property.

## Context

`repriceDraft()` re-derives every buy's frozen `cost` as a `compute().total` delta. `compute()` never
read `maneuverBuys`, so the delta for an `mvbuy` was **0**. Measured on this branch before the change:

```
mvbuy costs before: [4, 5, 6]      economy().spent = 15
mvbuy costs after : [0, 0, 0]      economy().spent = 14      maneuverBuys still 3
```

The maneuvers were kept and 15 AP was handed back. CharGen reprices a draft on load, and since D-GH40
both tools share one save envelope, so a Live Sheet character opened in CharGen and edited once lost the
charge silently. Every pre-lock character is a draft (see `fix/ledger-reconciliation-pass` step 0), so
this reached all of them.

The same root cause had already forced two other compromises: the Live Sheet needed a bespoke pricing
escape for its affordability gate to work at all (a build diff of 0 makes any gate a no-op), and the AP
ledger had no line that could explain the spend.

## Options

- **A — leave `compute()` alone; make `repriceDraft()` preserve the frozen cost** for any category
  `compute()` does not price. Narrow, no `DATA.version` bump. Rejected: it entrenches a purchase
  category the ledger structurally cannot explain, and keeps the gate dependent on a bespoke escape.
- **B — `compute()` prices `maneuverBuys`** (owner's choice, taken).
- **C — defer into `feat/ap-model-reconcile`.** Rejected: leaves a live AP-loss bug outstanding while a
  much broader question is settled.

## Decision

**`compute()` prices extra maneuvers**, on the rung already in `DATA.maneuverBuy` — `base + step×n` for
the nth extra purchase, so three cost 4 + 5 + 6 = 15, surfaced as an **`Extra maneuvers`** ledger line.

`DATA.version` **is** bumped (v0.339 → v0.340): this changes `compute()` output, which is exactly what
the rules-version axis exists to mark. `testing/expected/` gains `EV-016`.

**The Live Sheet's `_UNCHARGED_PRICERS` table is deleted, not updated.**

## Why

**Because the escape stops being necessary, rather than becoming better-organised.** Once `compute()`
prices the purchase, `priceOf()`'s ordinary whole-build diff returns `base + step×maneuverBuys` on its
own — the correct rung, with no special case. Verified: the deltas across `maneuverBuys` 0→1→2→3→4 are
4, 5, 6, 7. So the fourth escape that `D-GH-2026-08-05-pricing-model` **D1** warned against is not
merely justified in a separate table; it is gone. That is what D1 meant by *"retired into that rule."*

**And because one number now serves all three consumers.** The affordability gate, the AP ledger and
`repriceDraft()` previously disagreed by construction: the gate quoted a rung from a tool-local table,
the ledger showed nothing, and reprice zeroed it. They now all read the same `compute()`.

**On the cost of bumping `DATA.version`:** normally a `compute()` change means reconciling every saved
character whose frozen ledger predates it. Here it costs nothing — the app is pre-launch with no real
characters to protect (established in D-GH37), and the change can only ever *increase* a total that was
previously uncharged, so no existing character is retroactively over-budget in a way that removes
something they own. This window is why option B was affordable now and would not have been later.

**A note on how the gap survived:** no fixture carried `maneuverBuys` at all, so the entire category had
zero coverage while the suite reported green — the same blind spot that had hidden the Grit and Vigor
ladders. `EV-016` exists to close it, and the check that matters is the ledger line reading 15, not the
total alone.

## Related

- `decisions/2026/D-GH-2026-08-06-maneuver-afford-gate.md` — superseded in part; its *Outstanding* is closed here.
- `decisions/2026/D-GH-2026-08-05-pricing-model.md` — D1, whose "no fourth escape" this now satisfies by deletion.
- `feat/ap-model-reconcile` — the broader `compute()`-vs-frozen-ledger question, still open and untouched by this.
