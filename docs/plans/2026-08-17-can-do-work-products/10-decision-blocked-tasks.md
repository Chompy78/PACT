# Decision-blocked near-done tasks — recommendation + ready microcopy

Three tasks whose *only* blocker is one owner decision each. For each I state the
recommendation upfront with reasoning, then give the draft copy so that once you
pick, the edit is mechanical. Nothing here is committed.

Australian English throughout. These are drafts for the single writer to fold in.

---

## A — `fix/add-player-hierarchy` — which of the three add-player routes is the default?

DM Console shows three differently-scoped routes with no guidance: the reusable
**Players code** (binds an ALREADY-built character, grants the campaign's starting
tier), a **single-use invite link** (creates a NEW character, grants a per-player
amount), and the **local-file import** card. The task's real deliverable is the
decision, recorded in DECISIONS.md.

**Recommendation: A1 — default to the reusable Players code.**

**Reasoning.** The most common campaign-start situation is players who have
*already* built a character (that's the whole point of CharGen existing before a
campaign starts). The Players code binds that existing character at the campaign's
starting tier — it's the one route that doesn't throw away work the player already
did. The invite link is for the "player has nothing yet" case, and local-file
import is the edge case (a file someone emailed the DM). So the natural hierarchy
is **frequency-ordered**: bind-existing first, create-new second, import last.

| Option | Default route | When it wins |
|---|---|---|
| **A1 (recommended)** | Players code (bind existing) | Players build first, then join — the common flow |
| A2 | Single-use invite link (create new) | Only if your table's norm is "DM sets everyone up from scratch" |
| A3 | Present all three equal, no default | Rejected — this is the current confusing state the task exists to fix |

### Ready microcopy (works for A1; swap the "usual choice" marker for A2)

Order the cards: **Players code → Invite link → Import from file.**

- **Players code** *(mark as the usual choice)*
  > **Use this when** your player has already built their character and just needs
  > to join. Binds their existing character at the campaign's starting tier.
- **Single-use invite link**
  > **Use this when** the player has nothing yet — this creates a fresh character
  > for them and grants their starting AP.
- **Import from file**
  > **Use this when** a player sent you a character file to add on their behalf.

De-emphasise the second and third (smaller, secondary styling); never hide them.

### DECISIONS.md stub to fold in
```
D-GH-<date>-add-player-hierarchy
Default add-player route is the reusable Players code (bind an already-built
character), ordered code -> invite link -> file import, because most players
build before joining and the code is the only route that preserves existing work.
Invite link is the "player has nothing yet" route; file import is the DM-adds-on-
their-behalf edge case. Copy-only/display-only change; no DATA.version bump.
```

**Done when:** each route carries a one-line "use this when…", one is visibly the
default, ordering matches this decision, and the reasoning is in DECISIONS.md.

---

## B — `fix/unnamed-character-default` — real default name, or store blank + render fallback?

CharGen sets a real default NAME of `'New Character'`; DM Console shows
`'Unnamed character'` as a fallback for a blank name. A player sees one word, their
DM sees another, for what looks like the same character.

**Recommendation: B1 — store blank, render a single shared fallback everywhere.**

**Reasoning (deeper fix, low/moderate risk, durable).** The shallow fix is to make
the two literals match. The deeper fix removes the root cause: a *stored* default
name is data pretending to be a placeholder — it means "unnamed" is
indistinguishable from a character the player genuinely called "New Character", and
it's why two surfaces drifted in the first place. Storing blank and rendering a
fallback at each display site makes "unnamed" a single source-of-truth *state*, not
a magic string duplicated across the codebase. The migration risk is real but
bounded (see step 3) and the task explicitly flags `saveCharacter()`'s
`name ?? prev?.name ?? 'New Character'` as the one write path to get right.

| Option | Approach | Tradeoff |
|---|---|---|
| **B1 (recommended)** | Store blank, render shared fallback | Deeper: kills the drift at its root; needs a careful migration guard so existing `'New Character'` rows aren't renamed |
| B2 | Keep a stored default, make both literals identical | Shallow: fixes the visible symptom this week, but the two-literals-drift failure mode remains for the next surface added |

