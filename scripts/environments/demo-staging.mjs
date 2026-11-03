/** Explicit staging demo lifecycle. Run IDs make cleanup independent of local fixtures. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertWebEnvironment } from '../../packages/shared/src/environment.ts';
import { createClient } from '@supabase/supabase-js';
import { migrateDemoMedia, cleanupDemoMedia } from './demo-media.mjs';
import { root } from './local.mjs';

export async function stagingDemoEnvironment() {
  const env = JSON.parse(await readFile(process.env.STAGING_MANIFEST ?? resolve(root,'.local/staging/environment.json'),'utf8'));
  assertWebEnvironment(env);
  const ref = env.STAGING_DATABASE_REF;
  if (env.APP_ENV !== 'staging' || !/^[a-z]{20}$/.test(ref ?? '') || ref === 'eauupthwlnarkauwifmw' || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`) throw new Error('Independent staging project reference required');
  const response = await fetch(`${env.NEXT_PUBLIC_APP_URL}/_isolation/check`, { headers:{Authorization:`Bearer ${env.API_SECRET}`},redirect:'error',signal:AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Staging identity check failed');
  const identity = await response.json();
  if (identity.database !== env.NEXT_PUBLIC_SUPABASE_URL || identity.databaseStatus !== 200 || !identity.runtimeMatches || !Object.values(identity.runtimeMatches).every(Boolean)) throw new Error('Live staging database/runtime mismatch');
  return env;
}

export function demoRun(value) {
  if (!/^[a-z0-9][a-z0-9-]{7,47}$/.test(value ?? '')) throw new Error('Supply a unique 8–48 character --run ID using lowercase letters, digits and hyphens');
  return value;
}

export function cleanupStatement(table, rows, conflict) {
  const keys = conflict.split(',');
  if (![table,...keys].every(k=>/^[a-z_]+$/.test(k))) throw new Error('Invalid cleanup identifier');
  const payload = JSON.stringify(rows.map(row=>Object.fromEntries(keys.map(k=>[k,row[k]])))).replaceAll("'","''");
  return `DELETE FROM public.${table} AS target USING jsonb_populate_recordset(NULL::public.${table}, '${payload}'::jsonb) AS seeded WHERE ${keys.map(k=>`target.${k} = seeded.${k}`).join(' AND ')};`;
}

async function main() {
  const action = process.argv[2];
  if (!['seed','cleanup','plan','media'].includes(action)) throw new Error('Use seed, plan or cleanup --run <id>');
  const run = demoRun(process.argv[process.argv.indexOf('--run')+1]);
  const env = await stagingDemoEnvironment();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  if (action === 'seed' || action === 'plan') {
    const {count,error} = await db.from('users').select('id',{count:'exact',head:true}).eq('email',`designer.1.${run}@demo.invalid`);
    if (error || count) throw new Error('Run already exists or cannot be checked; use cleanup or choose a new run ID');
  }
  const dir = resolve(root,'.local/staging/demo',run);
  await mkdir(dir,{recursive:true,mode:0o700});
  const plan = resolve(dir,'seed.sql'), cleanup = resolve(dir,'cleanup.sql');
  if (action === 'seed' || action === 'plan') {
    const result = spawnSync(process.execPath,['--import','tsx','scripts/environments/demo.mjs','--staging-plan','--run',run],{cwd:root,stdio:'inherit',env:process.env});
    if (result.status !== 0) throw new Error('Staging demo plan failed');
    if (action === 'plan') return;
  }
  const metadata = JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
  if (metadata.database !== env.NEXT_PUBLIC_SUPABASE_URL || metadata.run !== run) throw new Error('Demo cleanup project/run mismatch');
  if (action === 'media') { await migrateDemoMedia(env,resolve(dir,'manifest.json')); return; }
  const version = (await readFile(resolve(root,'supabase/cli-version'),'utf8')).trim();
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG') && !k.startsWith('SUPABASE_')));
  if (!process.env.STAGING_SUPABASE_ACCESS_TOKEN?.trim()) throw new Error('STAGING_SUPABASE_ACCESS_TOKEN required');
  childEnv.SUPABASE_ACCESS_TOKEN = process.env.STAGING_SUPABASE_ACCESS_TOKEN.trim();
  const result = spawnSync('npx',['--yes',`supabase@${version}`,'db','query','--linked','--project-ref',env.STAGING_DATABASE_REF,'--file',action==='seed'?plan:cleanup],{cwd:root,env:childEnv,encoding:'utf8'});
  if (result.status !== 0) throw new Error('Staging demo SQL failed; cleanup files preserved. Inspect database state before retrying.');
  for (const [table,ids] of Object.entries(metadata.verify)) {
    const {count,error} = await db.from(table).select('id',{count:'exact',head:true}).in('id',ids);
    if (error || count !== (action === 'seed' ? ids.length : 0)) throw new Error(`Staging demo verification failed: ${table}`);
  }
  if (action === 'cleanup') await cleanupDemoMedia(env,metadata);
  await writeFile(resolve(dir,`${action}-completed.json`),JSON.stringify({run,database:metadata.database,completed_at:new Date().toISOString()}),{mode:0o600});
  console.info(`Staging demo ${action} completed for ${run}. Cleanup files: ${dir}`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(root,'scripts/environments/demo-staging.mjs')) await main();
