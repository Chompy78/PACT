# D-GH-2026-08-08-universal-autosave-toggle

**Context.** Part B3 of `docs/plans/2026-08-08-shared-sync-chip-part-b.md` makes cloud autosave the
default for every character, not just campaign-bound ones (which already autosave unconditionally, with
no off switch, since 2026-08-03 — built specifically so a DM can see a player's progress without waiting
for a manual save). v1 and v2 of the B3 design both proposed a one-way consent model for non-campaign
characters (an eligibility flag or a stamped consent timestamp), keeping campaign-bound characters on
their existing always-on, no-toggle path. The owner rejected that split during implementation planning
and asked directly: "can we just have a toggle for everyone, even campaign bound ones?"

**Options considered:**
- **C1 — keep campaign-bound characters locked to always-on** (no toggle), give the free toggle only to
  non-campaign characters. Preserves the DM-visibility guarantee campaign autosave was built for, at the
  cost of two different rules for two character types.
- **C2 — one universal, freely-reversible toggle** covering every character uniformly, including
  campaign-bound ones. A player can turn off autosave on a campaign character; the DM's roster can go
  stale until that player manually saves again.

**Decision:** C2, chosen directly by the owner.

**Why.** A single mechanism governing every character is simpler to build, simpler to explain, and
removes the earlier design's actual hard problem (distinguishing "consent" from "row existence," a
one-way stamp vs. a durable flag) by making the setting visible and reversible rather than a one-time,
mostly-invisible event. The DM-visibility regression this reintroduces is real — it is the literal reason
campaign-bound autosave had no toggle in the first place — but it is being accepted knowingly, not
overlooked. The open follow-up (not yet designed): DM Console's roster currently has no way to show a DM
that a player has switched autosave off, which is the concrete way this tradeoff could surprise someone
in practice; `docs/plans/2026-08-08-shared-sync-chip-part-b.md`'s B3 step 3 flags surfacing this as worth
considering when the toggle UI is actually built.

**Consequence for the data model:** replaces the earlier `cloud_autosave_consented_at timestamptz`
(one-way stamp) design with `characters.autosave_enabled boolean not null default true`. As implemented,
this is a **plain column grant** (`grant update (autosave_enabled) on public.characters to authenticated`,
plus the same column added to the existing insert grant) under the existing owner-only
`characters_update`/`characters_insert` RLS policies — mirroring `archived_at`'s precedent, not a
`SECURITY DEFINER` RPC. An RPC (mirroring `award_ap()`) was the plan at the time this record was first
written, ahead of the code; it turned out unnecessary once implementation showed the owner-only RLS
policies already gate this column correctly, the way they already gate `archived_at` (fixed here per this
project's "shipped artifact wins over the written guide" rule — verified against the actual
`sql/rls-policies.sql` grants and `sql/migrations/2026-08-08-universal-autosave-toggle.sql`, not assumed).
Default `true` for every character, existing and new — not treated as retroactive enrollment in the sense
the earlier design worried about, because the setting is immediately visible and immediately reversible,
unlike a silently-stamped one-way consent flag.

**Status:** DECIDED and SHIPPED (2026-08-08, PR #379 → `preview`, promoted to `main` in PR #380). Migration
`sql/migrations/2026-08-08-universal-autosave-toggle.sql` applied to the live database and verified
post-apply. Two real bugs in the write path (`setAutosaveEnabled()`) were found by `/code-review ultra`
before merge and fixed — see the CHANGELOG entry and `testing/scripts/sync-autosave-toggle-ci.mjs`.
