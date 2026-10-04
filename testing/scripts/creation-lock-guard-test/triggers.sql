
create trigger trg_characters_snapshot before delete or update on public.characters for each row execute function public.snapshot_character();
create trigger trg_characters_updated_at before update on public.characters for each row execute function public.set_updated_at();
create trigger trg_pact_campaign_move_clears_creation before update on public.characters for each row execute function public.pact_campaign_move_clears_creation();
create trigger trg_pact_locked_history before update on public.characters for each row execute function public.pact_enforce_locked_history();
