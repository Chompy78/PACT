# 2026-09-01 — creation ends by choice: the ceiling, and eight bugs found by looking

Kept because almost every real defect in this session was found by **running something**, not by
reasoning about it — including four that CI caught after I had convinced myself the work was done, and
three of my own claims that turned out to be wrong. The mechanism shipped is the smaller half of what
is worth remembering.

## What was actually wrong

The question that started it was ordinary: what is the AP status of the Amble characters? Answering it
turned up three characters carrying `creationLocked` markers reading *"84 AP spent, past the 79 AP
creation budget"* — locked against a number none of them owned. A fourth (Anders) joined them mid-session,
at 13:49, under rules `v0.363`, hours before the fix deployed.

The cause was that creation ended by **inference**: `_lockStates()` set a permanent flag the first time
cumulative spend crossed a threshold. Silent, no user action, no way back. A player experimenting in the
builder could permanently lock a character that had never been played.

The design conversation that followed is the valuable part, and it went through several wrong answers
before a right one:

- **Make it reversible** — rejected, because the LOG is edited in place, so a later edit could
  retroactively move where creation ended (reopening `D-GH34` and the undo bug).
- **A ceiling you cannot cross** — better, and dissolved the reversibility question entirely.
- **A fork: finish / keep building / cancel** — both cold reviewers' recommendation. Rejected by the
  owner on reasoning neither reviewer had: *if the ceiling really was the whole creation budget, "keep
  building" is wrong too.* The fork moves the guess from the app to the player, who knows no more than
  the app does. The person who knows is the DM.
- **R3: a wall, plus a DM-only raise control** — chosen.

## The ceiling is the DM's figure plus drawbacks, and the halves are asymmetrical on purpose

`ceiling = the DM's assigned figure (frozen snapshot) + the drawback grant (live)`.

Frozen, because a later chapter award must not silently inflate a creation budget. Live on the drawback
half, because a drawback taken mid-build must hand back the room it paid for.

**I made the exact mistake the freeze exists to prevent, minutes after designing it** — computing each
character's ceiling from *current* DM AP, so a 5 AP chapter reward inflated three of them. The owner
caught it. If the author of the rule gets it wrong with the plan open in front of them, a tool computing
it live would too.

## Four bugs CI caught that I would have shipped

1. **`isCreationDraft()` could not see a lock that was the last event.** It read `_replay`'s per-event
   callback, which reports the state *entering* each event. Harmless while the automatic tripwire
   existed (the lock landed mid-log); **fatal afterwards**, because pressing "Finish creating" writes
   that event last. A player would finish creation, save, reload — and be a draft again.
2. **`repriceDraft()` had the identical blind spot**, which meant the next edit would re-price every
   purchase the lock exists to freeze.
3. **A test hung the CI suite for ten minutes** by calling `alert()` in a headless browser — every
   assertion passing, job cancelled on timeout. This harness has no global dialog handler, so any stray
   `alert()` hangs the whole gate rather than failing it.
4. **The DM Console control landed in the wrong function.** I anchored the insertion on "impose-drawback
   span, then `return h;`" — and *both* `dmEditBody()` and `dmToolsBody()` end that way. It matched the
   first. A `ReferenceError` rather than an `undefined` is what exposed it.

Underneath 1 and 2 is one rule worth naming: **`_replay`'s callback answers "what was true when this
event arrived"; anything asking "what is true NOW" needs the probe pattern** that `chargesGoldAndTime()`
already used. Two functions had it wrong, in the same way, for the same reason.

## Three claims of mine that were wrong

- **"None is stranded on day one"** measured the wrong thing. Skylar had *zero* headroom.
- **Moss proves the per-character point** — he doesn't. His own ceiling *is* 79, identical to the default
  he locked against. Skylar (ceiling 80) was the case all along.
- **`THEME_SLIP` is an untested tuned constant** — it isn't. `random-quality-ci.mjs` already guards the
  property rather than the number, which is the better test.

Also: **a hand-built test fixture silently disagreed with reality.** My scratch copy of Caspian's log
captured 31 of 33 events, and the two it dropped included his lock — so I reported him unlocked when he
wasn't. The SQL that reads live data caught what the file didn't.

## Two things the process caught that reading would not have

**The Supabase advisor found the new trigger function callable by the `anon` role** via
`/rest/v1/rpc` — Postgres grants `EXECUTE` to `PUBLIC` by default and PostgREST exposes it. Invisible in
the SQL under review; visible only in the advisor's output. That is the concrete case for the
per-change rule that the advisor runs after every migration.

**Reviewing PR #481 surfaced a data-loss bug nobody was looking for.** A random roll re-derives the LOG
from the DOM, and the DOM has no control representing a ceiling or a lock — so both were destroyed.
Reproduced live: ceiling 78 gone, creation un-finished. Not #481's bug (the rebuild long predates it),
but two things changed underneath it: the ceiling made the threshold *meaningful data that could now be
lost*, and #481 made Random far more attractive to use. **A known-cosmetic gap became a data-loss one
because of a change somewhere else entirely.**

## Rules of thumb this session earned

- **When two functions end with the same shape, an anchor built from that shape is ambiguous.** Anchor on
  something unique to the target, or verify which function the insertion landed in.
- **A figure's name must say which question it answers.** `spentTowardThreshold` reads 0 for a character
  whose `economy().spent` reads 67, because the lock's accounting excludes the creation burst. Two rows
  both labelled "spent", disagreeing by 67, would be worse than one.
- **A failed write can truncate the file it was writing.** A script that errored mid-write left
  `CHANGELOG.md` at zero bytes, and it was committed before the diff stat was read. Write to a temp file
  and rename.
- **A red gate that isn't your fault is still worth reading.** `pricing` failed once with "Live Sheet
  never became ready" on a PR touching only CharGen — a flake, confirmed by re-running unchanged. Both
  panicking and waving it through would have been wrong.
- **Fixing a bug centrally is not always right.** The randomize fix belongs in the roll, not in
  `replaceWholeLogFromBuild()`, because that function also loads *different* characters — where
  preserving creation state would let one character inherit another's ceiling.
