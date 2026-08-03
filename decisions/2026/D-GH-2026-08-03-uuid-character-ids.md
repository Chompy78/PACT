# D-GH-2026-08-03-uuid-character-ids — character ids are UUIDs, because the cloud column is `uuid`

Status: Active

## Context

`genCharId()` in `js/character-store.js` minted `'c' + Date.now().toString(36) + random` — e.g.
`cmscl7ilrr5muh`. That predated cloud sync entirely; it was migrated verbatim out of the two tools as
the first shared primitive, and nobody re-examined it when `characters` arrived with `id uuid`.

Consequence: **a character born locally could never be saved to the cloud.** Postgres rejects the id
outright — `invalid input syntax for type uuid: "cmscl7ilrr5muh"`. Only cloud-BORN characters worked
(invite redemption, which takes its id from the server), which is why this survived so long: every
character anyone had successfully synced came from an invite.

It failed badly rather than cleanly. `saveCharacter()` writes localStorage *before* it pushes, so each
rejected attempt left a local-only record behind under the bad id. The user saw the same character
twice in My Characters — once as the real cloud row, once as the orphan — with nothing on screen to
distinguish them.

## Decision

- `genCharId()` returns `crypto.randomUUID()`, with a v4 built from `crypto.getRandomValues()` as a
  fallback for non-secure contexts (`file://`, plain-http LAN testing) where `randomUUID` is absent.
- New `isCloudCharId(id)` exports the format predicate, so the generator and the validator cannot
  disagree.
- `saveCharacter()` migrates a legacy id on first push: mint a UUID, carry the localStorage record to
  the new key, remove the old key **after** the new one is written (a crash mid-migration loses
  nothing), and return the new id. It also returns `migratedFrom` for callers that want to report it.
- **Every save call site adopts the returned id.** Not adopting it would migrate again on the next
  save and strand a second row. The join-campaign path additionally reassigns its local `id`, because
  `bindCharacterToCampaign` runs immediately afterwards and must target the row that was actually
  inserted.

## Why not keep the short id and map it

A local↔cloud id map is a second source of truth for identity, and identity is exactly the thing that
was already ambiguous here. The envelope format (D-GH40) carries `id` inside saved files and handoff
batons, so a mapping layer would have to be consulted on every import, export, handoff and deep link.
Making the id valid everywhere from birth removes the question instead of tracking it.

## Related: My Characters now says which is which

The duplicate was only confusing because both rows rendered identically. `listMyCharacters()` now tags
each row `cloud` / `pendingSync`, and the page shows **☁ Cloud** or **📥 Device only**. Offline, `cloud`
reports what the device last knew (`!dirty` — a push confirmed it), which is the honest answer when the
server can't be consulted. This is what lets an owner tell an orphaned local copy from the real one and
delete the right thing.

## Verification

Parity 24/0, static audit 27/0, browser e2e 3/3. `genCharId()` output checked against
`isCloudCharId()`; the legacy sample `cmscl7ilrr5muh` correctly rejected. No production data touched —
existing cloud rows already have valid UUIDs, and legacy local ids migrate lazily on their next save.
