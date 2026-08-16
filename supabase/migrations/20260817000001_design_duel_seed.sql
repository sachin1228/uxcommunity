-- ============================================================
-- Design Duel — seed data.
--
-- 8 challenges, 16 test designers (all can log in with
-- `Designer@123`), 22 submissions, 6 resolved duels (with feed
-- posts + votes) and 2 open duels so the voting flow can be
-- tried immediately.
-- ============================================================

-- Small helper used to build seed design variants from a
-- challenge's starting_design by setting one component field.
create or replace function public._design_set_comp(
  p_design jsonb,
  p_id text,
  p_field text,
  p_value jsonb
) returns jsonb
language sql
immutable
as $$
  select jsonb_set(
    p_design,
    array['components', (t.ord - 1)::text, p_field],
    p_value,
    true
  )
  from jsonb_array_elements(p_design -> 'components') with ordinality as t(comp, ord)
  where t.comp ->> 'id' = p_id
  limit 1
$$;

do $$
declare
  -- challenges
  v_chal_checkout uuid; v_chal_banking uuid; v_chal_onboarding uuid;
  v_chal_profile uuid; v_chal_food uuid; v_chal_saas uuid;
  v_chal_job uuid; v_chal_travel uuid;

  -- designers
  v_u1 uuid; v_u2 uuid; v_u3 uuid; v_u4 uuid; v_u5 uuid;
  v_u6 uuid; v_u7 uuid; v_u8 uuid; v_u9 uuid; v_u10 uuid;
  v_u11 uuid; v_u12 uuid; v_u13 uuid; v_u14 uuid; v_u15 uuid; v_u16 uuid;

  -- submissions
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid;
  v_s5 uuid; v_s6 uuid; v_s7 uuid; v_s8 uuid;
  v_s9 uuid; v_s10 uuid; v_s11 uuid; v_s12 uuid;
  v_s13 uuid; v_s14 uuid; v_s15 uuid; v_s16 uuid;
  v_s17 uuid; v_s18 uuid; v_s19 uuid; v_s20 uuid;
  v_s21 uuid; v_s22 uuid;

  v_duel uuid;
  v_design jsonb;
begin

-- ═══ Challenges ════════════════════════════════════════════

insert into public.design_duel_challenges
  (slug, title, description, goal, difficulty, time_limit_seconds, starting_design, constraints, status, min_votes, duel_duration_minutes, featured, expires_at)
values
  ('checkout-001', 'Fix this checkout screen', 'A food-delivery checkout that drops 41% of users at the payment step.', 'Make the checkout experience easier and faster to understand.', 'medium', 300,
   '{"frame":{"width":375,"height":812},"components":[
    {"id":"status","type":"text","x":24,"y":64,"width":160,"height":40,"text":"Checkout","fontSize":24,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"sub","type":"text","x":24,"y":104,"width":327,"height":22,"text":"Delivery in 25-30 min","fontSize":14,"fontWeight":400,"color":"#666666","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"card-items","type":"card","x":24,"y":150,"width":327,"height":180,"text":"2x Chicken Biryani   ₹249\n1x Mango Lassi      ₹99","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":16,"padding":16,"align":"left","opacity":1},
    {"id":"input-addr","type":"input","x":24,"y":352,"width":327,"height":56,"text":"Enter delivery address","fontSize":15,"fontWeight":400,"color":"#999999","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"label-pay","type":"text","x":24,"y":432,"width":160,"height":24,"text":"Payment","fontSize":16,"fontWeight":600,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"card-pay","type":"card","x":24,"y":464,"width":327,"height":100,"text":"UPI · **** 4521\nDelivery fee    ₹40","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":16,"padding":16,"align":"left","opacity":1},
    {"id":"btn-pay","type":"button","x":24,"y":700,"width":327,"height":56,"text":"Pay Now","fontSize":16,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1}
   ]}'::jsonb,
   '["Do not remove the primary CTA","Keep all required information","Use the existing component set"]'::jsonb,
   'active', 5, 60, true, now() + interval '7 days')
