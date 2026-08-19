# D-GH-2026-08-19-drawback-cap-player-tools — the campaign drawback cap reaches all three tools

**Status:** DONE · no `DATA.version` bump (see *Why no version bump*)

## Context

`feat/drawback-cap` (v0.351) gave a DM a campaign-level cap on drawback AP, enforced by passing
`opts.drawbackCap` to `compute()`. The wiring was added to `DM-Console.html` and **nowhere else** — 6
occurrences there, **0** in either player tool, confirmed by grep.

So the cap reached `compute()` on the DM's side only. A player in a capped campaign saw the **full**
drawback grant in CharGen and the Live Sheet while their DM saw the capped figure: two people reading
one character and getting different AP, with nothing on either screen indicating which was right.

It was survivable while a drawback was half of a cancelling pair. **v0.355/v0.356 made the grant real
income**, so the discrepancy is now a straight difference in spendable AP.

## Decision

Both player tools pass `drawbackCap` on **exactly the same `'active'` campaign gate** they already use
for `dmAp` and `ignorePlayerAp` — `_cgDmOpts()` in CharGen, `_dmOpts()` in the Live Sheet.

The shape-reading is extracted **once**, to `drawbackCapFromRules(rules)` in `js/campaign.js`, and all
three tools call it. Pasting DM Console's three inline lines into two more files would have made three
copies of one rule shape — the drift this project keeps paying for, and the same mistake as the local
`MUT`/`foldBuild` closures that D-GH26/36/37/40 spent four rounds deleting.

`js/campaign.js` is the right home: it owns campaign shape, and **all three tools already import from
it**, so no new dependency edge is created.

### The two defaults both matter

```js
const c = rules && rules.drawbackCap;
if (!c || c.enabled === false) return undefined;      // absent key = OFF
const n = Number(c.ap);
return Number.isFinite(n) ? n : undefined;            // present key, enabled unset = ON
```

- **Absent `drawbackCap`** → `undefined` → off.
- **Present but `enabled` unset** → **ON**. A campaign saved by an older DM Console build predates the
  flag and must still enforce the figure it stored.
- `undefined` is **not** "no cap" — it leaves `compute()` on its **advisory** path, which is the correct
  rule for a character with no campaign to adjudicate for it: full grant, plus a warning.

## The displayed number had to move with the applied one

Both tools showed the **guide's** figure (`DATA.drawbackCap`, 12) in their drawback panels. Once the
campaign's cap is what `compute()` applies, showing 12 to a player whose DM set 8 is the same bug
wearing a different hat. Both now display the campaign's cap when one is enforced, and the Live Sheet
changes its wording with it — *"the guide caps them at 12 AP; confirm with your DM"* becomes *"your DM
caps them at 8 AP, so the excess is not granted"*, because one is advice and the other is a fact.

`compute()`'s own campaign warning (*"Drawbacks grant 14 AP but this campaign caps them at 8 — 6 AP not
granted"*) reaches the player automatically: both tools already render `compute().warnings`, and passing
the cap is what switches that warning from the advisory text to the campaign one.

## Why no version bump

`compute()`'s output for a given `(build, opts)` pair is unchanged. Only *which opts the tools pass* has
changed. Per `AGENTS.md`, `DATA.version` tracks mechanics — and the mechanic here shipped in v0.351.

## Verification

`tool-pricing-ci` 134 → **141**, asserted through each tool's **own** opts builder rather than by
calling the shared helper directly — the helper was never the broken part, the wiring was, and a check
that only exercised `drawbackCapFromRules()` would have passed against the bug.

The build is 79 awarded + two drawbacks worth 14, so capped (91) and uncapped (93) differ; a cap that
silently fails to arrive is visible rather than coincidentally equal.

- CharGen and the Live Sheet each pass `12` and compute `91` under an active capped campaign.
- DM Console reads from the same shared helper (`typeof === 'function'`, returns 12).
- All three agree on one number for one character.
- With no resolved campaign, both leave it `undefined` and compute `93` — advisory, uncapped.
- A campaign with the cap switched **off** does not cap: pins that `enabled` is read, not merely the
  key's presence.

**Confirmed to bite:** reverting just the `drawbackCap:` term in the two opts builders fails 3 of the 7
new checks with `expected [12,91], got ["undefined",93]`.

Verified in the real tools headlessly, DM cap of 8, two drawbacks worth 14:

```
CharGen   drawcap "Drawback refund: +14 AP ⚠ over 8 AP — confirm with DM"
          spendable 87  (79 + 8)
          warning "Drawbacks grant 14 AP but this campaign caps them at 8 — 6 AP not granted"
Live Sheet "Drawbacks grant +14 AP — your DM caps them at 8 AP, so the excess is not granted"
           (and with no campaign: "the guide caps them at 12 AP; confirm with your DM")
```

All gates green: parity 40/0, tool-pricing 141/0, chargen-flows 66/66, dm-console-ui 96/96, sw-cache,
log-fuzz 500/500, four sync gates 54/0, verify-guide 9/9.
