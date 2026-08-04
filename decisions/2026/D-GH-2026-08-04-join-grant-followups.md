# D-GH-2026-08-04-join-grant-followups — the join grant's three near-misses, and stale DM AP after a server-side award

Status: Active

Direct follow-up to `D-GH-2026-08-04-campaign-starting-ap`. Everything here was found by an adversarial
review of that PR's own diff, not by a user report — worth recording because all five defects share one
shape: **a value the server owns, read or written as if the client owned it.**

## Context

### 1. `absent` was being read as `zero`

`bind_character_to_campaign` guarded the tier figure with `if v_start_txt ~ '^[0-9]+$'`, so a campaign with
no `rules.startingTier` fell through and granted nothing. That reads as a rare edge case and is in fact the
**default** state: `campaigns.rules` is `not null default '{}'::jsonb`, and `createCampaign()` inserts only
`{name, dm_id}`. A query against the live database found **3 of 4 campaigns** with no `startingTier.ap` at
all — every one of them silently granting 0 while DM Console's Starting AP field sat on screen showing 79.

### 2. A digits-only regex is not a range check

`'^[0-9]+$'` matches `'2147483648'`. The next line casts to `integer`, which overflows and **aborts the
transaction** — so a junk rules blob could hard-fail the join. That is the precise failure the defensive
read existed to prevent; the guard let the one input it was written for straight through.

### 3. The double-pay guard was never executed by its own test

The e2e scenario "rebinding does not grant twice" rebound a character that was *still bound*, which hits the
`v_char.campaign_id = v_campaign.id` early return and exits before the grant block is reached. The
`not exists (select 1 from ap_awards …)` guard — the only thing between a re-join and a second free budget —
was therefore never executed. Deleting it outright would have left every check green.

### 4. `parseInt(x, 10) || 79` in DM Console

`startingTier.ap` stopped being a display dial the moment the server started paying it. A DM setting it to
**0** ("this campaign grants nothing on join") had that saved back as 79, because 0 is falsy. Same falsy-zero
class as the 79 AP conjured onto Cedric Brightblade.

### 5. Stale DM AP read from a local cache

Two paths resolved a character's DM AP through `peekCharacter()`, whose documented behaviour is to **prefer
the local copy**. That is right for `stats` — this device's edits are the freshest — and wrong for `ap`,
which only ever changes server-side: a DM award, or the join grant above. Consequences:

- **CharGen's join path** passed `window._dmAp || 0` to `_cgResolveDmApStatus` on a comment asserting "ap is
  unaffected by a bind" — true when written, false as of the previous PR. A player whose DM had just paid
  them saw 0 spendable AP, every purchase flagged OVER BUDGET, and Randomize refusing with "ask your DM to
  grant some."
- **Live Sheet's `_lsResolveDmAp`** carried the comment "Reads the authoritative `ap` from the server",
  which held only when the device had never cached that character. On a CharGen→Live Sheet handoff it
  usually has.

## Decision

**SQL** (`sql/migrations/2026-08-04-join-grant-bounds-and-default.sql`, mirrored into `sql/schema.sql`) —
three explicit cases instead of one regex doing two jobs:

| `rules.startingTier.ap` | grant |
|---|---|
| absent / empty | **79** — the number the UI has always displayed |
| matches `^[0-9]{1,7}$` | that value; bounded, so `::integer` cannot overflow |
| anything else | 0 — grant nothing, never block the join |

The grant block moved out of the parse branch so all three cases share one guarded payout.

**`js/sync.js` gains `refreshServerAp(id)`** — a server read of `ap` alone, folded into the local record.
Deliberately a *sibling* of `peekCharacter()` rather than a change to it: peek's local-first preference is
correct for its own callers (the DM read-only view, the handoff clone) and only wrong for this one column.
Both AP call sites now use it. Still a pure read — never reconciles, never pushes, touches only `ap`, so it
is safe on a dirty record and cannot clobber unsaved work.

**DM Console** parses with an `_intOr(el, fallback)` helper that falls back only on empty/non-numeric input,
so a deliberate 0 survives.

## Why this shape

The alternative for #5 was to make `peekCharacter()` always re-read `ap`. Rejected: it is used on paths that
must not touch the network at all (offline view), and widening it would push a network round-trip onto
callers that never asked for one. A named function whose *name* says what is authoritative is also the
better defence against the next instance — the two stale-AP bugs above both sat under comments confidently
asserting the opposite of what the code did.

For #1, defaulting to 79 rather than 0 is the choice that makes the UI honest. The field is pre-filled with
79 and a DM who never opens that card has agreed to nothing; granting 0 there means the interface promised a
number the database refused to pay. A DM who genuinely wants no grant can now type 0 and have it stick (#4).

## Verification

- `sql/migrations/2026-08-04-join-grant-bounds-and-default.sql` applied live; `'2147483648' ~ '^[0-9]+$'`
  confirmed **true** and the `::integer` cast confirmed to abort, before the fix.
- Three new `cloud-e2e` scenarios, each covering a branch that previously had none: unbind→rebind (reaches
  the `ap_awards` guard for real), a campaign with no `startingTier` (expects 79), and an over-`int32` tier
  value (expects a clean join at 0). The suite goes 24 → 32 checks.
- `engine-parity` 24/0, `audit` 28/0, `log-fuzz` 500/500 clean.