, ('banking-001', 'Fix this banking dashboard', 'A banking app dashboard that buries the most important actions.', 'Make balance and key actions instantly scannable.', 'medium', 300,
   '{"frame":{"width":375,"height":812},"components":[
    {"id":"title","type":"text","x":24,"y":64,"width":240,"height":32,"text":"Good morning, Rahul","fontSize":22,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"card-bal","type":"card","x":24,"y":120,"width":327,"height":150,"text":"Total balance\n₹1,84,520","fontSize":20,"fontWeight":700,"color":"#ffffff","background":"#0A0A0A","radius":20,"padding":20,"align":"left","opacity":1},
    {"id":"btn-send","type":"button","x":24,"y":294,"width":156,"height":48,"text":"Send","fontSize":15,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"btn-request","type":"button","x":195,"y":294,"width":156,"height":48,"text":"Request","fontSize":15,"fontWeight":600,"color":"#111111","background":"#F5F5F5","radius":12,"padding":0,"align":"center","opacity":1},
    {"id":"label-recent","type":"text","x":24,"y":372,"width":200,"height":24,"text":"Recent activity","fontSize":16,"fontWeight":600,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"row1","type":"card","x":24,"y":404,"width":327,"height":72,"text":"Sent to Ankit   ₹2,000","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1},
    {"id":"row2","type":"card","x":24,"y":488,"width":327,"height":72,"text":"Received from Priya   ₹5,400","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1},
    {"id":"row3","type":"card","x":24,"y":572,"width":327,"height":72,"text":"Bill payment   ₹820","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1}
   ]}'::jsonb,
   '["Keep the balance visible","Do not remove the send / request actions","Use the existing component set"]'::jsonb,
   'active', 5, 60, false, now() + interval '7 days')
, ('onboarding-001', 'Fix this onboarding screen', 'First-run onboarding that loses new members before they finish.', 'Make the value proposition clear and the path forward obvious.', 'easy', 300,
   '{"frame":{"width":375,"height":812},"components":[
    {"id":"eyebrow","type":"text","x":24,"y":220,"width":327,"height":20,"text":"WELCOME TO THE COMMUNITY","fontSize":13,"fontWeight":600,"color":"#0070F3","background":null,"radius":0,"padding":0,"align":"center","opacity":1},
    {"id":"card-hero","type":"card","x":24,"y":260,"width":327,"height":240,"text":"","fontSize":14,"fontWeight":400,"color":"#111111","background":"#EAF2FE","radius":24,"padding":0,"align":"left","opacity":1},
    {"id":"title","type":"text","x":24,"y":528,"width":327,"height":64,"text":"Design your career","fontSize":26,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"center","opacity":1},
    {"id":"desc","type":"text","x":40,"y":600,"width":295,"height":60,"text":"Connect with designers, share your work, and grow together.","fontSize":15,"fontWeight":400,"color":"#666666","background":null,"radius":0,"padding":0,"align":"center","opacity":1},
    {"id":"btn-primary","type":"button","x":24,"y":690,"width":327,"height":56,"text":"Get Started","fontSize":16,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":14,"padding":0,"align":"center","opacity":1},
    {"id":"btn-secondary","type":"button","x":24,"y":758,"width":327,"height":48,"text":"I already have an account","fontSize":15,"fontWeight":500,"color":"#111111","background":"#F5F5F5","radius":14,"padding":0,"align":"center","opacity":1}
   ]}'::jsonb,
   '["Do not remove the primary CTA","Use the existing component set"]'::jsonb,
   'active', 5, 120, false, now() + interval '7 days')
, ('profile-001', 'Fix this profile / settings screen', 'A settings screen where profile info feels disconnected.', 'Make editing a profile feel simple and organized.', 'easy', 300,
   '{"frame":{"width":375,"height":812},"components":[
    {"id":"header","type":"text","x":24,"y":64,"width":200,"height":40,"text":"Settings","fontSize":24,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"avatar-card","type":"card","x":24,"y":120,"width":327,"height":100,"text":"Rahul Sharma\nProduct Designer","fontSize":16,"fontWeight":600,"color":"#111111","background":"#FFFFFF","radius":16,"padding":20,"align":"left","opacity":1},
    {"id":"input-name","type":"input","x":24,"y":244,"width":327,"height":56,"text":"Full name","fontSize":15,"fontWeight":400,"color":"#111111","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"input-email","type":"input","x":24,"y":312,"width":327,"height":56,"text":"Email address","fontSize":15,"fontWeight":400,"color":"#111111","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"label-notif","type":"text","x":24,"y":400,"width":200,"height":24,"text":"Notifications","fontSize":16,"fontWeight":600,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"toggle-card","type":"card","x":24,"y":432,"width":327,"height":72,"text":"Daily design tips","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1},
    {"id":"btn-save","type":"button","x":24,"y":700,"width":327,"height":56,"text":"Save Changes","fontSize":16,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1}
   ]}'::jsonb,
   '["Do not remove the save action","Use the existing component set"]'::jsonb,
   'active', 5, 60, false, now() + interval '7 days')
