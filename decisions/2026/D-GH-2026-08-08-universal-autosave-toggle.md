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
(one-way stamp) design with `characters.autosave_enabled boolean not null default true`, written via a
`SECURITY DEFINER` RPC (`set_autosave_enabled`) mirroring the existing `award_ap()` column-grant pattern.
Default `true` for every character, existing and new — not treated as retroactive enrollment in the sense
the earlier design worried about, because the setting is immediately visible and immediately reversible,
unlike a silently-stamped one-way consent flag.

**Status:** DECIDED. Implementation not yet started — this record exists ahead of the code per this
project's "log as you go" convention, since the decision was made in conversation before any B3 code was
written.
