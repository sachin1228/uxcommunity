-- Add "Other" as a catch-all option in companies, cities, and design_sectors.
-- ON CONFLICT DO NOTHING so re-running is safe.

insert into companies (name, is_active)
values ('Other', true)
on conflict (name) do nothing;

insert into cities (name, is_active)
values ('Other', true)
on conflict (name) do nothing;

insert into design_sectors (name, is_active)
values ('Other', true)
on conflict (name) do nothing;