, ('food-order-001', 'Fix this order status screen', 'Users keep calling support because they cannot tell if their order is coming.', 'Make order status and next steps unmistakable.', 'medium', 300,
   '{"frame":{"width":375,"height":812},"components":[
    {"id":"header","type":"text","x":24,"y":64,"width":240,"height":40,"text":"Order #2481","fontSize":24,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"card-status","type":"card","x":24,"y":130,"width":327,"height":120,"text":"Preparing your order","fontSize":17,"fontWeight":600,"color":"#111111","background":"#FFF4E5","radius":16,"padding":16,"align":"left","opacity":1},
    {"id":"items","type":"card","x":24,"y":274,"width":327,"height":150,"text":"2x Paneer Tikka   ₹449\n1x Butter Naan   ₹59","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":16,"padding":16,"align":"left","opacity":1},
    {"id":"label-total","type":"text","x":24,"y":448,"width":200,"height":24,"text":"Total","fontSize":16,"fontWeight":600,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"total","type":"text","x":24,"y":480,"width":160,"height":40,"text":"₹598","fontSize":28,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"btn-track","type":"button","x":24,"y":700,"width":327,"height":56,"text":"Track order","fontSize":16,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1}
   ]}'::jsonb,
   '["Do not remove the track action","Keep the order items visible","Use the existing component set"]'::jsonb,
   'active', 5, 60, false, now() + interval '7 days')
, ('saas-001', 'Fix this SaaS dashboard', 'A dense analytics dashboard with no visual hierarchy.', 'Make the most important metric stand out immediately.', 'hard', 300,
   '{"frame":{"width":375,"height":812},"components":[
    {"id":"sidebar","type":"card","x":0,"y":0,"width":76,"height":812,"text":"","fontSize":14,"fontWeight":400,"color":"#111111","background":"#0A0A0A","radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"title","type":"text","x":100,"y":64,"width":200,"height":32,"text":"Overview","fontSize":22,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"kpi1","type":"card","x":100,"y":120,"width":251,"height":96,"text":"Active users\n12,480","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1},
    {"id":"kpi2","type":"card","x":100,"y":228,"width":251,"height":96,"text":"Conversion\n3.2%","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1},
    {"id":"kpi3","type":"card","x":100,"y":336,"width":251,"height":96,"text":"Revenue\n₹4.2L","fontSize":15,"fontWeight":500,"color":"#111111","background":"#FFFFFF","radius":14,"padding":16,"align":"left","opacity":1},
    {"id":"btn-new","type":"button","x":100,"y":700,"width":251,"height":56,"text":"New report","fontSize":16,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1}
   ]}'::jsonb,
   '["Keep the sidebar","Use the existing component set","Only 3 metric cards"]'::jsonb,
   'active', 5, 60, false, now() + interval '7 days')
, ('job-001', 'Fix this job application screen', 'A job form that feels endless and gets abandoned.', 'Make applying feel quick and human.', 'easy', 300,
   '{"frame":{"width":375,"height":812},"components":[
    {"id":"header","type":"text","x":24,"y":64,"width":320,"height":40,"text":"Apply · Product Designer","fontSize":22,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"input-name","type":"input","x":24,"y":140,"width":327,"height":56,"text":"Full name","fontSize":15,"fontWeight":400,"color":"#111111","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"input-email","type":"input","x":24,"y":208,"width":327,"height":56,"text":"Email address","fontSize":15,"fontWeight":400,"color":"#111111","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"input-portfolio","type":"input","x":24,"y":276,"width":327,"height":56,"text":"Portfolio link","fontSize":15,"fontWeight":400,"color":"#111111","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"textarea","type":"card","x":24,"y":344,"width":327,"height":140,"text":"Tell us why you are a great fit","fontSize":15,"fontWeight":400,"color":"#999999","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"btn-submit","type":"button","x":24,"y":700,"width":327,"height":56,"text":"Submit application","fontSize":16,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1}
   ]}'::jsonb,
   '["Do not remove required fields","Do not remove the submit button","Use the existing component set"]'::jsonb,
   'active', 5, 60, false, now() + interval '7 days')
