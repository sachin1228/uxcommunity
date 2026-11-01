import { mkdir, readFile, writeFile, cp, rename, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { assertWebEnvironment } from '../../packages/shared/src/environment.ts';
import { startStorage } from './storage.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const work = resolve(root, '.local/development');
const cliVersion = (await readFile(resolve(root,'supabase/cli-version'),'utf8')).trim();
const safeProcess = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|SUPABASE_|R2_|REALTIME_|NEXT_PUBLIC_|EXPO_PUBLIC_|UPSTASH_|RESEND_|FCM_|SESSION_SECRET$|API_SECRET$|API_URL$|ADMIN_|GIPHY_|APP_ENV$|NODE_ENV$|COMPANY_VERIFICATION_)/.test(k)));
const run = (command,args,options={}) => {
  const result = spawnSync(command,args,{ cwd:root, env:safeProcess(), encoding:'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} failed; local operation stopped`);
  return result.stdout;
};
const db = args => run('npx',['--yes',`supabase@${cliVersion}`,'--workdir',work,...args]);
export async function localStatus() {
  if (existsSync(resolve(work,'supabase/.temp/project-ref')) || existsSync(resolve(work,'supabase/.link.json'))) throw new Error('Local stack has a remote project link');
  const status = JSON.parse(db(['status','--output-format','json']));
  if (resolve(status.identity.project_root) !== work) throw new Error('Different local project identity');
  const env = status.env;
  for (const key of ['DB_URL','API_URL']) if (!['localhost','127.0.0.1','[::1]'].includes(new URL(env[key]).hostname)) throw new Error('Nonlocal Supabase endpoint');
  return env;
}
async function setup() {
  if (existsSync(resolve(work,"environment.json"))) { await readLocalEnvironment(); console.info("Existing isolated development configuration retained"); return; }
  const backup = resolve(homedir(),'.config/uxcommunity/quarantine',new Date().toISOString().replaceAll(':','-'));
  await mkdir(backup,{recursive:true,mode:0o700});
  for (const app of ['web','realtime']) {
    const dir = resolve(root,'apps',app);
    const { readdir } = await import('node:fs/promises');
    for (const name of await readdir(dir)) {
      if ((name.startsWith('.env') && !name.endsWith('.example')) || name.startsWith('.dev.vars')) {
        await rename(resolve(dir,name),resolve(backup,`${app}-${name}`));
      }
    }
  }
  const mobile = resolve(root,'expo-app-standalone 3/.env');
  if (existsSync(mobile)) await rename(mobile,resolve(backup,'mobile.env'));
  for (const name of ['.temp/project-ref','.link.json']) {
    const path=resolve(root,'supabase',name);
    if(existsSync(path))await rename(path,resolve(backup,`supabase-${name.replaceAll('/','-')}`));
  }
  await mkdir(resolve(work,'supabase/migrations'),{recursive:true,mode:0o700});
  await cp(resolve(root,'supabase/migrations'),resolve(work,'supabase/migrations'),{recursive:true});
  await cp(resolve(root,'supabase/supabase.lock'),resolve(work,'supabase/supabase.lock'));
  const config=(await readFile(resolve(root,'supabase/config.toml'),'utf8')).replace('project_id = "uxcommunity"','project_id = "uxcommunity-development"');
  await writeFile(resolve(work,'supabase/config.toml'),config);
  // Startup output contains local keys: keep it in an owner-only file, never logs/CI.
  const log=resolve(work,'startup.private.log');
  await writeFile(log,'',{mode:0o600});
  const result=spawnSync('npx',['--yes',`supabase@${cliVersion}`,'--workdir',work,'start','--runtime','native','--exclude','studio,mail,analytics,pooler,functions','--eager','--frozen'],{cwd:root,env:safeProcess(),encoding:'utf8',maxBuffer:8*1024*1024});
  await writeFile(log,(result.stdout??'')+(result.stderr??''),{mode:0o600});
  if(result.status!==0)throw new Error('Local Supabase startup failed; inspect .local/development/startup.private.log');
  const status=await localStatus();
  const key = status.SERVICE_ROLE_KEY ?? status.SERVICE_KEY;
  if(!key)throw new Error('Local service-role key missing');
  const random=()=>randomBytes(32).toString('hex');
  const env={ APP_ENV:'development', NEXT_PUBLIC_APP_ENV:'development', NEXT_PUBLIC_APP_URL:'http://localhost:3000',
    NEXT_PUBLIC_SUPABASE_URL:status.API_URL, SUPABASE_SERVICE_ROLE_KEY:key,
    NEXT_PUBLIC_REALTIME_URL:'http://localhost:8787', REALTIME_URL:'http://127.0.0.1:8787',
    SESSION_SECRET:random(), API_SECRET:random(), REALTIME_PUBLISH_SECRET:random(), COMPANY_VERIFICATION_PEPPER:random(),
    ADMIN_EMAIL:'admin@development.invalid', ADMIN_PASSWORD:random(), DEV_USER_PASSWORD:random(),
    EMAIL_FROM:'UXCommunity <mail@development.invalid>', R2_ACCOUNT_ID:'local', R2_ACCESS_KEY_ID:'local-development',
    R2_SECRET_ACCESS_KEY:random(), R2_ENDPOINT:'http://127.0.0.1:8788', R2_BUCKET_NAME:'uxcommunity-development-media',
    R2_PRIVATE_BUCKET_NAME:'uxcommunity-development-private', R2_PUBLIC_URL:'http://127.0.0.1:8788/uxcommunity-development-media' };
  assertWebEnvironment(env);
  const dotenv=values=>Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n';
  await writeFile(resolve(work,'environment.json'),JSON.stringify(env,null,2),{mode:0o600});
  await writeFile(resolve(root,'apps/web/.env.local'),dotenv(env),{mode:0o600});
  await writeFile(resolve(root,'apps/web/.dev.vars'),dotenv(env),{mode:0o600});
  await writeFile(resolve(root,'apps/realtime/.dev.vars'),dotenv({APP_ENV:'development',API_URL:'http://localhost:3000',API_SECRET:env.API_SECRET,SESSION_SECRET:env.SESSION_SECRET,REALTIME_PUBLISH_SECRET:env.REALTIME_PUBLISH_SECRET}),{mode:0o600});
  await writeFile(mobile,dotenv({EXPO_PUBLIC_APP_ENV:'development',EXPO_PUBLIC_API_URL:'http://localhost:3000',EXPO_PUBLIC_REALTIME_URL:'http://localhost:8787'}),{mode:0o600});
  await chmod(work,0o700);
  console.info('Isolated local Supabase and configuration ready. Credentials are in .local/development/environment.json; previous files were quarantined outside the repository.');
}
export async function readLocalEnvironment() {
  const env=JSON.parse(await readFile(resolve(work,'environment.json'),'utf8'));
  const status=await localStatus();
  if(env.NEXT_PUBLIC_SUPABASE_URL!==status.API_URL)throw new Error('Local manifest and stack disagree');
  assertWebEnvironment(env);
  return env;
}
async function dev() {
  const env=await readLocalEnvironment();
  const storage=await startStorage({secret:env.R2_SECRET_ACCESS_KEY,apiSecret:env.API_SECRET,persist:resolve(work,'r2')});
  const childEnv={...safeProcess(),...env};
  const children=[spawn('npm',['exec','--workspace=apps/web','--','next','dev','-p','3000','-H','127.0.0.1'],{cwd:root,env:childEnv,stdio:'inherit'}),
    spawn('npm',['exec','--workspace=apps/realtime','--','wrangler','dev','--config','wrangler.development.toml','--ip','127.0.0.1'],{cwd:resolve(root,'apps/realtime'),env:childEnv,stdio:'inherit'})];
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;for(const c of children)c.kill('SIGTERM');await storage.close();};
  process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
  for(const child of children)child.on('exit',()=>void stop());
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const action=process.argv[2];
  if(action==='setup')await setup();
  else if(action==='dev')await dev();
  else if(action==='stop')db(['stop']);
  else throw new Error('Use setup, dev or stop');
}
