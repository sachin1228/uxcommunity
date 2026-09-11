-- Showcase categories: replace the launch taxonomy (UI/UX, Branding, Motion,
-- Product) with the designer-focused set now offered by the composer and the
-- feed filter row.
--
--   1) remap existing posts onto the new values so no row is left behind,
--   2) swap the CHECK constraint so the old values can never come back.
--
-- Mapping (legacy -> new):
--   ui_ux      -> ui_design
--   branding   -> graphic_design
--   motion     -> motion_design
--   product    -> product_design
--   illustration -> illustration (unchanged)
--   other        -> other        (unchanged)

alter table public.community_showcase_posts
  drop constraint if exists community_showcase_posts_category_check;

update public.community_showcase_posts
set category = case category
  when 'ui_ux' then 'ui_design'
  when 'branding' then 'graphic_design'
  when 'motion' then 'motion_design'
  when 'product' then 'product_design'
  else category
end
where category in ('ui_ux', 'branding', 'motion', 'product');

alter table public.community_showcase_posts
  add constraint community_showcase_posts_category_check
  check (category in (
    'product_design',
    'ai_design',
    'ux_research',
    'ui_design',
    'portfolio',
    'case_study',
    'graphic_design',
    'motion_design',
    'illustration',
    '3d_design',
    'other'
  ));