, ('travel-001', 'Fix this travel booking screen', 'A booking screen where the starting point is unclear.', 'Make destination + dates feel obvious and trustworthy.', 'medium', 300,
   '{"frame":{"width":375,"height":812},"components":[
    {"id":"header","type":"text","x":24,"y":64,"width":280,"height":40,"text":"Book your trip","fontSize":24,"fontWeight":700,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"card-dest","type":"card","x":24,"y":120,"width":327,"height":160,"text":"Goa · 3 nights","fontSize":18,"fontWeight":600,"color":"#111111","background":"#E8F6EF","radius":16,"padding":16,"align":"left","opacity":1},
    {"id":"input-from","type":"input","x":24,"y":304,"width":327,"height":56,"text":"From · Mumbai","fontSize":15,"fontWeight":400,"color":"#111111","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"input-to","type":"input","x":24,"y":372,"width":327,"height":56,"text":"To · Goa","fontSize":15,"fontWeight":400,"color":"#111111","background":"#F5F5F5","radius":12,"padding":16,"align":"left","opacity":1},
    {"id":"label-date","type":"text","x":24,"y":452,"width":200,"height":24,"text":"Dates","fontSize":16,"fontWeight":600,"color":"#111111","background":null,"radius":0,"padding":0,"align":"left","opacity":1},
    {"id":"btn-search","type":"button","x":24,"y":700,"width":327,"height":56,"text":"Search flights","fontSize":16,"fontWeight":600,"color":"#ffffff","background":"#0070F3","radius":12,"padding":0,"align":"center","opacity":1}
   ]}'::jsonb,
   '["Do not remove the search action","Keep destination and dates visible","Use the existing component set"]'::jsonb,
   'active', 5, 60, false, now() + interval '7 days');

select id into v_chal_checkout from public.design_duel_challenges where slug = 'checkout-001';
select id into v_chal_banking from public.design_duel_challenges where slug = 'banking-001';
select id into v_chal_onboarding from public.design_duel_challenges where slug = 'onboarding-001';
select id into v_chal_profile from public.design_duel_challenges where slug = 'profile-001';
select id into v_chal_food from public.design_duel_challenges where slug = 'food-order-001';
select id into v_chal_saas from public.design_duel_challenges where slug = 'saas-001';
select id into v_chal_job from public.design_duel_challenges where slug = 'job-001';
select id into v_chal_travel from public.design_duel_challenges where slug = 'travel-001';

-- ═══ Test designers ════════════════════════════════════════

