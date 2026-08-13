-- Keep event save counts and the current user's saved state in sync across clients.
-- This is idempotent so it can be applied safely to databases where the table
-- has already been added to the Supabase Realtime publication.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_saves'
  ) then
    alter publication supabase_realtime add table public.event_saves;
  end if;
end $$;

alter table public.event_saves replica identity full;
