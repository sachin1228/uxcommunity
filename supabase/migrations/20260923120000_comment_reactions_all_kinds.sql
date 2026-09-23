-- Emoji reactions on showcase, resource and event comments.
--
-- Thread comments got their own `thread_comment_reactions` table first, and its
-- migration noted the plan for the other surfaces: "other comment sections can
-- adopt the same pattern later by adding their own FK column + indexes". This is
-- that follow-up — one sibling table per comment table, same shape, so the
-- reaction keeps a real foreign key (deleting a comment removes its reactions)
-- instead of a polymorphic comment_id with no integrity.
--
-- The web API writes through the authenticated Next.js routes; RLS keeps direct
-- client access read-only, matching the thread table.

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('showcase_comment_reactions', 'showcase_comments'),
      ('resource_comment_reactions', 'resource_comments'),
      ('event_comment_reactions',    'event_comments')
    ) as tables (reactions_table, comments_table)
  loop
    execute format($f$
      create table if not exists public.%1$I (
        id uuid primary key default gen_random_uuid(),
        comment_id uuid not null references public.%2$I(id) on delete cascade,
        user_id uuid not null references public.users(id) on delete cascade,
        emoji text not null check (emoji in ('👍', '❤️', '🎉', '💡', '👏')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint %1$s_unique unique (comment_id, user_id, emoji)
      );

      create index if not exists %1$s_lookup on public.%1$I (comment_id);

      alter table public.%1$I enable row level security;

      drop policy if exists %1$s_read on public.%1$I;
      create policy %1$s_read on public.%1$I for select using (true);

      drop policy if exists %1$s_insert_own on public.%1$I;
      create policy %1$s_insert_own on public.%1$I for insert with check (auth.uid() = user_id);

      drop policy if exists %1$s_delete_own on public.%1$I;
      create policy %1$s_delete_own on public.%1$I for delete using (auth.uid() = user_id);

      drop trigger if exists set_%1$s_updated_at on public.%1$I;
      create trigger set_%1$s_updated_at
        before update on public.%1$I
        for each row execute function public.set_updated_at();
    $f$, target.reactions_table, target.comments_table);
  end loop;
end $$;