insert into public.users (id, application_id, name, email, password_hash, is_blocked)
values
  ('00000000-0000-4000-8000-000000000001', null, 'Rahul Sharma', 'rahul@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000002', null, 'Priya Nair', 'priya@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000003', null, 'Sachin Verma', 'sachin@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000004', null, 'Ankit Jain', 'ankit@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000005', null, 'Neha Kulkarni', 'neha@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000006', null, 'Arjun Mehta', 'arjun@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000007', null, 'Meera Pillai', 'meera@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000008', null, 'Vikram Rao', 'vikram@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000009', null, 'Tanvi Joshi', 'tanvi@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000010', null, 'Kabir Khan', 'kabir@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000011', null, 'Riya Malhotra', 'riya@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000012', null, 'Dev Patel', 'dev@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000013', null, 'Ishaan Gupta', 'ishaan@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000014', null, 'Sana Sheikh', 'sana@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000015', null, 'Aditya Bose', 'aditya@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false),
  ('00000000-0000-4000-8000-000000000016', null, 'Navya Reddy', 'navya@uxcommunity.in', '$2a$10$ul2rBq1XS6JBzk1wVtYj5Ot4bm075IdmIE04TNt6hQUJtaX97lpiu', false)
on conflict (id) do nothing;

insert into public.designer_profiles (user_id, experience_level)
select id, 'mid_level' from public.users
where email like '%@uxcommunity.in'
on conflict (user_id) do nothing;

-- Login requires a non-null avatar_url on the profile (see /api/auth/login),
-- so give every seeded designer a deterministic boring:// avatar.
update public.designer_profiles dp
set avatar_url = 'boring://beam/' || replace(u.name, ' ', '%20')
from public.users u
where dp.user_id = u.id
  and u.email like '%@uxcommunity.in'
  and dp.avatar_url is null;

-- ═══ Ratings & stats ═══════════════════════════════════════

insert into public.user_design_ratings (user_id, rating, wins, losses, draws, duels_played, win_streak, best_streak, last_duel_at) values
  ('00000000-0000-4000-8000-000000000001', 2481, 22,  9, 1, 32, 6, 8, now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000002', 2302, 19,  8, 0, 27, 4, 7, now() - interval '5 hours'),
  ('00000000-0000-4000-8000-000000000003', 2184, 17,  9, 2, 28, 3, 6, now() - interval '9 hours'),
  ('00000000-0000-4000-8000-000000000004', 1990, 14,  8, 1, 23, 2, 5, now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000005', 1842, 12,  7, 0, 19, 1, 4, now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000006', 1755, 11,  7, 1, 19, 0, 3, now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000007', 1688, 10,  8, 0, 18, 0, 3, now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000008', 1599,  9,  8, 1, 18, 0, 2, now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000009', 1521,  8,  7, 0, 15, 0, 2, now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000010', 1475,  6,  7, 0, 13, 0, 1, now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000011', 1410,  5,  6, 1, 12, 0, 1, now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000012', 1350,  4,  6, 0, 10, 0, 1, now() - interval '5 days')
on conflict (user_id) do nothing;

insert into public.user_game_stats (user_id, xp, challenges_completed, duels_played, votes_cast) values
  ('00000000-0000-4000-8000-000000000001', 1240, 18, 32, 64),
  ('00000000-0000-4000-8000-000000000002', 1090, 16, 27, 58),
  ('00000000-0000-4000-8000-000000000003',  980, 15, 28, 52),
  ('00000000-0000-4000-8000-000000000004',  860, 13, 23, 47),
  ('00000000-0000-4000-8000-000000000005',  740, 12, 19, 41),
  ('00000000-0000-4000-8000-000000000006',  690, 11, 19, 38),
  ('00000000-0000-4000-8000-000000000007',  630, 10, 18, 35),
  ('00000000-0000-4000-8000-000000000008',  560,  9, 18, 31),
  ('00000000-0000-4000-8000-000000000009',  500,  8, 15, 27),
  ('00000000-0000-4000-8000-000000000010',  420,  7, 13, 24),
  ('00000000-0000-4000-8000-000000000011',  380,  6, 12, 21),
  ('00000000-0000-4000-8000-000000000012',  310,  5, 10, 18)
on conflict (user_id) do nothing;

-- ═══ Submissions ═══════════════════════════════════════════

-- checkout — 4 submissions (2 resolved duels)
v_design := public._design_set_comp(
  public._design_set_comp(
    public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_checkout), 'btn-pay', 'text', '"Pay Securely"'::jsonb),
    'btn-pay', 'background', '"#16a34a"'::jsonb),
  'btn-pay', 'y', '680'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_checkout, '00000000-0000-4000-8000-000000000001', 'submitted', v_design, now() - interval '6 min', now() - interval '4 min', 120, false) returning id into v_s1;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_checkout), 'btn-pay', 'background', '"#111111"'::jsonb),
  'input-addr', 'text', '"Add delivery address"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_checkout, '00000000-0000-4000-8000-000000000002', 'submitted', v_design, now() - interval '5 min', now() - interval '3 min', 150, false) returning id into v_s2;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_checkout), 'btn-pay', 'text', '"Place Order"'::jsonb),
  'btn-pay', 'y', '660'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_checkout, '00000000-0000-4000-8000-000000000003', 'submitted', v_design, now() - interval '6 min', now() - interval '2 min', 240, false) returning id into v_s3;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_checkout), 'btn-pay', 'background', '"#E63946"'::jsonb),
  'sub', 'text', '"Free delivery · 25 min"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_checkout, '00000000-0000-4000-8000-000000000004', 'submitted', v_design, now() - interval '7 min', now() - interval '5 min', 180, false) returning id into v_s4;

