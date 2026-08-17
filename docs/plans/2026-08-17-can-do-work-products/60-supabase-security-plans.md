# Supabase / security infra plans (3 tasks)

Plans + adversarial test lists for the three infra/security tasks. All three have a
**live-only verification step** I can't perform (`get_advisors`, `get_logs`, a live
project's config), so each is written to make that step the explicit gate. Not
committed.

---

## 1. `chore/supabase-keep-alive` — prevent free-tier auto-pause (sweep-eligible)

The PACT Supabase project auto-paused from inactivity (2026-07-25), silently breaking
login/register app-wide with "Failed to fetch" until manually restored. Fix so it
doesn't recur, especially before real users rely on cloud sync/DM campaigns.

**Recommendation: option (a), the scheduled keep-alive ping.** It's CI/ops tooling
(not app backend), costs nothing, and is easily reverted; option (b) is a recurring
bill only you can authorise.

| Option | What | Recommendation |
|---|---|---|
| **(a)** | A scheduled GitHub Actions workflow pinging the project on a cron tighter than the ~7-day auto-pause window (e.g. every 3 days), a lightweight authenticated request using only the already-committed anon key | **Default to this** |
| (b) | Upgrade to a paid tier (removes auto-pause entirely) | Flag to you explicitly — recurring cost, your call |

**Implementation (a):**
1. `.github/workflows/supabase-keepalive.yml`, cron every 3 days, a lightweight
   request via `js/supabase-client.js`'s `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`.
   This is CI/ops, not app backend, so it doesn't conflict with the "GitHub Pages
   only, no custom backend" rule (same class as the existing Lighthouse CI workflow).
2. **Verify it actually prevents pausing** — confirm project status stays
   `ACTIVE_HEALTHY` across a **full off-cadence window** before calling it done.
3. Log the decision (workflow vs paid-tier, and why) as
   `D-GH-<date>-supabase-keep-alive` in DECISIONS.md.

**Live-only gate (yours):** the "stayed ACTIVE_HEALTHY across a full window" check
needs the live project — I can't observe it.

**Done when:** a scheduled keep-alive workflow is running and confirmed to keep the
project `ACTIVE_HEALTHY` across at least one full auto-pause window (or, if you chose
paid-tier, auto-pause confirmed disabled), and the decision is logged.

---

## 2. `feat/invite-rate-limiting` — abuse protection for invite gen/redemption

Split from `fix/harden-invitation-system` (NOW) per its cold-review Decision 4: once
DM invites move to 128-bit tokens, brute-forcing them directly is infeasible, so the
remaining value of rate limiting is **abuse/DoS protection** on the invite
generation and redemption RPCs, not closing the core escalation path. **No
rate-limiting mechanism exists in the schema today — new ground.**

> ⚠ **Blocker status caveat.** The parent `fix/harden-invitation-system` is cited as
> a `(NOW)` task, but `TASK_BOARD_NOW.md` is **empty** and it isn't in any
> completed-work list. This task assumes the 128-bit-token move from that parent —
> if the parent hasn't landed, that assumption doesn't hold yet and this task's
> premise ("brute-forcing is now infeasible") is not yet true. Confirm via
> `CHANGELOG.md`/git first. See `BLOCKER-REGISTER.md`.

**The task's pivot is a live-verification step I can't do, so it's step 1:**
1. **FIRST — verify** whether Supabase's project-level config already throttles
   *arbitrary* RPC/PostgREST calls (not just auth endpoints like signup/login/OTP).
   Check the **live** project's configuration/advisor output — don't assume from
   docs. **This determines the whole rest of the task.**
2. **If platform-level throttling covers the invite RPCs:** this becomes a
   verification + documentation task — confirm coverage, record in DECISIONS.md,
   done.
3. **If not sufficient:** design a minimal attempt-tracking mechanism — a small table
   keyed by **caller + action + time window**, checked at the top of the
   invite-generation and invite-redemption RPCs. **Race-safe under concurrency** —
   match this codebase's atomic-claim discipline (`UPDATE … WHERE … RETURNING`), not
   check-then-act.
4. Cover **both directions**: generation (a DM spamming invite creation) and
   redemption (an attacker hammering redemption to brute-force/enumerate tokens) —
   may need different thresholds.
5. Coordinate with `feat/invite-peek-campaign-name` (C1 above) — its anon-callable
   peek RPC is exactly the kind of new anon surface this task should also cover.

**Adversarial tests:** N rapid requests from one caller are throttled after the
threshold; legitimate well-spaced usage is never blocked. Run `get_advisors` after
any schema/policy change (D-GH15/D-GH12 drift history). Record the
platform-vs-application decision in DECISIONS.md.

**Note the fail-open property:** a rate-limiting gap fails to "no limit" — the
pre-existing status quo, not a new failure mode — which is why this is low-risk once
step 1 is answered.

**Done when:** either platform-level rate limiting is confirmed to cover invite
gen/redemption (documented, no new code), or a race-safe attempt-tracking mechanism
is in place with adversarial tests proving both that abuse is throttled and
legitimate use isn't; the decision is recorded; the advisor reports no new findings.

---

## 3. `security/privilege-and-character-integrity` — the audit (high, cold-review any fix)

Owner request, 2026-08-08. Assume the attacker has the full frontend source, the
Supabase URL, the publishable key, complete control of browser JS/localStorage, and
calls Supabase **directly** — every finding must be verified at the **RLS/RPC
boundary, not the UI.** **Explicitly excludes the invitation system**
(`fix/harden-invitation-system` owns that — don't touch `dm_invite_code`,
`campaign_invites`, or invite RPCs).

