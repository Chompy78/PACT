# D-GH-2026-08-19-drawback-statcap-enforcement — a stat cap is enforced in both directions

**Status:** DECIDED · shipped in `BUILD v1.427` · **no `DATA.version` bump** (`drawbackFx` is display-only;
`compute()`'s numeric output is unchanged — only a warning string gained a marker)

## Context

23 drawbacks carry a stat cap in `DATA.drawbackMaxStats`. The guide states the rule twice, in two shapes:

- §14 prose: *"you may only take a capped drawback if your current score is at or below the cap. The cap
  is the price of entry."*
- the per-drawback cells: *"your Dexterity score can never exceed 12."*

Three cells then added a third, contradictory claim — *"The tool only warns, it does not block… DMs should
enforce it as a hard requirement"* — which is what surfaced the whole question.

**Measured before changing anything**, because the claim turned out to be half wrong:

| | Live Sheet | CharGen |
|---|---|---|
| take a capped drawback above the cap | **blocked** (`⛔ Purchase blocked`) | allowed |
| raise the score past the cap while holding it | **blocked** (12 allowed, 14 refused) | allowed |

So *"the tool only warns"* was true of CharGen and false of the Live Sheet. It was never accurate as the
blanket statement it was written as, and had been copied into five more cells than the three first found.

## Decision

**Both directions are enforced** (owner's ruling). Enforcing only the first leaves the drawback a loan:
take `Frail` at CON 10, keep the AP, buy CON to 16 and shed the penalty.

- The engine's cap warning gains the **⛔** marker its sibling hard prerequisites (`reqRace`, `minHD`)
  already use. The Live Sheet needed no change — its `buy()` already blocks anything not matched by
  `SOFT_WARN` — so the marker makes the intent explicit rather than altering behaviour there.
- **CharGen** disables a capped drawback whose cap the current score breaks, and clamps a score that would
  breach a cap it already holds.

### Why clamp rather than revert, and why not un-tick

**Clamped to the cap**, because the cap *is* the highest legal value — the player lands on what they can
actually have, with a `flash()` saying why. Reverting to the prior value would need edit history the
handler does not have; doing nothing would leave an illegal build.

**A held drawback is never silently un-ticked.** That would delete a purchase the player made and refund
its AP behind their back — the same class of invisible-mutation problem as the award drain fixed earlier
the same day.

## What enforcing it exposed

Enforcement turned a soft warning into a hard stop, which made the documentation gap load-bearing:

- **7 capped drawbacks never mentioned their cap anywhere** — `Forgetful`, `Slow Study`, `Suggestible`,
  `Weak-Willed`, `Blunt`, `Frightening Visage`, `Illiterate`. Blocking on an undocumented rule is a wall
  with no sign on it.
- **5 more** had the cap in the guide but not in `DATA.drawbackFx`, so the tools were silent about a rule
  they were about to enforce.

All 12 now state it, in the house wording the other 16 already used, on **both** sides. Guide and
`DATA.drawbackFx` agree on all **63** rows that have a guide row (the six `Affliction — …` entries share a
combined row), and all **23** caps are documented.

**No live character violates any cap** — all 23 checked against every character in the database *before*
enforcing, so nothing existing was retroactively blocked.

## The gate, and why it was added last

`verify-guide` gains a **drawback text** check (9 → 10 checks). It was added only *after* both sides
agreed: a gate that is red on arrival is not a gate, and `AGENTS.md` requires these to sit at 0 failed.

Two mistakes in the first comparison are worth carrying forward, because both under-reported and
over-reported at once:

1. **Decode HTML entities before comparing.** The first pass reported **ten** mismatches; **seven** were
   `&#x27;` vs `'` on otherwise identical text.
2. **Compare whole values, not substrings.** `includes()` waved through five cells that had *extra* text
   appended — which is how the "tool only warns" claim survived in five more places than the three found.

The shipped check does both, and additionally asserts that every capped drawback documents its cap.
