import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { assertWebEnvironment } from '../../packages/shared/src/environment.ts';

export async function seedFixtures(env) {
  assertWebEnvironment(env);
  if (!['development','staging'].includes(env.APP_ENV)) throw new Error('Fixture writes require a nonproduction environment');
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const email=`designer@${env.APP_ENV}.invalid`;
const {data:existing,error:findError}=await db.from('users').select('id').eq('email',email).maybeSingle();
if(findError)throw findError;
if(!existing){
  const catalog=async table=>{const {data,error}=await db.from(table).select('*').limit(1).single();if(error)throw error;return data;};
  const city=await catalog('cities'),sector=await catalog('design_sectors'),level=await catalog('experience_levels'),job=await catalog('job_titles');
  const {error}=await db.rpc('complete_signup',{p_name:'Development Designer',p_email:email,p_password_hash:await bcrypt.hash(env.DEV_USER_PASSWORD,12),p_city_id:city.id,p_sector_id:sector.id,p_experience_level:level.slug,p_job_title:job.slug,p_avatar_url:null,p_avatar_source:null});
  if(error)throw error;
}
const {error}=await db.from('users').update({verification_status:'approved'}).eq('email',email);
if(error)throw error;
const {data:user,error:userError}=await db.from('users').select('id').eq('email',email).single();
if(userError)throw userError;
const insertMissing=async(table,row)=>{
  const {error}=await db.from(table).upsert(row,{onConflict:'id',ignoreDuplicates:true});
  if(error)throw error;
};
const community='de000000-0000-4000-8000-000000000001';
await insertMissing('communities',{id:community,name:'Development Design Lab',type:'user',owner_id:user.id,is_private:true,enabled_tabs:['chat','threads','events','resources'],is_active:true});
const {error:memberError}=await db.from('community_members').upsert({community_id:community,user_id:user.id,role:'owner'},{onConflict:'community_id,user_id',ignoreDuplicates:true});
if(memberError)throw memberError;
await insertMissing('community_messages',{id:'de000000-0000-4000-8000-000000000002',community_id:community,user_id:user.id,content:'Welcome to the isolated development database.'});
await insertMissing('community_threads',{id:'de000000-0000-4000-8000-000000000003',community_id:community,user_id:user.id,title:'A fictional design discussion',category:'discussion',is_public:false});
await insertMissing('community_events',{id:'de000000-0000-4000-8000-000000000004',community_id:community,user_id:user.id,title:'Development design meetup',event_date:new Date(Date.now()+7*86400000).toISOString(),is_online:true,meet_link:'https://meet.example.invalid/development',is_public:false});
const first=async table=>{const {data,error}=await db.from(table).select('*').limit(1).single();if(error)throw error;return data;};
const city=await first('cities'),sector=await first('design_sectors'),level=await first('experience_levels'),job=await first('job_titles');
const peerEmail=`peer@${env.APP_ENV}.invalid`;
const {data:peerExisting,error:peerFindError}=await db.from('users').select('id').eq('email',peerEmail).maybeSingle();
if(peerFindError)throw peerFindError;
if(!peerExisting){const {error}=await db.rpc('complete_signup',{p_name:'Development Peer',p_email:peerEmail,p_password_hash:await bcrypt.hash(env.DEV_USER_PASSWORD,12),p_city_id:city.id,p_sector_id:sector.id,p_experience_level:level.slug,p_job_title:job.slug,p_avatar_url:null,p_avatar_source:null});if(error)throw error;}
const {data:peer,error:peerError}=await db.from('users').select('id').eq('email',peerEmail).single();if(peerError)throw peerError;
const {error:peerMemberError}=await db.from('community_members').upsert({community_id:community,user_id:peer.id,role:'member'},{onConflict:'community_id,user_id',ignoreDuplicates:true});if(peerMemberError)throw peerMemberError;
const company='de000000-0000-4000-8000-000000000005';
await insertMissing('companies',{id:company,name:'Fictional Development Studio',slug:'fictional-development-studio'});
await insertMissing('job_posts',{id:'de000000-0000-4000-8000-000000000006',poster_id:user.id,company_id:company,city_id:city.id,sector_id:sector.id,experience_level:level.slug,job_title:job.slug,title:'Development Product Designer',description:'Fictional local-only test vacancy.',kind:'hiring',employment_type:'full_time',work_mode:'remote'});
console.info(`Fictional fixture users ready for ${env.APP_ENV}; passwords remain in the private manifest.`);

}
