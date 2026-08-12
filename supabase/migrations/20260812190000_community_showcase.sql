-- Community Showcase feed, engagement, and comments.
create table if not exists public.community_showcase_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  post_type text not null check (post_type in ('finished','wip','case_study','feedback')),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1200),
  image_url text not null check (char_length(image_url) <= 2048),
  project_url text check (project_url is null or char_length(project_url) <= 2048),
  category text not null check (category in ('ui_ux','branding','illustration','motion','product','other')),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.showcase_likes (
  post_id uuid not null references public.community_showcase_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.showcase_saves (
  post_id uuid not null references public.community_showcase_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.showcase_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_showcase_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists showcase_posts_community_created_idx on public.community_showcase_posts (community_id, created_at desc);
create index if not exists showcase_posts_community_category_idx on public.community_showcase_posts (community_id, category, created_at desc);
create index if not exists showcase_likes_post_idx on public.showcase_likes (post_id);
create index if not exists showcase_saves_post_idx on public.showcase_saves (post_id);
create index if not exists showcase_comments_post_created_idx on public.showcase_comments (post_id, created_at);

alter table public.community_showcase_posts enable row level security;
alter table public.showcase_likes enable row level security;
alter table public.showcase_saves enable row level security;
alter table public.showcase_comments enable row level security;

-- Runtime access is intentionally routed through authenticated Next.js service routes.
-- No anon/authenticated table policies are added, preventing direct Data API writes.

do $$ begin
  alter publication supabase_realtime add table public.community_showcase_posts;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.showcase_likes;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.showcase_saves;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.showcase_comments;
exception when duplicate_object then null; end $$;

alter table public.community_showcase_posts replica identity full;
alter table public.showcase_likes replica identity full;
alter table public.showcase_saves replica identity full;
alter table public.showcase_comments replica identity full;