-- banking — 4 submissions (2 resolved duels)
v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_banking), 'card-bal', 'background', '"#0070F3"'::jsonb),
  'btn-send', 'background', '"#0A0A0A"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_banking, '00000000-0000-4000-8000-000000000002', 'submitted', v_design, now() - interval '8 min', now() - interval '5 min', 180, false) returning id into v_s5;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_banking), 'title', 'text', '"Good morning, Neha"'::jsonb),
  'btn-request', 'background', '"#FFFFFF"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_banking, '00000000-0000-4000-8000-000000000005', 'submitted', v_design, now() - interval '6 min', now() - interval '3 min', 200, false) returning id into v_s6;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_banking), 'card-bal', 'background', '"#0F172A"'::jsonb),
  'row1', 'text', '"Sent to Ankit   ₹2,000 · Pending"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_banking, '00000000-0000-4000-8000-000000000006', 'submitted', v_design, now() - interval '9 min', now() - interval '6 min', 210, false) returning id into v_s7;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_banking), 'btn-send', 'text', '"Transfer"'::jsonb),
  'btn-request', 'text', '"Add money"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_banking, '00000000-0000-4000-8000-000000000007', 'submitted', v_design, now() - interval '7 min', now() - interval '4 min', 190, false) returning id into v_s8;

-- food-order — 2 submissions (1 resolved duel)
v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_food), 'btn-track', 'text', '"Live tracking"'::jsonb),
  'btn-track', 'background', '"#16a34a"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_food, '00000000-0000-4000-8000-000000000008', 'submitted', v_design, now() - interval '10 min', now() - interval '8 min', 160, false) returning id into v_s9;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_food), 'card-status', 'text', '"Out for delivery · 12 min"'::jsonb),
  'card-status', 'background', '"#E8F6EF"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_food, '00000000-0000-4000-8000-000000000009', 'submitted', v_design, now() - interval '9 min', now() - interval '6 min', 200, false) returning id into v_s10;

-- saas — 2 submissions (1 resolved duel)
v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_saas), 'kpi1', 'text', '"Active users\n13,002"'::jsonb),
  'btn-new', 'text', '"Export report"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_saas, '00000000-0000-4000-8000-000000000001', 'submitted', v_design, now() - interval '11 min', now() - interval '7 min', 260, false) returning id into v_s11;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_saas), 'sidebar', 'background', '"#111111"'::jsonb),
  'kpi2', 'text', '"Conversion\n3.8%"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_saas, '00000000-0000-4000-8000-000000000005', 'submitted', v_design, now() - interval '12 min', now() - interval '8 min', 240, false) returning id into v_s12;

-- onboarding — 3 submissions (1 open duel + 1 unmatched)
v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_onboarding), 'btn-primary', 'text', '"Create my profile"'::jsonb),
  'title', 'text', '"Design your future"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_onboarding, '00000000-0000-4000-8000-000000000003', 'submitted', v_design, now() - interval '5 min', now() - interval '3 min', 140, false) returning id into v_s13;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_onboarding), 'btn-secondary', 'text', '"Log in instead"'::jsonb),
  'eyebrow', 'text', '"JOIN 1,200+ DESIGNERS"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_onboarding, '00000000-0000-4000-8000-000000000008', 'submitted', v_design, now() - interval '6 min', now() - interval '4 min', 130, false) returning id into v_s14;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_onboarding), 'btn-primary', 'background', '"#111111"'::jsonb),
  'card-hero', 'background', '"#F6F2FF"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_onboarding, '00000000-0000-4000-8000-000000000015', 'submitted', v_design, now() - interval '4 min', now() - interval '2 min', 120, false) returning id into v_s15;

