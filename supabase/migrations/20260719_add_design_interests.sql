-- ─── Design Interests master-data table ─────────────────────────────────────
-- Stores interest topics (UI/UX Design, Product Design, etc.)
-- Admin can add/deactivate entries; users pick interests during signup (step 3).

create table if not exists design_interests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_design_interests_active on design_interests (is_active);

create or replace trigger trg_design_interests_updated_at
  before update on design_interests
  for each row execute function set_updated_at();

alter table design_interests enable row level security;

-- ─── User ↔ Interest join table (many-to-many) ───────────────────────────────

create table if not exists user_interests (
  user_id     uuid not null references users (id) on delete cascade,
  interest_id uuid not null references design_interests (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, interest_id)
);

create index if not exists idx_user_interests_user    on user_interests (user_id);
create index if not exists idx_user_interests_interest on user_interests (interest_id);

alter table user_interests enable row level security;

-- ─── Seed default interests ───────────────────────────────────────────────────

insert into design_interests (name) values
  ('UI / UX Design'),
  ('Product Design'),
  ('Graphic Design'),
  ('Illustration'),
  ('Visual Design'),
  ('Motion Design'),
  ('Brand Identity'),
  ('Typography'),
  ('Design Systems'),
  ('User Research'),
  ('Interaction Design'),
  ('Accessibility'),
  ('Design Leadership'),
  ('Design Strategy'),
  ('Industrial Design'),
  ('Web Design'),
  ('Game Design'),
  ('Photography'),
  ('3D Design'),
  ('Other')
on conflict (name) do nothing;