**This is the one task most gated on access I don't have** — the deliverable is an
audit of *live* RLS/RPC behaviour. So I give you the **audit checklist + adversarial
test list**, structured so you (or a signed-in agent) execute it; the *plan* is
complete, the *execution* is yours.

### Not green-field — audit before assuming a gap (per AGENTS.md "verify before an absence claim")
- `ap` is **documented** server-authoritative/DM-only — **audit whether it's actually
  *enforced*** in `sql/rls-policies.sql`/RPCs or only true by convention.
- `characters_update` RLS already requires `owner_id = auth.uid()` in both USING and
  WITH CHECK — raw ownership reassignment is already blocked; a *deliberate* transfer
  belongs in `feat/character-ownership-claim-link`, not here.
- DM creation-lock enforcement is its own task (`feat/dm-creation-lock`) — cross-check
  against its "server is the enforcement point" framing, don't re-derive.
- `feat/ap-model-reconcile` covers the *display* divergence; this task covers whether
  a malicious client can *create* that divergence server-side. Related, not
  overlapping.

### The deliverable order
1. **Inventory** every RPC and RLS policy touching `characters`/`campaigns`/
   `ap_awards` (`sql/schema.sql`, `sql/rls-policies.sql`, `sql/migrations/`) and
   classify each security-sensitive operation as **server-enforced** or
   **client-trusted-only**. **This classification IS the audit's deliverable before
   any fix.**
2. For each "client-trusted-only" finding, **confirm by attempting the bypass against
   a live Supabase call shape** — not just reading code.
3. Cross-check every finding against the four related tasks above before writing a
   fix — don't duplicate scoped work.
4. For confirmed gaps, design the **smallest** RLS/RPC change that closes them — no
   new roles, tables, or broader schema than the specific gap requires.
5. Write the adversarial suite (below) covering every confirmed gap plus the
   invariants even where no gap was found.
6. Run `get_advisors` + skim `get_logs` after any change.
7. Run the **full existing suite** plus the new tests; fix regressions before done.
8. **Document every finding — including where the audit confirmed something was
   ALREADY correctly enforced** — in DECISIONS.md, so a future session doesn't
   re-audit the same ground.

### Section-by-section checklist
**1. Role boundaries (Owner/DM/Player) — audit and enforce server-side, add NO new
roles** unless a concrete vuln requires it. Confirm each is an RLS/SECURITY DEFINER
check, not a UI gate: DM transferring campaign ownership; DM accessing another
campaign; player escalating to DM/Owner; membership checks; DM-only operations. **Do
not reduce any legitimate DM capability.**

**2. Character/AP integrity — treat all browser state as untrusted.** Confirm
server-side (RLS/RPC, not `engine.js` — it runs client-side and proves nothing about
a raw API call):
- AP can't be set/increased directly by a player write; AP changes require an
  authorised RPC.
- AP can't go negative or be set arbitrarily via a crafted request.
- Frozen ledger / LOG history can't be rewritten or deleted by an UPDATE once
  persisted.
- Purchase prices can't be client-supplied — pricing must be derivable/verifiable
  from compute(), not trusted as sent.
- A locked/finished character can't be mutated via a direct API call once locked.
- A character can't move between campaigns except through an authorised path.
- LOG events can't be replayed/duplicated to double-grant purchases/rewards/AP.
- Creation-lock rules can't be bypassed by client-constructed state (cross-check
  `feat/dm-creation-lock`).
- Species/heritage/2nd-origin pricing can't be gamed via a hand-crafted LOG.
- A malformed/forged LOG can't produce a cloud character that persists.
- **Preserve the invariant `sum(frozen event costs) == compute().total`** for valid
  finished characters — audit whether the server can currently accept a saved
  character where these disagree, and if so close that specific gap.

**3. Campaign-rule integrity.** Audit whether a DM changing campaign rules (starting
AP, pricing gates, species/heritage rules, creation restrictions) can silently
reprice/invalidate *existing* characters. If retroactive application is intentional,
preserve it and say so; if not, confirm existing history is immune to a later rule
edit.

**4. Cloud/client trust boundary — the general sweep.** For every operation protected
only by client-side logic touching AP, LOG/event data, character locking, campaign
IDs, ownership, DM permissions, or character↔campaign relationships: move real
enforcement to Postgres/RLS/RPCs where missing. Where it already exists, this step is
"confirm it", not "rebuild it".

### Section 5 — adversarial test list
Add/extend the automated security suite proving each:
- no player privilege escalation
- no cross-campaign read/write
- no direct AP manipulation
- no forged purchase prices
- no event replay/duplication
- frozen ledger immutable
- locked characters immutable via API
- campaign reassignment properly authorised
- DM cannot transfer ownership (unless a task explicitly adds that capability)
- malformed event/state payloads rejected
- `compute().total == frozen-ledger total` holds
- **existing legitimate Owner/DM/Player workflows still pass** (run the full suite
  alongside — a regression here is exactly what this task must not cause)

### Governance
The **audit itself** (read-only investigation, no schema change) does **not** need a
cold review. **Any fix that touches RLS/RPCs/schema DOES** — run
`/make-code-cold-plan-review` (it's security-critical, multi-file, with real design
trade-offs). **Not sweep-eligible.**

**Done when:** every item in Sections 1–4 is checked against **live** RLS/RPC
behaviour and is either confirmed already-enforced or has a merged fix; the Section 5
tests pass; `sum(frozen event costs) == compute().total` holds for every path that
can produce a saved cloud character; the advisor reports no new findings;
`engine-parity` unaffected (0 failed); all findings and trust assumptions recorded in
DECISIONS.md; no invitation-system file was touched.
