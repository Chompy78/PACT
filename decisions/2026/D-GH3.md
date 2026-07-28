# D-GH3 — CharGen exports now match the Live Sheet's native event format

Status: Active

- **Context:** CharGen → Live Sheet exports were bundling itemized purchases into coarse patch events, so imported drawbacks could not be bought off and ledger entries were missing for individual purchases.
- **Options:** (i) keep the coarse patch export and patch the Live Sheet to infer itemized buys from patches; (ii) change the exporter to emit discrete native buy events for each itemized purchase while preserving the existing totals and ordering.
- **Decision:** (ii). The export now writes the same discrete buy events the Live Sheet would create when an item is bought natively, while keeping structural patches for scalar and blob-style fields.
- **Why:** imported characters should be indistinguishable from hand-built ones in the Live Sheet, including buy-off behavior, per-item ledger lines, and per-item cost drift.
- **Status:** IN FORCE.
