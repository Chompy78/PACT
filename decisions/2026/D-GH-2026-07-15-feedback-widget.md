# D-GH-2026-07-15-feedback-widget — insert-only feedback table, the first anon-write in the schema

Status: Active

- **Context:** the roadmap asked for an in-app feedback widget on all four player-facing pages (CharGen,
  Live Sheet, DM Console, Player's Guide), saving free-text feedback to Supabase, dashboard-read-only in
  v1. Two non-obvious decisions fell out of it, both surfaced by a cold cross-review of
  `docs/plans/2026-07-15-feedback-widget.md`.
- **Options / Decisions:**
  1. **Anonymous vs. sign-in-required submission.** PACT is "fully usable offline, sign-in optional," so
     requiring an account to give feedback would exclude most users. **Decision: allow anonymous
     submission** — `feedback` becomes the *first* table in the schema to grant the `anon` role a write.
     Made safe by: insert-only (no select/update/delete grant to any client role — the dashboard/service
     role is the only reader); an insert policy that lets a caller tag a row only with their own
     `user_id` or null (`user_id is null or user_id = auth.uid()`), so no one can attribute feedback to
     another user; DB-level `page` enum + message (1–2000) / contact (≤200) length CHECKs; and a
     client-side ~60s cooldown. Crucially, the policy calls only `auth.uid()` (a Supabase built-in
     granted to `anon`), **not** any of the `is_campaign_*`/`shares_campaign` helpers whose `anon`
     EXECUTE was revoked in `rls-policies.sql` — so it doesn't violate the invariant in that file's
     function-lockdown block (which assumed anon held no table grant). Verified on the live project: anon
     insert(null) allowed, anon/auth spoofed-user_id rejected, all constraint boundaries enforced,
     read/update/delete denied to both roles, idempotent re-run clean, `get_advisors` shows no new
     findings. The `REFERENCES/TRIGGER/TRUNCATE` privileges `anon` holds on `feedback` are a Supabase
     project-wide default (identical on `characters`/`campaigns`/`ap_awards`) and unreachable via the
     PostgREST API — not a regression introduced here.
  2. **Widget coupling.** The Player's Guide (~657 KB) has zero existing JS/module/Supabase wiring, unlike
     the three tools. **Decision: make `js/feedback.js` fully self-contained** — it injects its own
     button/form/styles and depends only on the shared Supabase client, with no tie to `engine-ready` or
     `js/ui-helpers.js`. So all four pages integrate identically via one `<script type="module">` tag,
     and the Guide doesn't need to bootstrap any of the tools' module infrastructure.
- **Why:** the anon-write boundary is the real risk, so it's guarded structurally (grants + policy +
  constraints) rather than by convention, and confirmed by direct role-impersonation tests on the live
  DB before shipping. Self-containment keeps the blast radius of the Guide integration to a single tag
  and avoids dragging a large static reference page into the app-shell module graph.
- **Status:** in force. Deferred (out of scope for v1, noted in the plan): real server-side rate limiting,
  an in-app admin read view, and a data-retention policy. Signed-in attribution is opt-out via a "submit
  anonymously" checkbox.
