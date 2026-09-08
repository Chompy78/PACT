# D-GH-2026-09-08-ap-award-editing — correcting an award happens in place, audited, not by adding a compensating award

**Status:** Active — DM-side (schema, RPC, DM Console UI) shipped and applied to production
(Supabase `piuprrrnaotrtxucrtsb`, migration `ap_award_editing`). Player-facing display of the edit
trail is **not yet built** — see Outstanding below.

Post-apply verification: 0 of 35 characters / 49 existing `ap_awards` rows affected (purely
additive — one new table, one new function, one new RLS policy). Supabase advisor: no new
ERROR/WARN class beyond `edit_ap_award` appearing under the same
`authenticated_security_definer_function_executable` INFO-level class every other DM-write RPC
(`award_ap`, `award_gold`, …) already triggers by design.

## Context

Session found a real live bug: a bulk "session 6" award (DM Console's "Award AP" tick-list action)
landed as `+4` AP on all six Amble campaign characters, with a note reading "session 6: 4 +1 bonus"
— the +1 bonus was never actually applied to the stored amount. Fixed by hand via direct SQL at the
time (there was no other way — `award_ap()` only ever *adds* a new award; there was no supported
path to correct an existing one). The owner asked for this to become a proper DM Console feature:
edit an award's amount/note, with a required reason recorded, across possibly many characters at
once, with edits staged locally and nothing written until an explicit save.

## Options

**A. Overwrite the `ap_awards` row directly, no audit trail.** Simplest, but silently rewrites
history — a DM (or bug) could change what was actually awarded with no trace, and a player has no
way to know their AP total changed for a reason other than a fresh award.

**B. Only ever add a new compensating award (the status quo — `award_ap()` with a delta).** No new
schema needed, but doesn't match what "edit" means to the DM: the original wrong row stays visible,
forever reading the wrong amount/note, with a separate correcting entry the DM has to mentally
reconcile against it every time they look at the history.

**C. A dedicated `edit_ap_award()` RPC + an append-only `ap_award_edits` audit table — chosen.**
The award row itself gets corrected in place (so the history reads right), but every correction is
also permanently logged — before/after amount and note, who, when, and a required reason — in a
table nothing can update or delete. Mirrors the same "never delete, always append a correction"
pattern this project already uses for character history (`pact_enforce_locked_history`, found this
same session) and for drawback buyoffs/DM-removed boons in `js/engine.js`.

## Decision

Option **C**. `edit_ap_award(award_id, new_amount, new_note, edit_note)`:
- Same permission shape as `award_ap()` — any DM of the award's (still-active) campaign, `SECURITY
  DEFINER`, `assert_campaign_active()` guard.
- `edit_note` is `NOT NULL`/required, both client- and server-side (owner decision this session:
  "2: required") — a correction always states why.
- Adjusts `characters.ap` by the **delta** (`new_amount − old_amount`), not an overwrite — composes
  correctly with any award made between the original and the edit, rather than clobbering whatever
  the running total has become since.
- `ap_award_edits` is readable by the same audience as `ap_awards` itself — the character's owner,
  or any DM of its campaign (owner decision this session: "4: transparency" — a player can see that
  one of their awards was corrected and why, not just DM-only bookkeeping).

DM Console gets one new panel ("Edit AP Awards", next to the existing "Award AP" tick-list tile,
same "campaign-wide AP action" grouping): a single grid of every award ever made in the campaign,
across every character, with a character-name filter (owner decision this session: "3: several
characters and awards, basically all of them... maybe have a filter"). Every row's amount and note
are live-editable the moment the modal opens; nothing is sent to the server until **Save changes**,
and only rows whose amount or note actually differ from what was loaded are sent — independent
per-row RPCs (`Promise.allSettled`), so one bad row can't block or roll back the rest, same
reasoning as the existing bulk Award AP action.

## Why

- **Delta, not overwrite, on `characters.ap`.** An overwrite would silently discard any award made
  to the same character between the moment the DM opened the edit screen and the moment they saved
  — plausible in a real session where a DM might award AP to several characters while also going
  back to fix an old note. The delta composes regardless of ordering.
- **A required reason, not optional.** The owner's explicit answer, and it also gives a future
  reader of the audit trail something better than "amount changed" to go on.
- **One grid across the whole campaign, not one character at a time.** The bug this feature exists
  for hit all six party members identically in one bulk action — fixing it required jumping between
  six characters' individual histories by hand. A DM correcting a batch mistake needs to see and fix
  all of it in one place.
- **Staged, not immediate, writes.** The owner's explicit requirement ("edits then they only apply
  when I commit/save them") — protects against a half-typed correction firing on blur, and lets a DM
  review several changes together before anything is sent.

## Outstanding

**Live Sheet has no existing player-facing "view your AP awards" surface at all** to extend with the
edit trail — the only prior use of `getAwardHistory()` in that tool is internal (migrating awards
into itemized log entries when a player clones a campaign character to a standalone copy, not a
visible history panel). Building that display from scratch, in a file this large, without a live
browser to verify against, was judged out of scope for this same session — filed as its own task on
`docs/TASK_BOARD_NEXT.md` rather than added unverified. The RLS policy on `ap_award_edits` already
permits the read (`ap_award_edits_select`, same shape as `ap_awards_select`) — nothing further needs
to change server-side when that panel is built, only client UI.

## Addendum (2026-09-08) — `created_at` made directly editable

`feat/dm-ap-award-filters` extended DM Console's "Edit AP Awards" screen with filters, click-to-sort,
and — the substantial piece — an editable award date. Owner's own words: *"a lot are awarded at the
same second and the ordering makes it hard for me to understand."* Confirmed live: one bulk-award
batch has **24 rows sharing the exact same `created_at` down to the microsecond**
(`2026-08-10 11:58:58.142556+00`).

Two options were put to the owner before any migration was written, per this record's own working
discipline:
- **A. Let the DM rewrite `created_at` directly.** Smallest change; destroys the one immutable fact
  `ap_award_edits`' own before/after ordering rested on.
- **B. A separate `occurred_at` display field, `created_at` left untouched.** More work; preserves
  the audit invariant.

**Chosen: A** — the owner's explicit call, made after B was recommended and the tradeoff (audit
ordering becomes unreliable once the column it orders by is itself rewritable) was stated plainly.
`edit_ap_award()` gained a 5th parameter, `p_new_created_at timestamptz`, nullable — `NULL` means
"this edit didn't touch the date," so the common amount/note-only correction is unaffected.
`ap_award_edits` gained matching `old_created_at`/`new_created_at` columns, populated only on an
edit that actually changed the date. The modal's Date column is now `<input type="datetime-local"
step="1">`, live-editable, and — since the whole point is letting the DM see a corrected order
*before* committing — the date-sort key reads the input's current value, not the loaded one, same
"live value" treatment the note filter already had. Verified with a dedicated Playwright gate
(`testing/scripts/dm-ap-award-filters-ci.mjs`, 26/26), including that a same-second round-trip
(precision lost between Postgres's microseconds and the input's whole-second granularity) does
**not** register as a change, and that a genuine edit is rejected without a reason, same as any
other field.
