# PACT — Blocker & dependency register (self-contained)

One page that ties the whole board together: the dependency chains, the
can't-do-yet bucket (folded in here so nothing lives only in chat), and — the
headline finding of this revision — the **empty NOW board** discrepancy.

Australian English. Nothing committed; drafts for the single writer to fold in.

---

## ★ Headline finding — `TASK_BOARD_NOW.md` is empty, but NEXT/LATER cite NOW tasks

The provided `TASK_BOARD_NOW.md` contains **only its header and conventions — zero
open tasks.** Yet the NEXT and LATER boards repeatedly cite three `(NOW)` tasks as
hard prerequisites:

| Cited `(NOW)` task | Cited by | What depends on it |
|---|---|---|
| `fix/buyoff-keyed-by-event` | `feat/dm-edit-events` (NEXT), `chore/engine-review-cleanup` item 1 (LATER) | Boon-removal keyed by name would inherit the re-buy bug; "must land before" dm-edit-events |
| `fix/optimistic-character-save` | `feat/dm-edit-events` concurrency (NEXT), `feat/character-log-merge` (LATER) | The refusal fallback that log-merge builds on |
| `fix/harden-invitation-system` | `feat/invite-rate-limiting` (NEXT), `security/privilege-and-character-integrity` (NEXT) | The 128-bit-token move; owns the invitation surface the security audit excludes |

**None of these three appears** as an open task in NOW **nor** in any board's
"Completed work … graduated to CHANGELOG.md" paragraph. So from the three files
provided, their status is genuinely **indeterminate**. Two possibilities, opposite
consequences:

- **They're DONE** (moved to `CHANGELOG.md` per the board's own rule) → the tasks
  that "depend" on them are **already unblocked**. In particular `feat/dm-edit-events`
  and `feat/character-log-merge` could start now.
- **They're MISSING** (never written into NOW, or the NOW file provided is stale) →
  there's a **board gap**: three referenced prerequisites don't exist as trackable
  work, and anything "blocked on" them is blocked on nothing trackable.

### Your one verification action
For each of the three, run (or have the coding agent run):
```
grep -rn "buyoff-keyed-by-event\|optimistic-character-save\|harden-invitation-system" \
     CHANGELOG.md CHANGELOG-archive-*.md
git branch -a | grep -E "buyoff-keyed-by-event|optimistic-character-save|harden-invitation-system"
```
- **Hit in CHANGELOG** → done; mark the dependents unblocked.
- **Open git branch** → in flight; it's the "in flight" signal per board rule 3.
- **Neither** → it's a genuine gap; write the task into `TASK_BOARD_NOW.md` before
  scheduling anything that depends on it.

*(This is why the affected planning docs in this zip — `02`, `20`, `30`, `60` — now
carry a "Blocker status caveat" banner instead of stating these as settled
prerequisites. That was the main correction in this revision.)*

---

## Dependency chains (what must precede what)

```
fix/buyoff-keyed-by-event (NOW?)
        └─> feat/dm-edit-events (boon-removal half)
                └─> feat/ledger-show-lost-purchases (boon half)

feat/chargen-dm-view  ─(copy approach, build first)─> feat/dm-edit-events

fix/optimistic-character-save (NOW?)
        └─> feat/character-log-merge (LATER)

fix/harden-invitation-system (NOW?)
        ├─> feat/invite-rate-limiting
        └─> (security audit EXCLUDES this surface)

AP-model cluster (settle in this order):
  fix/livesheet-draft-reconcile  (rules lynchpin, owner decision)
        └─> feat/ap-model-reconcile  (settles compute()-vs-frozen ONCE)
                └─> feat/ledger-show-lost-purchases
  fix/history-shows-derived-lines  (display-only; re-measure, slot in anytime)
  feat/randomize-emits-in-order    (must read the RECONCILED ledger → after above)
        └─────────────────────────> fix/ledger-reconciliation-pass  (LAST of all)

feat/character-ownership-claim-link  ─(owns the transfer RPC)─> referenced by security audit
```

**Two "build the enabler first" edges worth calling out:**
- `feat/chargen-dm-view` (copy approach) before `feat/dm-edit-events` — the view is
  the enabler, and the copy approach makes the DM-edit safety far simpler.
- `fix/livesheet-draft-reconcile` before the rest of the AP cluster — it defines what
  "correct" means for a pre-lock ledger, which everything downstream assumes.

---

## The three buckets, complete (nothing left in chat)

### 🟢 Can do — DONE (in the earlier `can do.zip`)
`fix/drawback-ap-double-count` · `feat/dm-edit-events` (decision record) ·
`feat/campaign-ap-budget-enforce` (spec) · `docs/pace-curve-terminology`.

### 🟡 Can do part — DONE here (files 10–60)
All 21 planning artifacts. See `00-INDEX` note below for the file→task map.

### 🔴 Can't do (blocked entirely — folded in here so it's not lost)
| Task | Hard blocker | What unblocks it |
|---|---|---|
| `feat/randomize-tuning` | Acceptance criteria are *deliberately unset* — step 1 is **you** naming what a bad roll looks like | You provide concrete "bad roll" examples; then it becomes plannable/sweep-eligible |
| `fix/ledger-reconciliation-pass` | Needs a **live inventory replay** of every saved character (local + cloud) before any decision | A signed-in session to produce the frozen-vs-compute() table; also sequence LAST, after all 4 pricing branches |
| `fix/password-reset-flow` | Real fix hinges on a **Supabase dashboard allow-list** setting + a **live recovery-email E2E** | Dashboard access + a real recovery email round-trip |
| `docs/port-agents-scaffold-skill` | Needs **read access** to `chompy78/petdetective` and `chompy78/homelife` to generalise from | Repo access to the two worked examples |
| Every task's **live verification step** | `get_advisors`, `get_logs`, signed-in cloud-e2e, live project config | A signed-in Supabase/browser session |

---

## 00-INDEX — file → task map (both zips)

**`can do.zip` (completed artifacts):**
`01` drawback-ap-double-count · `02` dm-edit-events decision · `03`
campaign-ap-budget spec · `04` pace-curve annotation pack.

**This zip (planning artifacts):**
- `10` — decision-blocked: add-player-hierarchy, unnamed-character-default,
  invite-peek-campaign-name.
- `20` — engine cold-plans: engine-review-cleanup, warn-missing-data-refs,
  banned-2nd-origin-class, chargen-context-pricing, REV-14b, character-log-merge.
- `30` — sync/tool: chargen-dm-view, dm-edit-events (code half),
  autosave-flush-latest-push, reconcile-push-inflight-tracking.
- `40` — chargen-rules-label-live (writable VERSION-SYNC section).
- `50` — larger designs: ownership-claim-link, campaign-character-limit,
  dm-creation-lock, livesheet-draft-reconcile, history-shows-derived-lines,
  ap-model-reconcile, ledger-show-lost-purchases, randomize-emits-in-order.
- `60` — Supabase/security: supabase-keep-alive, invite-rate-limiting, security audit.
