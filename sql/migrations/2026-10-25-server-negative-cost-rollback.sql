-- PACT — rollback of 2026-10-25-server-negative-cost.sql (D-GH-2026-10-25-server-negative-cost-after-lock).
-- Removes the trigger and both functions. After a rollback the gap is open again: a player-appended negative-cost buy or names
-- event on a campaign character lowers the server's spend (harness cases R2-2 / R2-4).
-- Order: roll this back BEFORE 2026-10-13-campaign-house-rules-server-rollback.sql — the trigger calls pact_num(), which that rollback drops.

drop trigger if exists trg_pact_negative_cost_guard on public.characters;
drop function if exists public.pact_enforce_negative_cost();
drop function if exists public.pact_binding_grant_max();
