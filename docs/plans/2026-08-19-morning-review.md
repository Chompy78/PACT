# Morning review — 19 August 2026

Written overnight after the `preview` → `main` promotion (PR #423). Ordered by what can affect the real
characters being built this week.

**Shipped and live:** rules `v0.343 → v0.353`, `BUILD v1.423`, all 11 CI checks green. Players now get a
working class-unlock checkbox, a buyable `Elf: Wood Elf speed`, the feature-rename alias map, the ten
restored guide illustrations, the theme switcher, and Appendix J.

**Two things were deliberately NOT done overnight**, both flagged in the merge commit: the pre-release
manual QA checklist (this session cannot do manual QA), and the drawback double-count — item 1 below.

---

## 1. 🔴 Drawbacks are worth double — the only item that can unbalance your table this week

**Branch:** `fix/drawback-ap-double-count` · **Effort:** medium · **Risk:** high (changes `compute()`
output, needs a `DATA.version` bump) · **Live on `main` right now.**

`foldBuild()` sets `b.budget = economy().earned`, and `earned` includes `drawbackEarned`. `compute()`
then does `playerAp = b.budget`. But `total` **already** nets drawbacks, because their `cost` is
negative. So a drawback both lowers what you spend *and* raises what you can spend.

Measured on the live engine — a level-1 Fighter awarded 79 AP:

| Drawbacks | Drawback AP | AP actually available | vs 79 |
|---|---|---|---|
| 0 | 0 | 79 | — |
| 2 | 14 | **107** | +35% |
| 4 | 26 | **131** | +66% |
| 6 | 37 | **153** | +94% |

Two players at the same table, one taking four drawbacks, build on 131 AP and 79 AP.

### Why I did not fix it overnight

The bug is unambiguous; **the correction is a genuine two-model choice** and both models are
self-consistent:

```
(a) total NETS the drawback (lower), budget EXCLUDES the refund
(b) total IGNORES the drawback (higher), budget INCLUDES the refund
    current: total nets it AND budget includes it   -> counted twice
```

Both give the same, correct `remaining`. They differ in what the ledger *displays* as "total" and
"budget" — which is player-facing, so it is your call, not mine.

**My recommendation: (b).** The guide says drawbacks *"grant AP up front"*, so a player's mental model
is "my budget went up". Under (b) the Drawbacks line stops appearing as a negative cost and the budget
rises instead, which is what the prose already promises. (a) is equally correct arithmetically but makes
the ledger say something the guide does not.

**Interim mitigation available today, zero code:** the campaign drawback cap shipped in v0.351 limits the
*grant* to 12 AP by default, which caps the overcount at +12 rather than +52. It only applies to
characters in a cloud campaign. For local characters, a house rule ("12 AP of drawbacks, and I check the
total") is the whole fix until this lands.

**Done when:** a level-1 character with N drawbacks has exactly `79 + drawbackAP − spent` available, a
parity fixture pins it, and the guide's §14 wording matches whichever model you pick.

---

## 2. 🟠 The `pact-guide` copy-back — now five sessions behind

The Players Guide master lives in the non-GitHub `pact-guide` project. Everything below exists **only**
in this repo:

- ten embedded WebP illustrations and the four-theme system (restored after `e0c5e9f` deleted them)
- the guide's own theme switcher
- Appendix J
- the "Subclass bonus spells" section split out of "Prepared casters"
- twelve class-unlock price sites (7×N → flat 8)
- the 2nd origin class price (14 → 18) at four sites
- §14's drawback-cap wording
- six corrected Appendix I budget lines

**This is the highest-risk item that is not about this week's characters**, because the documented
transfer direction is master → served copy, and running it now would wipe all of the above.

**Do not use a plain `cp` in either direction.** Run `node testing/scripts/verify-guide.mjs` before and
after; a clean `diff` is explicitly *not* the success condition any more (see the ⛔ box in
`docs/VERSION-SYNC.md`). The file is 1.4 MB, too large to push through the home-server connector, so the
copy has to happen on your machine.

**Also unresolved from the same thread:** you wanted one canonical guide file shared by this repo,
`pact-guide` and `pact-guide-public`. The served copy is now ready for that — verified zero external
references and a defensive theme script — but `pact-guide-public` needs push access attaching before I
can do that side.

---

## 3. 🟠 `refactor/subclass-purchase-unify` — plan drafted, awaiting reviewers

**Cold review document:** `docs/plans/2026-08-18-subclass-purchase-unify-cold-review.md`

Buying the same subclass ability through both CharGen pickers charges twice, silently — 6 AP for a
Cleric buying *Preserve Life* at origin prices. Low exposure at tier 1–2 (only one subclass ability,
*Star Map*, is T1/T2) but it is a real way to lose AP with no warning.

Research changed the shape of the task: **all 192 mirrored abilities agree on price with `subAbilMap` —
zero divergences.** So this is deduplication, not reconciliation. No price has to be decided and no
character's cost should move, which the plan's verification section now asserts specifically.

Three options are put to the reviewers, deliberately not pre-judged, including the smallest one (keep
both representations, share one dedup domain). Ready to send whenever you want.

---

## 4. 🟡 Smaller, and none of them bite this week

| | What | Where |
|---|---|---|
| **Duplicate non-stacking purchases** | Six classes sell "Extra Attack"; the engine charges for all six (102 AP for a Rogue) and only *warns* that they do nothing. All T4 — no tier 1–2 exposure. | not yet on the board |
| **`documents-rules` unstamped** | The marker recording which engine version the guide's prose was reconciled against. Now `v0.353`. | `TASK_BOARD_NEXT` |
| **`ee8dc41`'s commit message is wrong** | It confidently describes a render race in `dm-console-ui-e2e` that cannot occur — the render chain is synchronous. Corrected in a comment at the site; the message itself stands. | — |
| **`z-cold/` housekeeping** | Processed reviews were never moved to `z-cold/processed/`, and `phb-rules-final.jsonl` is unfiled. Both on the `zcold` branch. | — |

---

## What I would do first thing

1. **Decide the drawback model — (a) or (b).** Everything else can wait a week; that one is live and
   affects the characters being built. I can implement and ship it in one pass once you say which.
2. **Run the pre-release manual QA checklist** in `docs/HOW-TO-WORK.md` against the freshly promoted
   `main`, since the promotion went out without it.
3. Then the copy-back, then the refactor reviews.
