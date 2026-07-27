-- ============================================================
-- Community rules
--
-- Ordered list of rules per community, managed by admins and
-- displayed in the community sidebar in real time.
-- ============================================================

create table if not exists community_rules (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references communities (id) on delete cascade,
  rule_text      text not null check (char_length(trim(rule_text)) between 1 and 500),
  order_index    integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_community_rules_community_order
  on community_rules (community_id, order_index asc);

alter table community_rules enable row level security;

create policy "public_read" on community_rules
  for select using (true);

-- Enable realtime so sidebar updates without a page refresh
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_rules'
  ) then
    alter publication supabase_realtime add table community_rules;
  end if;
end $$;

alter table community_rules replica identity full;

-- ── Seed default rules for all existing communities ──────────────────────────
insert into community_rules (community_id, rule_text, order_index)
select
  c.id,
  rule,
  idx
from communities c
cross join (
  values
    (0, 'Be respectful and kind to all members.'),
    (1, 'Keep discussions relevant to design and the community topic.'),
    (2, 'No spam, self-promotion, or unsolicited advertising.'),
    (3, 'Share constructive feedback — critique the work, not the person.'),
    (4, 'Give credit when sharing others'' work.')
) as defaults(idx, rule)
where c.is_active = true
on conflict do nothing;
