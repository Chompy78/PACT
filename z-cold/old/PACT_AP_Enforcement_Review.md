# PACT AP-Overspend Enforcement — External Review Summary
## Prepared by: Kimi Chat (2026-08-10)

---

## 1. What Was Reviewed

- Uploaded design document: `PACT — AP-overspend enforcement: looking for simple hardening ideas`
- Public repo: https://github.com/chompy78/PACT
- Live app: https://chompy78.github.io/PACT/
- `js/engine.js` (fetched and read in full — ~930 lines, pure JS, no browser APIs)
- Supabase Edge Functions & Postgres trigger capabilities (web search)

---

## 2. Core Finding

**A determined player who controls their own `characters.stats` row can always lie about frozen costs, because the server has no independent source of truth for what anything should cost or how much AP was earned.** Real server-side integrity requires the server to run `engine.js` itself. Everything else is friction, not prevention — but the right friction is still worth building.

---

## 3. AI-Assisted Attack Vector

A player does not need to manually reverse-engineer the LOG schema. They can:
1. Export their character JSON, paste it into any AI tool, and ask it to modify frozen costs or inject fake award events.
2. Use the AI to write a direct `PATCH` request to the Supabase REST endpoint, bypassing all client-side gates entirely.

**"Getting AI not to do it" is not a viable defense.** AI alignment/refusal training is bypassable (local models, jailbreaks, coding tools). The only defense that matters is server-side enforcement.

---

## 4. Recommendations (Priority Order)

### 4.1 Deploy Append-Only LOG Trigger (HIGHEST PRIORITY)
Prevents history rewriting. A player can append new events but cannot delete or modify existing ones. Raises the bar from "write any LOG you want" to "only append new events."

```sql
CREATE OR REPLACE FUNCTION enforce_pact_log_append_only()
RETURNS TRIGGER AS $$
DECLARE
  old_log JSONB;
  new_log JSONB;
  old_len INT;
  i INT;
BEGIN
  IF NEW.campaign_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    old_log := COALESCE(OLD.stats->'LOG', '[]'::JSONB);
    new_log := COALESCE(NEW.stats->'LOG', '[]'::JSONB);
    old_len := jsonb_array_length(old_log);
    IF jsonb_array_length(new_log) < old_len THEN
      RAISE EXCEPTION 'PACT: LOG cannot shrink';
    END IF;
    FOR i IN 0..old_len - 1 LOOP
      IF (old_log->i) IS DISTINCT FROM (new_log->i) THEN
        RAISE EXCEPTION 'PACT: Cannot modify existing LOG event at index %', i;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pact_log_append_only
  BEFORE INSERT OR UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION enforce_pact_log_append_only();
```

### 4.2 Deploy Frozen-Cost-Sum Budget Trigger (HIGH PRIORITY)
Validates that `sum(frozen costs in LOG) <= spendable AP`. This is a consistency check, not a correctness check — it trusts the client's own numbers — but it catches arithmetic drift and whole-LOG-replacement attacks.

```sql
CREATE OR REPLACE FUNCTION enforce_pact_budget_consistency()
RETURNS TRIGGER AS $$
DECLARE
  ev JSONB;
  total_spent NUMERIC := 0;
  player_ap NUMERIC := 0;
  dm_ap NUMERIC;
  spendable NUMERIC;
  campaign_rec RECORD;
BEGIN
  IF NEW.campaign_id IS NULL THEN RETURN NEW; END IF;
  SELECT ignore_player_ap, rules INTO campaign_rec
  FROM campaigns WHERE id = NEW.campaign_id;
  IF (campaign_rec.rules->>'enforceApBudget')::BOOLEAN = FALSE THEN
    RETURN NEW;
  END IF;
  FOR ev IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.stats->'LOG', '[]'::JSONB)) LOOP
    IF (ev->>'type') IN ('buy', 'buyoff', 'names') THEN
      total_spent := total_spent + COALESCE((ev->>'cost')::NUMERIC, 0);
    ELSIF (ev->>'type') = 'award' THEN
      player_ap := player_ap + COALESCE((ev->>'amount')::NUMERIC, 0);
    END IF;
  END LOOP;
  dm_ap := COALESCE(NEW.ap, OLD.ap, 0);
  IF campaign_rec.ignore_player_ap THEN
    spendable := dm_ap;
  ELSE
    spendable := player_ap + dm_ap;
  END IF;
  IF total_spent > spendable THEN
    RAISE EXCEPTION 'PACT: Over budget by % AP', total_spent - spendable;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pact_budget_consistency
  BEFORE INSERT OR UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION enforce_pact_budget_consistency();
```

**Limitation (be honest):** The trigger trusts the `cost` and `amount` fields written by the client. A malicious client can append `{type:'award', amount:999}` and then buy whatever they want. This narrows the attack surface but does not close it completely.

### 4.3 Cloud INSERT Gate: Require `creationLocked` for Cloud Sync (MEDIUM PRIORITY)
Require that any `characters` row with `campaign_id IS NOT NULL` contains at least one `creationLocked` event. Draft characters stay local-only; cloud sync is for locked, finished characters only. Prevents using the cloud as a scratchpad for iterative cheating.

### 4.4 DM Console Integrity Dashboard (MEDIUM PRIORITY)
Render a per-character table in DM Console showing: Total Spent | Player AP | DM AP | Remaining | Status. Makes tampering visible to the DM during session prep. Social accountability is a valid security layer for a tabletop game.

### 4.5 CharGen Draft-Mode: Post-Mutation Invariant Check (LOW PRIORITY)
Instead of threading hard-caps through four delegation functions (`_cgWirePatchDelegation`, etc.), add a single `_cgCheckBudgetInvariant()` called at the tail of each. It updates a banner and optionally disables "Lock & Finish" when `remaining < 0`. Keep draft advisory — do not hard-block exploration.

### 4.6 Supabase Edge Function Running `engine.js` (DEFERRED)
Technically possible: `engine.js` is pure JS with no browser APIs. An Edge Function could import it and run `rebuildStateFromEvents()` server-side. However, this is custom backend code (violates project spirit), fragile (engine.js may gain browser-isms), and high-maintenance. Keep as a back-pocket option; do not build today.

---

## 5. Ideas Rejected / Confirmed

| Idea | Verdict |
|------|---------|
| Full SQL reimplementation of pricing/compute() | Rejected — violates engine.js-only rule |
| Narrow frozen-cost-sum trigger (Idea B) | Accepted with refinement — see 4.2 above |
| Client-side signing/HMAC (Idea C) | Rejected — no secret exists client-side that the client itself cannot access |
| CharGen draft hard-cap (Idea D) | Rejected — fights exploratory UX; use post-mutation check instead |
| CharGen draft-mode secondary toggle (Idea E) | Deferred — not clearly better than lock-time enforcement |

---

## 6. Bottom Line

- **Cannot prevent determined cheating** without running `engine.js` server-side or adding a server-side secret.
- **Can meaningfully narrow the gap** with ~50 lines of SQL (two triggers) living entirely in Supabase, requiring zero backend code in the repo.
- **The two triggers together** raise the bar from "edit any JSON and save" to "append only, and stay within your own claimed numbers."
- **For a friends-around-a-table game**, this is the right trade-off between security effort and threat model.
