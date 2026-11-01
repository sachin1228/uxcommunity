import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { root, work, localStatus, readLocalEnvironment } from './local.mjs';

const env=await readLocalEnvironment();
const status=await localStatus();
const path=resolve(work,'initialization.sql');
const result=spawnSync('python3',['scripts/db/initialize.py','--catalogs','config/environments/development-catalogs.json','--include-default-experience-levels','--sql-output',path],{cwd:root,encoding:'utf8'});
if(result.status!==0)throw new Error('Fixture initialization SQL generation failed');
const pgEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')));
const apply=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','--dbname',status.DB_URL,'-f',path],{env:pgEnv,encoding:'utf8'});
if(apply.status!==0)throw new Error('Local fixture initialization failed');
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const email='designer@development.invalid';
const {data:existing,error:findError}=await db.from('users').select('id').eq('email',email).maybeSingle();
if(findError)throw findError;
if(!existing){
  const catalog=async table=>{const {data,error}=await db.from(table).select('*').limit(1).single();if(error)throw error;return data;};
  const city=await catalog('cities'),sector=await catalog('design_sectors'),level=await catalog('experience_levels'),job=await catalog('job_titles');
  const {error}=await db.rpc('complete_signup',{p_name:'Development Designer',p_email:email,p_password_hash:await bcrypt.hash(env.DEV_USER_PASSWORD,12),p_city_id:city.id,p_sector_id:sector.id,p_experience_level_slug:level.slug,p_job_title_slug:job.slug,p_application_id:null,p_avatar_url:null});
  if(error)throw error;
}
const {error}=await db.from('users').update({verification_status:'approved'}).eq('email',email);
if(error)throw error;
console.info('Local fixture user ready: designer@development.invalid. Password is in the private development manifest.');
