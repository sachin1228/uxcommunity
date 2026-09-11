-- Showcase categories: replace the launch taxonomy (UI/UX, Branding, Motion,
-- Product) with the designer-focused set now offered by the composer and the
-- feed filter row.
--
-- This product is still in beta, so legacy categories are deliberately not
-- preserved: any post carrying an old value falls back to 'other' so the new
-- CHECK constraint can be installed without leaving the column unconstrained.

alter table public.community_showcase_posts
  drop constraint if exists community_showcase_posts_category_check;

update public.community_showcase_posts
set category = 'other'
where category not in (
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
);

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
