# D-GH-2026-08-11-character-claim-link-copy-not-transfer — claim link copies a character, doesn't reassign it

Status: **Active**, 2026-08-11.

## Context

`docs/TASK_BOARD_NEXT.md`'s "DM manually adds/imports a character to a campaign, then hands off ownership
via a claim link" task (branch `feat/character-ownership-claim-link`) was drafted assuming the claim link
would reassign `owner_id` on the DM's existing character row — a brand-new `SECURITY DEFINER`
ownership-transfer RPC. That was the reason the task was rated Effort: high · Risk: high and carried a
recommendation to run `/make-code-cold-plan-review` before implementation: `characters_update`'s RLS
policy requires `owner_id = auth.uid()` in both `USING` and `WITH CHECK` (confirmed via `grep -n
"owner_id" sql/rls-policies.sql`), meaning raw ownership reassignment is blocked on purpose today, and
drilling a deliberate hole through that is a genuine trust-boundary change.

During task-board triage on 2026-08-11, the owner questioned whether the flow actually needs to reassign
the *same* row at all, versus just giving the player their own copy of the character.

## Options

- **A1 — keep the transfer design.** Build the ownership-transfer RPC as originally scoped. Preserves a
  single canonical row/id across the handoff (the "same" character before and after), but requires a new
  authorization surface on the one boundary (`owner_id`) this project's RLS deliberately protects.
- **A2 — redesign as a copy.** The claim link creates a brand-new `characters` row owned by the redeeming
  player, seeded from the DM's source character (stats/LOG/kind), auto-bound to the source's campaign.
  The DM's original row is untouched. No RLS/ownership-model change needed at all — a player inserting
  their own row (even one seeded from another user's data server-side) is already exactly what the
  existing insert grant (`id, owner_id, name, kind, stats`, `owner_id = auth.uid()`) allows.

## Decision

**A2 — copy, not transfer.**

## Why

The entire risk rating on this task came from one thing: a new path that can change `owner_id` on an
existing row. A2 eliminates that path completely — the redemption RPC only ever `INSERT`s a row the
redeeming player already has the right to own, it never `UPDATE`s the source row's ownership. That
collapses the task from a genuine security/trust-boundary change to an ordinary feature build, and drops
the recommended `/make-code-cold-plan-review` step as no longer necessary — the risk it existed to catch
is gone by construction, not merely mitigated.

The trade-offs accepted: the copy is a snapshot (later DM edits to the source don't propagate — acceptable,
since once handed off it's the player's character); the DM's original character stays in their account
afterward (accepted as a feature — a reusable template for the next NPC-to-PC promotion) unless a future
session decides a cleanup/archive affordance is worth adding. Both are UX questions, not safety questions,
and are left as open items on the task's own entry rather than settled here.

## Status

Active. Re-scoped `feat/character-ownership-claim-link` task entry in `docs/TASK_BOARD_NEXT.md` to match;
the branch name is unchanged (kept for continuity with existing cross-references in the security-audit
task) even though the mechanism is now a copy, not a transfer.
