/** Explicit, repeatable local product-tour dataset. Never called by deployment. */
import bcrypt from 'bcryptjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readLocalEnvironment, localStatus, work } from './local.mjs';

const env = await readLocalEnvironment(); // verifies stack identity and loopback URLs
if (env.APP_ENV !== 'development') throw new Error('Demo data is local development only');
const status = await localStatus();
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const id = key => { const h = createHash('sha256').update(`uxc-video-demo-v1:${key}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const ago = hours => new Date(Date.now() - hours * 3600000).toISOString();
const future = days => ago(-days * 24);
const counts = {};
async function put(table, rows, onConflict = 'id') {
  if (!rows.length) return;
  // The existing fixture bypass is transaction scoped; normal application limits stay active.
  if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid table');
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const columns = [...new Set(batch.flatMap(row => Object.keys(row)))];
    if (columns.some(c => !/^[a-z_]+$/.test(c))) throw new Error('Invalid column');
    const payload = JSON.stringify(batch).replaceAll("'", "''");
    const sql = `BEGIN; SET LOCAL app.bypass_creation_limits = 'on'; INSERT INTO public.${table} (${columns.join(',')}) SELECT ${columns.join(',')} FROM jsonb_populate_recordset(NULL::public.${table}, '${payload}'::jsonb) ON CONFLICT DO NOTHING; COMMIT;`;
    const result = spawnSync('psql', ['-X','-q','-v','ON_ERROR_STOP=1','--dbname',status.DB_URL], { input:sql, encoding:'utf8', env:Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))) });
    if (result.status !== 0) throw new Error(`${table}: ${result.stderr}`);
  }
  counts[table] = (counts[table] ?? 0) + rows.length;
}
async function get(table) { const { data, error } = await db.from(table).select('*').eq('is_active', true).order('name'); if (error || !data.length) throw new Error(`Missing ${table}; run npm run env:seed first`); return data; }
const [cities, sectors, levels, roles] = await Promise.all(['cities','design_sectors','experience_levels','job_titles'].map(get));
const content = JSON.parse(await readFile(new URL('../../data/demo/editorial.json', import.meta.url)));
const photo = n => `https://images.unsplash.com/${content.photos[n % content.photos.length]}?auto=format&fit=crop&w=1200&q=85`;
const first = ['Aarav','Maya','Priya','Oliver','Ananya','Leo','Zara','Arjun','Sofia','Kabir','Emma','Rohan','Amelia','Ishaan','Noor','Liam','Diya','Ethan','Meera','Lucas'];
const last = ['Shah','Chen','Patel','Williams','Mehta','Kim','Rao','Martinez','Singh','Anderson','Nair','Park','Kapoor','Wilson','Das','Nguyen','Iyer','Garcia','Malik','Thompson'];
const passwordHash = await bcrypt.hash(env.DEV_USER_PASSWORD, 12);
const users = Array.from({ length: 100 }, (_, i) => ({ id: id(`user:${i}`), name: `${first[i % 20]} ${last[(i * 7 + Math.floor(i / 20)) % 20]}`, email: `designer.${i + 1}@demo.invalid`, password_hash: passwordHash, verification_status: 'approved', email_verified_at: ago(1000), age_confirmed_at: ago(1000), terms_accepted_at: ago(1000), created_at: ago(1000 - i * 5) }));
await put('users', users);
const companies = content.studios.map((name, i) => ({ id: id(`company:${i}`), name, slug: `demo-${name.toLowerCase().replaceAll(' ', '-')}`, industry: 'Design and technology', logo_url: `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(name)}`, created_by: users[i].id }));
await put('companies', companies);
await put('designer_profiles', users.map((u, i) => ({ id: id(`profile:${i}`), user_id: u.id, city_id: cities[i % cities.length].id, sector_id: sectors[i % sectors.length].id, experience_level: levels[i % levels.length].slug, job_title: roles[i % roles.length].slug, company_id: companies[i % companies.length].id, avatar_url: `https://i.pravatar.cc/160?img=${1 + i % 70}`, avatar_source: 'upload', bio: content.bios[i % content.bios.length], communities_auto_joined: true })), 'user_id');
const { data: existingUsers, error: usersError } = await db.from('users').select('id,email').not('email','like','%@demo.invalid').eq('is_blocked',false);
if (usersError) throw usersError;
const viewers = existingUsers.map(u => u.id);
const communities = content.communities.map((c, i) => ({ id: id(`community:${i}`), name: c.name, description: c.description, type: 'user', owner_id: users[i].id, is_private: i % 4 === 3, is_public: i % 4 !== 3, enabled_tabs: ['chat','threads','events','resources'], image_url: photo(i), created_at: ago(800 - i * 10) }));
await put('communities', communities);
const memberships = communities.flatMap((c, ci) => users.filter((_, i) => i === ci || (i + ci) % 3 === 0 || (i * 3 + ci) % 7 === 0).map(u => ({ community_id: c.id, user_id: u.id, role: u.id === c.owner_id ? 'owner' : 'member', joined_at: ago(700) })));
// Existing local accounts can immediately record every community, including private rooms.
for (const c of communities) for (const user_id of viewers) memberships.push({ community_id: c.id, user_id, role: 'member', joined_at: ago(600) });
await put('community_members', memberships, 'community_id,user_id');
const members = c => memberships.filter(m => m.community_id === c.id).map(m => m.user_id);
const author = (c, i) => members(c)[i % members(c).length];
await put('community_rules', communities.flatMap((c, ci) => content.rules.map((rule_text, i) => ({ id: id(`rule:${ci}:${i}`), community_id: c.id, rule_text, order_index: i }))));
const threads = Array.from({ length: 120 }, (_, i) => {
  const ci = i % communities.length, c = communities[ci], topic = content.topics[Math.floor(i / communities.length)];
  return { id: id(`thread:${i}`), community_id: c.id, user_id: author(c,i), title: `${topic.open.replace('{focus}', content.communities[ci].focus)}\n\n${topic.body}`, category: topic.category, tags: content.communities[ci].tags, links: i % 5 === 0 ? [content.resources[i % content.resources.length].url] : [], attachments: i % 4 === 0 ? [{ name: 'Design workshop reference', url: photo(i + 3), type: 'image/jpeg', size: 180000 }] : [], poll: i % 10 === 0 ? { question: 'What would you validate first?', options: ['Task completion','Comprehension','Accessibility','Visual hierarchy'] } : null, is_public: !c.is_private, created_at: ago(0.3 + i * 1.7), updated_at: ago(0.3 + i * 1.7) };
});
await put('community_threads', threads);
const showcases = Array.from({ length: 48 }, (_, i) => {
 const c = communities[i % communities.length];
 return { id: id(`showcase:${i}`), community_id: c.id, user_id: author(c, i + 2), title: `${content.projects[i % content.projects.length]}\n\n${content.projectNotes[Math.floor(i / content.projects.length)]}`, category: ['product_design','ui_design','case_study','graphic_design'][i % 4], image_url: photo(i), attachments: [{ name: 'Visual direction reference · Unsplash', url: photo(i), type: 'image/jpeg', size: 180000 }, { name: 'Workshop and process reference · Unsplash', url: photo(i + 2), type: 'image/jpeg', size: 180000 }], is_public: !c.is_private, created_at: ago(i * 2 + 0.1), updated_at: ago(i * 2 + 0.1) };
});
const motion = showcases[6];
motion.title = 'Animation study: Big Buck Bunny trailer\n\nWatching silhouette, anticipation, and timing in the Blender Foundation open film. Reference footage © 2008 Blender Foundation / www.bigbuckbunny.org, licensed CC BY 3.0: https://creativecommons.org/licenses/by/3.0/. Shared as a study reference, with credit to the original artists.';
motion.category = 'motion_design';
motion.attachments.push({ name:'Big Buck Bunny trailer · Blender Foundation · CC BY 3.0',url:'https://download.blender.org/peach/trailer/trailer_iphone.m4v',type:'video/mp4',size:3889885 });
await put('community_showcase_posts', showcases);
const resources = content.resources.map((r, i) => { const c = communities[i % communities.length]; return { id: id(`resource:${i}`), community_id: c.id, user_id: author(c,i + 1), ...r, is_public: !c.is_private, created_at: ago(i * 3 + 1) }; });
await put('community_resources', resources);
const events = content.events.map((title, i) => { const c = communities[i % communities.length]; return { id: id(`event:${i}`), community_id: c.id, user_id: c.owner_id, title, description: `Bring one work in progress and a specific question. We will start with a short walkthrough, work in small critique groups, and finish with practical next steps. ${content.communities[i % communities.length].description}`, event_date: future(i + 1), end_date: ago(-(i + 1) * 24 - 1.5), is_online: i % 3 !== 0, location: i % 3 === 0 ? 'Design studio · Bengaluru' : null, cover_image_url: photo(i + 2), max_attendees: 40, is_public: !c.is_private, host_timezone: 'Asia/Kolkata', host_utc_offset_minutes: 330, created_at: ago(100 + i) }; });
await put('community_events', events);
const jobs = Array.from({ length: 30 }, (_, i) => ({ id: id(`job:${i}`), poster_id: users[i].id, company_id: companies[i % companies.length].id, title: `${['Senior Product Designer','UX Researcher','Design Systems Designer','Brand Designer','Motion Designer','Product Design Intern'][i % 6]} — ${content.domains[i % content.domains.length]}`, kind: i % 5 === 0 ? 'referral' : 'hiring', city_id: cities[i % cities.length].id, sector_id: sectors[i % sectors.length].id, job_title: roles.find(r => r.slug === 'product-designer')?.slug ?? roles[i % roles.length].slug, experience_level: levels[i % levels.length].slug, work_mode: ['remote','hybrid','onsite'][i % 3], employment_type: i % 6 === 5 ? 'internship' : 'full_time', salary: i % 6 === 5 ? '₹35,000–₹50,000 / month' : ['₹24–36 LPA','₹18–28 LPA','₹32–45 LPA'][i % 3], description: `Join ${companies[i % companies.length].name} to make ${content.domains[i % content.domains.length].toLowerCase()} easier to use. You will work with a small cross-functional team, talk directly with customers, and own the journey from discovery to implementation. We value clear thinking, accessible interactions, and evidence over presentation polish.`, responsibilities: ['Map customer journeys with research and product partners','Prototype interaction patterns and test with customers','Partner with engineers on accessible, responsive implementation'], requirements: ['A portfolio explaining decisions, constraints, and outcomes','Experience giving and incorporating constructive critique','Strong interaction design and communication skills'], skills: ['Figma','Prototyping','User research','Accessibility'], created_at: ago(i * 4), closes_at: future(30 + i) }));
// Make the recording accounts' exact profile criteria visible in both job tabs.
const { data: viewerProfiles, error: profileError } = viewers.length
  ? await db.from('designer_profiles').select('user_id,city_id,sector_id,job_title,experience_level').in('user_id',viewers)
  : { data: [], error: null };
if (profileError) throw profileError;
const matchedJobs = (viewerProfiles ?? []).filter(p => p.job_title && p.experience_level).flatMap(p =>
  Array.from({length:8}, (_,i) => {
    const role = roles.find(r => r.slug === p.job_title)?.name ?? 'Designer';
    const motion = /motion|3d/i.test(role);
    return {
      ...jobs[i], id:id(`profile-job:${p.user_id}:${p.job_title}:${p.experience_level}:${p.city_id}:${p.sector_id}:${i}`),
      title:`${role} — ${['AI product storytelling','Interactive learning','Creative tools','Brand experiences','Product explainers','Spatial interfaces','Launch campaigns','Design experiments'][i]}`,
      job_title:p.job_title, experience_level:p.experience_level,
      city_id:i%3===0?null:p.city_id, sector_id:i%3===0?null:p.sector_id,
      kind:i<6?'hiring':'referral', work_mode:['remote','hybrid','onsite'][i%3],
      employment_type:i===5?'internship':i===4?'contract':'full_time',
      salary:i===5?'$25–$32 / hour':'$65,000–$85,000 / year',
      description:`Join ${companies[i % companies.length].name} to make AI-powered tools easier to understand. ${motion?'Create short product animations, explore 3D visual directions, and prototype clear transitions for complex workflows.':'Turn customer problems into clear, accessible product experiences.'} Work alongside an experienced design mentor, with regular critique and time to develop your craft. We welcome early-career portfolios that explain the process behind the work.`,
      responsibilities:motion?['Storyboard short explainers for AI features','Build motion studies and 3D assets with the product team','Test timing, readability, and reduced-motion alternatives']:jobs[i].responsibilities,
      requirements:['A portfolio showing your process and a few thoughtful projects','Comfort sharing work in progress and responding to critique','Interest in AI products and accessible communication'],
      skills:motion?['Blender','After Effects','Storyboarding','Motion design','Figma']:jobs[i].skills,
      created_at:ago(i*0.1), closes_at:future(30+i)
    };
  })
);
jobs.push(...matchedJobs);
await put('job_posts', jobs);
await put('company_members', users.map((u,i) => ({ company_id: companies[i % companies.length].id, user_id: u.id })), 'company_id,user_id');
await put('community_messages', communities.flatMap((c, ci) => Array.from({ length: 30 }, (_, i) => ({ id: id(`message:${ci}:${i}`), community_id: c.id, user_id: author(c, i), content: content.chat[i % content.chat.length].replace('{focus}',content.communities[ci].focus), created_at: ago((30 - i) * 0.3 + ci * 0.01), reply_to_id: i % 4 === 1 ? id(`message:${ci}:${i - 1}`) : null }))));
await put('thread_comments', threads.flatMap((t,i) => Array.from({ length: 2 + i % 4 }, (_, j) => ({ id: id(`comment:${i}:${j}`), thread_id: t.id, user_id: author(communities[i % communities.length], i + j + 1), body: content.comments[(i + j) % content.comments.length], created_at: ago(Math.max(0.01, i * 1.7 - j * 0.1)) }))));
await put('thread_likes', threads.flatMap((t,i) => members(communities[i % communities.length]).slice(0, 3 + i % 17).map(user_id => ({ thread_id: t.id, user_id }))), 'thread_id,user_id');
await put('thread_poll_votes', threads.filter(t => t.poll).flatMap(t => members(communities.find(c => c.id === t.community_id)).slice(0, 18).map((user_id,j) => ({ thread_id: t.id, user_id, option_index: j % 4 }))), 'thread_id,user_id');
await put('showcase_likes', showcases.flatMap((s,i) => members(communities[i % communities.length]).slice(0, 5 + i % 20).map(user_id => ({ post_id: s.id, user_id }))), 'post_id,user_id');
await put('showcase_comments', showcases.map((s,i) => ({ id: id(`showcase-comment:${i}`), post_id: s.id, user_id: author(communities[i % communities.length],i+1), body: content.comments[i % content.comments.length] })));
await put('event_rsvps', events.flatMap((e,i) => members(communities[i % communities.length]).slice(0, 10 + i).map(user_id => ({ event_id: e.id, user_id }))), 'event_id,user_id');
for (const user_id of [...viewers, users[0].id]) {
 await put('thread_saves', threads.filter(t => t.is_public).slice(0,8).map(t => ({ thread_id:t.id,user_id })), 'thread_id,user_id');
 await put('showcase_saves', showcases.filter(s => s.is_public).slice(0,6).map(s => ({ post_id:s.id,user_id })), 'post_id,user_id');
 await put('resource_saves', resources.filter(r => r.is_public).slice(0,6).map(r => ({ resource_id:r.id,user_id })), 'resource_id,user_id');
 const a = [user_id,users[50].id].sort();
 const conversation = id(`dm:${user_id}`);
 await put('dm_conversations',[{ id:conversation,user_a:a[0],user_b:a[1],last_message_at:ago(0.1) }]);
 await put('dm_messages', ['Hey! Are you joining the critique session this week?','Yes, bringing the onboarding flow. Would love your take on the first-run experience.','Perfect. I will bring the research notes so we can compare the two approaches.'].map((text,j) => ({ id:id(`dm-message:${user_id}:${j}`),conversation_id:conversation,user_id:j%2?user_id:users[50].id,content:text,created_at:ago(0.3-j*0.1) })));
}
await put('library_items', resources.filter(r => r.is_public).slice(0,8).map((r,i) => ({ id:id(`library:${i}`),resource_id:r.id,featured_rank:i+1,curated_by:users[0].id })));
await put('resource_comments', resources.map((r,i) => ({ id:id(`resource-comment:${i}`),resource_id:r.id,user_id:author(communities[i % communities.length],i+2),body:'Adding this to our next learning session. The examples are useful context for discussing the tradeoffs in our own work.' })));
await put('event_comments', events.map((e,i) => ({ id:id(`event-comment:${i}`),event_id:e.id,user_id:author(communities[i % communities.length],i+2),body:'Looking forward to this. I will bring a work in progress and a question about the first-time experience.' })));
await put('job_applications', jobs.slice(0,12).map((j,i) => ({ id:id(`application:${i}`),job_id:j.id,applicant_id:users[i+40].id,name:users[i+40].name,portfolio_url:'https://example.invalid/portfolio',linkedin_url:'https://example.invalid/profile',status:i%3===0?'shortlisted':'new' })));
for (const user_id of [...viewers, users[0].id]) {
 await put('event_saves', events.slice(0,4).map(e => ({ event_id:e.id,user_id })), 'event_id,user_id');
 await put('notifications', jobs.slice(0,3).map((j,i) => ({ id:id(`notification:${user_id}:${i}`),user_id,type:'job_match',entity_type:'job',entity_id:j.id,title:'A new role for your next chapter',body:`${j.title} at ${companies[i % companies.length].name}`,href:'/dashboard/jobs',created_at:ago(0.5+i) })));
}
// Verify persisted seed identities, not the number of attempted inserts.
for (const [table, rows] of Object.entries({ users,communities,community_threads:threads,community_showcase_posts:showcases,job_posts:jobs,community_resources:resources,community_events:events })) {
 const { count,error } = await db.from(table).select('id',{count:'exact',head:true}).in('id',rows.map(r=>r.id));
 if (error || count !== rows.length) throw new Error(`Verification failed for ${table}: expected ${rows.length}, got ${count}`);
}
for (const p of viewerProfiles ?? []) {
 const expected = matchedJobs.filter(j => j.job_title === p.job_title && j.experience_level === p.experience_level && (j.city_id === null || j.city_id === p.city_id) && (j.sector_id === null || j.sector_id === p.sector_id));
 if (!expected.length) continue;
 const {data,error} = await db.rpc('get_job_feed',{p_viewer_id:p.user_id,p_limit:100});
 if (error) throw error;
 const visible = (data ?? []).map(r => r.item).filter(j => j.can_apply && expected.some(e => e.id === j.id));
 if (visible.length !== expected.length) throw new Error(`Matching jobs missing from feed for local viewer: expected ${expected.length}, got ${visible.length}`);
 console.info(`Verified local viewer feed: ${visible.filter(j=>j.kind==='hiring').length} hiring and ${visible.filter(j=>j.kind==='referral').length} referral roles available to apply.`);
}
await writeFile(resolve(work,'demo-summary.json'),JSON.stringify({ generated_at:new Date().toISOString(),counts,login:'designer.1@demo.invalid',password:'Use DEV_USER_PASSWORD from environment.json',sources:content.sources },null,2),{mode:0o600});
console.info(JSON.stringify({ counts, login:'designer.1@demo.invalid', note:'Use your existing local account, or the demo login with DEV_USER_PASSWORD from the private local manifest.' },null,2));
