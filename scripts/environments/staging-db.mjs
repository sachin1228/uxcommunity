import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertWebEnvironment } from '../../packages/shared/src/environment.ts';
import { seedFixtures } from './fixtures.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const env=JSON.parse(await readFile(process.env.STAGING_MANIFEST ?? resolve(root,'.local/staging/environment.json'),'utf8'));
assertWebEnvironment(env);
const ref=env.STAGING_DATABASE_REF;
if(env.APP_ENV!=='staging' || !/^[a-z]{20}$/.test(ref ?? '') || ref==='eauupthwlnarkauwifmw' || env.NEXT_PUBLIC_SUPABASE_URL!==`https://${ref}.supabase.co`)throw new Error('Explicit independent staging project reference required');
const action=process.argv[2];
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG') && !k.startsWith('SUPABASE_')));
const cliVersion=(await readFile(resolve(root,'supabase/cli-version'),'utf8')).trim();
const run=(command,args,extra={})=>{const r=spawnSync(command,args,{cwd:root,env:{...cleanEnv,...extra},stdio:'inherit'});if(r.status!==0)throw new Error('Staging database operation failed');};
if(action==='plan' || action==='migrate') {
  if(!process.env.STAGING_DATABASE_PASSWORD)throw new Error('STAGING_DATABASE_PASSWORD required; no linked-project fallback');
  run('npx',['--yes',`supabase@${cliVersion}`,'db','push','--project-ref',ref,'--skip-vault',...(action==='plan'?['--dry-run']:['--yes'])],{SUPABASE_DB_PASSWORD:process.env.STAGING_DATABASE_PASSWORD});
} else if(action==='seed') {
  const sql=resolve(root,'.local/staging/initialization.sql');
  run('python3',['scripts/db/initialize.py','--catalogs','config/environments/development-catalogs.json','--include-default-experience-levels','--sql-output',sql]);
  run('npx',['--yes',`supabase@${cliVersion}`,'db','query','--linked','--project-ref',ref,'--file',sql]);
  await seedFixtures(env);
} else throw new Error('Use plan, migrate or seed; production databases are never accepted');