-- profile — 3 submissions (1 open duel + 1 unmatched)
v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_profile), 'btn-save', 'text', '"Save"'::jsonb),
  'toggle-card', 'text', '"Daily design tips · On"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_profile, '00000000-0000-4000-8000-000000000004', 'submitted', v_design, now() - interval '5 min', now() - interval '3 min', 110, false) returning id into v_s16;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_profile), 'header', 'text', '"Profile"'::jsonb),
  'avatar-card', 'text', '"Ankit Jain\nProduct Designer"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_profile, '00000000-0000-4000-8000-000000000010', 'submitted', v_design, now() - interval '6 min', now() - interval '4 min', 125, false) returning id into v_s17;

v_design := public._design_set_comp(
  (select starting_design from public.design_duel_challenges where id = v_chal_profile), 'btn-save', 'background', '"#16a34a"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_profile, '00000000-0000-4000-8000-000000000016', 'submitted', v_design, now() - interval '7 min', now() - interval '5 min', 100, false) returning id into v_s18;

-- job — 2 unmatched submissions
v_design := public._design_set_comp(
  (select starting_design from public.design_duel_challenges where id = v_chal_job), 'btn-submit', 'text', '"Send Application"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_job, '00000000-0000-4000-8000-000000000011', 'submitted', v_design, now() - interval '6 min', now() - interval '4 min', 150, false) returning id into v_s19;

v_design := public._design_set_comp(
  (select starting_design from public.design_duel_challenges where id = v_chal_job), 'input-portfolio', 'text', '"Portfolio / Behance link"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_job, '00000000-0000-4000-8000-000000000012', 'submitted', v_design, now() - interval '7 min', now() - interval '5 min', 140, false) returning id into v_s20;

-- travel — 2 unmatched submissions
v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_travel), 'btn-search', 'text', '"Find flights"'::jsonb),
  'card-dest', 'text', '"Goa · 3 nights · ₹14,200"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_travel, '00000000-0000-4000-8000-000000000013', 'submitted', v_design, now() - interval '5 min', now() - interval '3 min', 130, false) returning id into v_s21;

v_design := public._design_set_comp(
  public._design_set_comp((select starting_design from public.design_duel_challenges where id = v_chal_travel), 'header', 'text', '"Plan a trip"'::jsonb),
  'input-from', 'text', '"From · Delhi"'::jsonb);
insert into public.design_duel_submissions (challenge_id, user_id, status, design_json, started_at, submitted_at, completion_time, is_late)
values (v_chal_travel, '00000000-0000-4000-8000-000000000014', 'submitted', v_design, now() - interval '6 min', now() - interval '4 min', 135, false) returning id into v_s22;

-- ═══ Duels ═════════════════════════════════════════════════

-- Resolved duels (feed posts are created below)
insert into public.design_duels (challenge_id, submission_a_id, submission_b_id, status, winner_submission_id, ends_at, created_at, resolved_at) values
  (v_chal_checkout, v_s1, v_s2, 'resolved', v_s1, now() - interval '2 hours', now() - interval '4 hours', now() - interval '1 hour'),
  (v_chal_checkout, v_s3, v_s4, 'resolved', v_s4, now() - interval '3 hours', now() - interval '5 hours', now() - interval '2 hours'),
  (v_chal_banking,  v_s5, v_s6, 'resolved', v_s5, now() - interval '6 hours', now() - interval '8 hours', now() - interval '5 hours'),
  (v_chal_banking,  v_s7, v_s8, 'resolved', v_s7, now() - interval '1 day',  now() - interval '1 day',   now() - interval '20 hours'),
  (v_chal_food,     v_s9, v_s10, 'resolved', v_s10, now() - interval '2 days', now() - interval '2 days',  now() - interval '1 day'),
  (v_chal_saas,     v_s11, v_s12, 'resolved', v_s12, now() - interval '3 days', now() - interval '3 days',  now() - interval '2 days')
on conflict do nothing;

-- Open duels (still accepting votes)
insert into public.design_duels (challenge_id, submission_a_id, submission_b_id, status, winner_submission_id, ends_at, created_at, resolved_at) values
  (v_chal_onboarding, v_s13, v_s14, 'open', null, now() + interval '1 day', now() - interval '2 hours', null),
  (v_chal_profile,    v_s16, v_s17, 'open', null, now() + interval '2 hours', now() - interval '1 hour', null)
on conflict do nothing;

-- ═══ Votes ═════════════════════════════════════════════════

-- duel 1 (checkout: user1 vs user2) — 12 votes, 8→A / 4→B
insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_a_id, 'clarity'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_checkout and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000001' and challenge_id = v_chal_checkout)
  and u.id in ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000010')
on conflict (duel_id, voter_id) do nothing;

insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_b_id, 'visual'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_checkout and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000001' and challenge_id = v_chal_checkout)
  and u.id in ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000014')
on conflict (duel_id, voter_id) do nothing;

-- duel 2 (checkout: user3 vs user4) — 10 votes, 3→A / 7→B
insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_a_id, 'hierarchy'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_checkout and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000004' and challenge_id = v_chal_checkout)
  and u.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006')
on conflict (duel_id, voter_id) do nothing;

insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_b_id, 'clarity'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_checkout and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000004' and challenge_id = v_chal_checkout)
  and u.id in ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012')
on conflict (duel_id, voter_id) do nothing;

-- duel 3 (banking: user2 vs user5) — 11 votes, 6→A / 5→B
insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_a_id, 'visual'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_banking and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000002' and challenge_id = v_chal_banking)
  and u.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008')
on conflict (duel_id, voter_id) do nothing;

insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_b_id, 'hierarchy'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_banking and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000002' and challenge_id = v_chal_banking)
  and u.id in ('00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013')
on conflict (duel_id, voter_id) do nothing;

-- duel 4 (banking: user6 vs user7) — 11 votes, 9→A / 2→B
insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_a_id, 'accessibility'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_banking and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000006' and challenge_id = v_chal_banking)
  and u.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011')
on conflict (duel_id, voter_id) do nothing;

insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_b_id, 'visual'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_banking and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000006' and challenge_id = v_chal_banking)
  and u.id in ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013')
on conflict (duel_id, voter_id) do nothing;

-- duel 5 (food-order: user8 vs user9) — 10 votes, 4→A / 6→B
insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_a_id, 'hierarchy'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_food and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000009' and challenge_id = v_chal_food)
  and u.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004')
on conflict (duel_id, voter_id) do nothing;

insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_b_id, 'clarity'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_food and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000009' and challenge_id = v_chal_food)
  and u.id in ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012')
on conflict (duel_id, voter_id) do nothing;

-- duel 6 (saas: user1 vs user5) — 8 votes, 3→A / 5→B
insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_a_id, 'visual'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_saas and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000005' and challenge_id = v_chal_saas)
  and u.id in ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004')
on conflict (duel_id, voter_id) do nothing;

insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_b_id, 'hierarchy'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_saas and d.winner_submission_id = (select id from public.design_duel_submissions where user_id = '00000000-0000-4000-8000-000000000005' and challenge_id = v_chal_saas)
  and u.id in ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000010')
on conflict (duel_id, voter_id) do nothing;

-- duel 7 (onboarding: user3 vs user8, open) — 3 votes so far
insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_a_id, 'clarity'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_onboarding and d.status = 'open'
  and u.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')
on conflict (duel_id, voter_id) do nothing;

insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_b_id, 'visual'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_onboarding and d.status = 'open'
  and u.id in ('00000000-0000-4000-8000-000000000004')
on conflict (duel_id, voter_id) do nothing;

-- duel 8 (profile: user4 vs user10, open) — 2 votes so far
insert into public.design_duel_votes (duel_id, voter_id, selected_submission_id, reason)
select d.id, u.id, d.submission_a_id, 'hierarchy'
from public.design_duels d, public.users u
where d.challenge_id = v_chal_profile and d.status = 'open'
  and u.id in ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006')
on conflict (duel_id, voter_id) do nothing;

-- ═══ Feed result posts ══════════════════════════════════════

insert into public.design_duel_feed_posts (duel_id, user_id, title, is_public, created_at)
select d.id, s.user_id, c.title, true, d.resolved_at
from public.design_duels d
join public.design_duel_submissions s on s.id = d.winner_submission_id
join public.design_duel_challenges c on c.id = d.challenge_id
where d.status = 'resolved'
on conflict (duel_id) do nothing;

end $$;

drop function if exists public._design_set_comp(jsonb, text, text, jsonb);