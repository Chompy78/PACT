# PACT — Testing

## Test harnesses

- **`tests/engine-parity.html`** — regression gate for `js/engine.js`. Run in a browser; expect **5 passed / 0 failed**. See `docs/HOW-TO-WORK.md` for instructions.
- **`campaign-test.html`** — end-to-end harness for `js/campaign.js` and `js/dm.js` (requires Supabase sign-in).
- **`sync-test.html`** — end-to-end harness for `js/sync.js` (requires Supabase sign-in).

Fixtures in `fixtures/`; expected engine output in `expected/`.
