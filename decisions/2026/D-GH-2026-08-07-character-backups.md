# D-GH-2026-08-07-character-backups — cloud characters get an automatic pre-change snapshot

**Status:** Adopted, live in production (migration applied 2026-08-07).

## Context

A real player character was lost. The owner's report was *"I accidentally removed Fenwick from the
Amble campaign"* — i.e. they believed they'd hit unbind, which is `dm_unbind_character` and does
exactly one thing: `update characters set campaign_id = null`. Restoring should have been a
one-field write.

It wasn't, because the row was gone entirely. Three independent checks: an owner-scoped
`count(*)` on the player's profile returned 0; a full listing of every `characters` row contained
nothing owned by them; and `archived_at` was null everywhere, so it hadn't been soft-deleted either.
The player's `campaign_invites` redemption for Amble (2026-08-01, starting AP 36) still exists, and
redemption is what creates the character row — so the row was created and later hard-deleted.

`js/sync.js:312` `deleteCharacter()` issues a literal `supabase.from('characters').delete()`. The
`archived_at` soft-delete added by `2026-07-25-character-archive.sql` is a *separate*, reversible
action, and Delete is what the UI offers *after* archiving. Nothing captured the row on the way out.

The gap was never delete-specific. A bad sync push replacing `stats` with an older or truncated LOG
was equally unrecoverable — the same class of loss `fix/optimistic-character-save` (PR #374) guards
against *prospectively*. Nothing in the system could recover from it *retrospectively*, for anyone,
including the project owner.

## Options

- **A1 — Server-side snapshot table + trigger.** Capture the pre-change row on every UPDATE/DELETE.
- **A2 — Client-side admin export page.** A button that downloads everything the caller can read.
- **A3 — Both, staged.** A1 as the safety net, A2 as the portable off-site copy.
- **A4 — Make delete soft-only.** Drop the hard delete; Delete just sets `archived_at`.

## Decision

**A3, A1 first** (owner). Retention: newest **50** `update` snapshots per character, `delete`
snapshots kept forever (owner picked 50 over the proposed 10 after sizing — see Why).

A `BEFORE UPDATE OR DELETE` trigger on `characters` writes the OLD row into a new
`character_backups` table. Three properties are load-bearing and each was chosen against a specific
failure:

- **No foreign keys.** `characters.owner_id` cascades from `profiles`, and `ap_awards.character_id`
  cascades from `characters`. A FK here would make the backups die with the exact row they exist to
  outlive. `character_id`/`owner_id`/`campaign_id` are deliberately un-referenced uuids.
- **`SECURITY DEFINER` on the trigger function.** It fires as the *player* (role `authenticated`),
  which is granted nothing on `character_backups`. Without it, every save and every delete would
  fail `permission denied` — a backup system that bricks the app.
- **`clock_timestamp()`, not `now()`, for `captured_at`.** `now()` is transaction time, so several
  snapshots in one transaction tie, and the retention prune's `order by captured_at desc, id desc`
  would then fall through to a random uuid and prune arbitrary rows. Caught by the probe run, which
  returned three snapshots with an identical timestamp.

Admin surface: **none**. RLS on with zero policies and no grant to `authenticated`/`anon`, so the
Supabase dashboard (service_role) is the only reader — the same posture `feedback` already
established (`sql/schema.sql:663`, `rls-policies.sql:424`: *"there is no in-app admin view"*).

## Why

**A1 over A4.** They aren't rivals, but A4 alone only addresses deletes. It does nothing about an
overwrite silently replacing `stats`, and it quietly changes what "Delete" means to players. A1
covers both classes and needs no behaviour change at all.

**A1 over A2 as the primary.** An export is point-in-time, depends on someone remembering to run it,
and RLS caps it at what that one account can read — a DM sees only their own campaigns' characters,
so it can never be a full backup. A trigger catches every route by construction: owner delete, DM
action, bad sync push, stray SQL in the dashboard.

**No new admin role.** Inventing one would mean an `is_admin` flag, RLS policies keyed on it, and a
UI — new attack surface reachable from the anon key, to solve a problem that the existing
service_role/dashboard pattern already solves at zero surface. Verified no admin concept exists
today: no `is_admin` or `'admin'` hit anywhere in `sql/` or `js/`, and both `schema.sql` and
`rls-policies.sql` state the dashboard-only posture explicitly.

**50 rather than 10.** Sized against real data before agreeing: stored `stats` averages 2,590 bytes
compressed (max 4,603) across the current 15 characters, so 50 snapshots ≈ 130 KB per character and
the whole roster ≈ 2 MB against Supabase's 500 MB. The binding constraint is churn, not bytes —
roughly one save per purchase, and the largest character has 36 LOG events, so 50 spans a full build
plus a stretch of play.

**Snapshot on any meaningful column, not just `stats`.** The trigger fires when `stats`, `name`,
`kind`, `ap`, `campaign_id` or `archived_at` changed, and skips a bare `updated_at` touch. Wider
than the "stats-changing" the retention was specified against, deliberately: `campaign_id` is the
field whose loss started this, and recording it costs nothing since the row is being written anyway.

## Verified

A probe character exercised the whole path in production, then was removed along with its snapshots
(roster confirmed back to 4 in Amble, 15 characters, 0 backup rows):

- meaningful update → one `update` snapshot holding the **pre-change** LOG; no-op update → **no**
  snapshot; binding change → snapshot recording the prior `campaign_id`; delete → `delete` snapshot
  holding final state **including** the Amble binding.
- restore from the `delete` snapshot reinstated the character under its **original id**, back in
  Amble, with `stats.id` rewritten to match the row (D-GH40 envelope stays self-consistent).
- 60 consecutive updates pruned to exactly **50** `update` rows (the newest 50), with the `delete`
  snapshot surviving all 60 prunes.
- `get_advisors(security)`: the only new finding is `rls_enabled_no_policy` on `character_backups`,
  INFO level — that *is* the access model. `snapshot_character` does not appear in the
  SECURITY-DEFINER-executable list, confirming the `revoke execute`. All WARNs are pre-existing.

## Consequences / still open

- A restore is a hand-run SQL statement by the project owner. The recipes (find by player name,
  restore a deleted character under its original id, roll a live character back) are kept as comments
  in `sql/migrations/2026-08-07-character-backups.sql` so they don't have to be re-derived under
  pressure. A restore itself trips the trigger, so an unwanted restore is also undoable.
- **This is not retroactive.** Fenwick predates the trigger and is not recoverable from it.
## Addendum (same day) — the A2 half, and why the *client* export is the primary mechanism

A2 shipped as an **Export backup** button on `tools/characters.html`, using `peekCharacter()` (the
read-only fetch — `loadCharacter()` would reconcile every character on the way past, and taking a
backup must never mutate what it backs up). Archived characters are always included regardless of the
"Show archived" checkbox: that box filters a *view*, and a backup silently thinned by a UI toggle is
the same class of quiet gap as the missing delete snapshot. Characters with no `stats.LOG` (a
redeemed invite nobody ever opened) are reported by name rather than dropped.

**A scheduled agent-run backup was attempted and rejected on evidence.** Two things killed it:

1. **It cannot scale.** Any agent-run job has to pull the bundle *through a model context* to hand it
   to the Drive tool. The full bundle was 274 KB pretty-printed and 140 KB compact — both already
   over the limit at 15 characters, and `character_backups` alone will reach ~2 MB. The browser has
   no such ceiling, which is why the in-app export is the primary mechanism and not the convenience.
2. **The Routine could not carry its connectors.** A scheduled Routine created from an agent session
   cannot inherit that session's Supabase/Drive connectors, so it would have fired weekly with no
   tools and quietly done nothing. It was created, then **deleted** — a backup job that looks
   scheduled but silently no-ops is worse than none, because it buys false confidence, and a
   *disabled* one sitting in the list eventually reads as "backups are handled" to whoever skims it.

**What replaces the automation: a staleness warning, not a scheduler.** Deleting the Routine means the
export is a manual act, and the original failure here was never "the button was hard to find" — it was
that nobody remembered. So My Characters now tracks the last successful export and warns when it is
7+ days old or has never happened, turning the export button red at the same time. Tracked **per
browser** (`localStorage`), deliberately not per account: the exported file is a physical thing on one
device's disk, so an account-wide flag would let a desktop export silence the warning on a phone that
holds no copy at all. Per-device errs toward nagging someone already covered, which is the harmless
direction. A `localStorage` read failure is likewise treated as "never exported" rather than
"recently exported" — every tie breaks toward the warning.

## Addendum 2 — an in-app admin backup was requested, considered, and rejected

The question raised was whether a nominated account (`jrc.chow@gmail.com`) should be able to back up
*everything* from inside the app. Three findings decided it:

1. **A client-side allowlist cannot do it.** RLS, not the client, decides what comes back:
   `characters_select` is `owner_id = auth.uid() or is_campaign_dm(campaign_id)`. That account owns 2
   characters and DMs all 4 campaigns, reaching 6 of 15 — the other 9 belong to players in no campaign
   it runs. Dropping the client-side owner filter would have produced a file that *looks* like a full
   backup while silently missing 60% of the data, which is worse than not offering it. (It would also
   have published a personal email address in a public repo.)
2. **Doing it properly means inventing an admin role**, which this project deliberately does not have —
   stated in `rls-policies.sql` ("An in-app restore UI would require inventing an admin role, which this
   project deliberately does not have") and `schema.sql` ("No role column: roles are per-campaign and
   derived"). Reversing that is a real security-model change, not a feature toggle.
3. **It would grant no new capability, only a weaker route to an existing one.** `service_role` already
   reads everything from the dashboard. An admin role would mint a *second* key with that same reach —
   a browser session token in `localStorage` — turning any future stored-XSS from "the attacker gets
   that user's 2 characters" into "the attacker gets all 15 and every character created afterwards".
   Given `AGENTS.md` already treats stored XSS as a hard invariant because cloud data crosses users,
   that is a poor trade for saving ~60 seconds on a rare, deliberate operation. It buys no automation
   either: the scheduled route stays dead for the reasons in Addendum 1.

**Decision:** keep the no-admin-role posture. Full-database backups run from the Supabase dashboard via
`sql/full-backup.sql` (added alongside this record), which offers a per-character CSV form and a single
JSON bundle, and cross-references the existing restore recipes rather than duplicating them. **This
should be revisited if an in-app admin surface is ever wanted for other reasons** — an admin restore UI
over `character_backups`, a cross-campaign roster, support tooling — because at that point the role has
to exist anyway and is better designed deliberately than bolted on during an incident.

The division of labour that came out of this is the right one and should be kept: **`character_backups`
is the fine-grained history (server-side, every change, time-travel), the exported file is the
off-site disaster copy (current state, held by the user, outside the app).** Neither substitutes for
the other, and the first off-site copy was taken on 2026-08-07 by splitting the bundle out of a saved
tool-result file — one JSON per character in the `pact-character/1` envelope, plus the full bundle.
