alter table public.showcase_comments
  add column if not exists parent_id uuid references public.showcase_comments(id) on delete cascade,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists showcase_comments_parent_idx
  on public.showcase_comments (parent_id)
  where parent_id is not null;

-- Keep comment edits consistent with the existing thread comment model.
drop trigger if exists set_showcase_comments_updated_at on public.showcase_comments;
create trigger set_showcase_comments_updated_at
  before update on public.showcase_comments
  for each row execute function public.set_updated_at();
