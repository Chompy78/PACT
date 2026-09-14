-- PACT -- add covering indexes for foreign keys the Supabase performance advisor flagged as
-- unindexed. Purely additive: 11 new `create index if not exists` statements, same low-risk
-- pattern as the single basic_mode_set_by index added by 2026-09-06-player-basic-mode-index-
-- setter-fk.sql. No RLS/policy change, no behaviour change -- these are read-path lookups
-- (`character_id -> dm_id/campaign_id`, invite `created_by`/`redeemed_by`, etc.) getting an
-- index in the same direction the tables are already queried by DM Console/Live Sheet.
--
-- Folded into sql/schema.sql in the same change (this is a plain schema/index addition, not a
-- policy -- schema.sql, not rls-policies.sql, is the "current definition" home for it).
--
-- ap_awards / ap_award_edits / gold_awards -- dm_id + campaign_id (DM Console's per-DM and
-- per-campaign roster/history queries filter on these).
create index if not exists idx_ap_awards_dm            on public.ap_awards(dm_id);
create index if not exists idx_ap_awards_campaign       on public.ap_awards(campaign_id);
create index if not exists idx_ap_award_edits_dm        on public.ap_award_edits(dm_id);
create index if not exists idx_ap_award_edits_campaign  on public.ap_award_edits(campaign_id);
create index if not exists idx_gold_awards_dm           on public.gold_awards(dm_id);
create index if not exists idx_gold_awards_campaign     on public.gold_awards(campaign_id);

-- campaign_dms.added_by -- "who added this co-DM" lookups.
create index if not exists idx_campaign_dms_added_by on public.campaign_dms(added_by);

-- campaign_downtime_declarations.declared_by -- "who declared this window" lookups.
create index if not exists idx_downtime_decl_declared_by on public.campaign_downtime_declarations(declared_by);

-- campaign_invites.created_by / redeemed_by -- DM Console's invite manager and the invite-
-- history views filter/join on both directions.
create index if not exists idx_campaign_invites_created_by  on public.campaign_invites(created_by);
create index if not exists idx_campaign_invites_redeemed_by on public.campaign_invites(redeemed_by);

-- feedback.user_id -- "this user's feedback" lookups (no in-app admin view reads it today, but
-- the dashboard/service_role path does, per the table's own "dashboard-only" posture).
create index if not exists idx_feedback_user on public.feedback(user_id);
