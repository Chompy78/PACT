# D-GH-2026-07-13-retire-pactrules-code — Retire the local PACTRULES "#3" code path; cloud rules are the single restriction source

Status: Active

- **Context:** PACT had **three** overlapping "campaign" concepts (see
  `docs/plans/2026-07-12-campaign-rules-snapshot.md`): **#1** DM-authoritative cloud campaign rules
  (`campaigns.rules` + `validate()`/`RULE_BAN_FIELDS`/`cloudRuleBarred()`), **#2** `b.houseRules`
  (engine-read DM customisations / non-core toggle), and **#3** a local "PACTRULES code" — a manual
  text-code (`_campEnc`/`_campDec`, `PACTRULES:` prefix) a DM pasted into CharGen/Live Sheet to bar
  boons/drawbacks/arts, persisted as a `cat:'campaign'` LOG event via `MUT.campaign`→`b.campaign`. The
  restriction MVP (bannedDrawbacks/bannedArts on the cloud rules) shipped in PR #174, making #3 redundant:
  #1 already bars species/2nd-species/origin-classes/masteries/boons **and** now drawbacks/arts, and is
  server-authoritative (a player can't edit it), whereas #3 was a client-trusted, player-editable code with
  no security value once cloud rules exist.
- **Options:** (A1) retire #3 entirely now — remove `MUT.campaign`/`b.campaign`/`cat:'campaign'`, the
  `_campEnc`/`_campDec` codec, the "House rules code / Campaign" UI + `campBarred` enforcement in both
  tools, and the dead `campaign` fixture field. (A2) keep #3 as an offline/no-login fallback. (A3) rename
  #3 to a distinct third name.
- **Decision:** **A1** — full retirement (this change, part (a) of the roadmap task). The LOG rules-snapshot
  + `resolveRules()` resolver for offline carry (part (b)) remains a follow-up.
- **Why:** A trust-boundary argument. #3 was a **client-trusted** restriction: the bans lived in the
  player's own save/LOG and were enforced only by the player's own browser, so they never bound anyone who
  didn't want to be bound — no security value. #1 is **server-authoritative** (RLS-protected
  `campaigns.rules`, read-only to players) and, since PR #174, has strictly broader coverage than #3. Two
  overlapping mechanisms for the same job is a divergence hazard (they already used different vocabularies —
  the `draws`/`drawbacks` alias in `RULE_BAN_FIELDS` existed only to bridge them). Pre-launch, there is no
  real `cat:'campaign'` data to migrate, and the engine's replay is tolerant of a missing mutator
  (`(MUT[e.cat]||(()=>{}))` at engine `_replay`), so any legacy event replays **inert** — `b.campaign` is
  simply never set and is read by nothing (`compute()` never touched it). `b.houseRules` (#2) is a different,
  engine-read feature and is untouched.
- **Why display/validation-only (no `DATA.version` bump):** the only engine change is deleting the
  `MUT.campaign` mutator; `compute()` pricing is unaffected (it never read `b.campaign`), so engine-parity
  stays **20/0** with no `testing/expected/` change. Verified end-to-end in real Chromium via
  `random-manual-e2e.mjs` (2/2: CharGen pickers + advancement + DM Console import all pass with `campBarred`
  gone).
- **Status:** **In force** (part (a)). Part (b) — carry campaign restrictions offline via a LOG
  rules-snapshot + `resolveRules()` — is the remaining half of the roadmap task, still open.