### Implementation (B1)
1. Store an unnamed character with a **blank** name.
2. Define the fallback **once** (a single constant, e.g. `UNNAMED_LABEL`) and use it
   in **every** display site: CharGen, DM Console, My Characters. No second literal
   anywhere.
3. **Migration guard (critical):** characters already stored as `'New Character'`
   must **not** be renamed by this change — only *newly* unnamed characters store
   blank. Confirm `js/sync.js`'s `saveCharacter()` name default
   (`name ?? prev?.name ?? 'New Character'`) preserves an existing stored name and
   only writes blank for genuinely new/unnamed ones.
4. Add a **cloud-e2e assertion** that the same state renders the same string in
   CharGen, DM Console and My Characters.

### DECISIONS.md stub
```
D-GH-<date>-unnamed-character-default
Unnamed characters are stored with a blank name and rendered with one shared
fallback label at every display site, rather than carrying a stored default name.
Existing 'New Character' rows are grandfathered (not renamed). Single source of
truth removes the CharGen-vs-DM-Console drift at its root.
```

**Done when:** one convention is documented in DECISIONS.md, all three surfaces
render the same string for the same state, existing characters are unaffected, and
cloud-e2e asserts it.

---

## C — `feat/invite-peek-campaign-name` — is the token-lookup RPC `authenticated` or anon-callable?

The goal: resolve an invite token to `{campaignName, valid}` WITHOUT redeeming it,
so the join `confirm()` can name the campaign and a revoked link can be
distinguished from a live one when opened signed-out. The auth scope is the whole
decision.

**Recommendation: C1 — anon-callable, with rate limiting.**

**Reasoning.** Only anon-callable fixes *both* findings this task closes. An
`authenticated`-only lookup names the campaign in the accept `confirm()` (LOW) but
leaves the **signed-out** revoked-vs-live banner (MEDIUM) still broken, because the
person opening a dead link is often not signed in. The cost of anon-callable is
that anyone can *probe* whether a token exists — acceptable if (a) the RPC returns
only `{campaign_name, valid}` and nothing sensitive, and (b) it's rate-limited so
it can't be used to enumerate tokens. That rate limiting overlaps the separate
`feat/invite-rate-limiting` task — cross-reference it rather than duplicating.

| Option | Scope | Fixes | Cost |
|---|---|---|---|
| **C1 (recommended)** | anon-callable | BOTH findings (confirm naming + signed-out banner) | token existence is probeable → needs rate limiting + a recorded decision that probing is acceptable |
| C2 | `authenticated` | ONLY the confirm() naming | signed-out banner stays broken — leaves half the task undone |

### Implementation (C1)
1. Add a **SECURITY DEFINER** RPC returning `{campaign_name, valid}` for a token,
   **revoking EXECUTE from PUBLIC explicitly** (new functions inherit it — see
   `D-GH-2026-08-03-invite-note-dm-only`), then granting to `anon`.
2. Return **only** `campaign_name` + `valid` — never anything else about the
   campaign or its members.
3. Name the campaign in CharGen's accept `confirm()`; remove the now-obsolete
   comment in `tryRedeem()` explaining why it couldn't.
4. Make the signed-out banner distinguish a **dead** invite from a **live** one.
5. Rate-limit the RPC (coordinate with `feat/invite-rate-limiting` — this is a new
   anon-reachable surface that task should cover).
6. Run the Supabase advisor and skim `get_logs` before the PR (it already caught an
   anon-callable function this session).
7. cloud-e2e coverage for a revoked token and a valid one.

### DECISIONS.md stub
```
D-GH-<date>-invite-peek-campaign-name
The invite-token peek RPC is anon-callable (returns only {campaign_name, valid}),
chosen over authenticated-only because only anon scope fixes the signed-out
revoked-vs-live banner as well as the accept-confirm naming. Token existence is
therefore probeable; accepted as a deliberate trade-off, mitigated by rate
limiting (see feat/invite-rate-limiting). EXECUTE revoked from PUBLIC, granted to
anon explicitly.
```

**Done when:** a token resolves to its campaign name without redeeming, its auth
scope is recorded in DECISIONS.md, the confirm names the campaign, the signed-out
banner distinguishes dead from live, the advisor reports no new findings, and
cloud-e2e covers both token states.
