import { mkdir, readFile, writeFile, cp, rename, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { assertWebEnvironment } from '../../packages/shared/src/environment.ts';
import { startStorage } from './storage.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const work = resolve(root, '.local/development');
const cliVersion = (await readFile(resolve(root,'supabase/cli-version'),'utf8')).trim();
const inheritedKeys = new Set(['PATH','HOME','SHELL','LANG','LC_ALL','LC_CTYPE','TERM','TMPDIR','TMP','TEMP','USER','LOGNAME','XDG_CACHE_HOME','XDG_CONFIG_HOME','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS']);
const safeProcess = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => inheritedKeys.has(key)));

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
  if (status.readiness !== 'ready') throw new Error('Local Supabase is not ready; run npm run env:setup to restart it');
  const env = JSON.parse(db(['status','--env','--output-format','json']));
  for (const key of ['DB_URL','API_URL']) if (!['localhost','127.0.0.1','[::1]'].includes(new URL(env[key]).hostname)) throw new Error('Nonlocal Supabase endpoint');
  return env;
}
async function setup() {
  const existing = existsSync(resolve(work,'environment.json')) ? JSON.parse(await readFile(resolve(work,'environment.json'),'utf8')) : null;
  if (existing) assertWebEnvironment(existing);
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
  const config=(await readFile(resolve(root,'supabase/config.toml'),'utf8')).replace('project_id = "uxcommunity"',`project_id = "uxcommunity-development-${createHash('sha256').update(root).digest('hex').slice(0,8)}"`);
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
  const port=(name,fallback)=>{const value=Number(process.env[name]??fallback);if(!Number.isInteger(value)||value<1024||value>65535)throw new Error('Invalid local port');return value;};
  const webPort=port('UXC_WEB_PORT',3000), rtPort=port('UXC_REALTIME_PORT',8787), storagePort=port('UXC_STORAGE_PORT',8788);
  const random=()=>randomBytes(32).toString('hex');
  const env=existing ? { ...existing, NEXT_PUBLIC_SUPABASE_URL:status.API_URL, SUPABASE_SERVICE_ROLE_KEY:key } : { APP_ENV:'development', NEXT_PUBLIC_APP_ENV:'development', NEXT_PUBLIC_APP_URL:`http://localhost:${webPort}`,
    NEXT_PUBLIC_SUPABASE_URL:status.API_URL, SUPABASE_SERVICE_ROLE_KEY:key,
    NEXT_PUBLIC_REALTIME_URL:`http://localhost:${rtPort}`, REALTIME_URL:`http://127.0.0.1:${rtPort}`,
    SESSION_SECRET:random(), API_SECRET:random(), REALTIME_PUBLISH_SECRET:random(), COMPANY_VERIFICATION_PEPPER:random(),
    ADMIN_EMAIL:'admin@development.invalid', ADMIN_PASSWORD:random(), DEV_USER_PASSWORD:random(),
    EMAIL_FROM:'UXCommunity <mail@development.invalid>', R2_ACCOUNT_ID:'local', R2_ACCESS_KEY_ID:'local-development',
    R2_SECRET_ACCESS_KEY:random(), R2_ENDPOINT:`http://127.0.0.1:${storagePort}`, R2_BUCKET_NAME:'uxcommunity-development-media',
    R2_PRIVATE_BUCKET_NAME:'uxcommunity-development-private', R2_PUBLIC_URL:`http://127.0.0.1:${storagePort}/uxcommunity-development-media` };
  assertWebEnvironment(env);
  const dotenv=values=>Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n';
  await writeFile(resolve(work,'environment.json'),JSON.stringify(env,null,2),{mode:0o600});
  await writeFile(resolve(root,'apps/web/.env.local'),dotenv(env),{mode:0o600});
  await writeFile(resolve(root,'apps/web/.dev.vars'),dotenv(env),{mode:0o600});
  await writeFile(resolve(root,'apps/realtime/.dev.vars'),dotenv({APP_ENV:'development',API_URL:env.NEXT_PUBLIC_APP_URL,API_SECRET:env.API_SECRET,SESSION_SECRET:env.SESSION_SECRET,REALTIME_PUBLISH_SECRET:env.REALTIME_PUBLISH_SECRET}),{mode:0o600});
  await writeFile(mobile,dotenv({EXPO_PUBLIC_APP_ENV:'development',EXPO_PUBLIC_API_URL:env.NEXT_PUBLIC_APP_URL,EXPO_PUBLIC_REALTIME_URL:env.NEXT_PUBLIC_REALTIME_URL}),{mode:0o600});
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
  run(process.execPath,["scripts/extract-emoji.mjs"],{stdio:"inherit"});
  const storage=await startStorage({secret:env.R2_SECRET_ACCESS_KEY,apiSecret:env.API_SECRET,persist:resolve(work,'r2'),port:Number(new URL(env.R2_ENDPOINT).port),allowedOrigins:[env.NEXT_PUBLIC_APP_URL,env.NEXT_PUBLIC_APP_URL.replace('localhost','127.0.0.1')]});
  const childEnv={...safeProcess(),...env};
  const children=[spawn('npm',['exec','--workspace=apps/web','--','next','dev','-p',new URL(env.NEXT_PUBLIC_APP_URL).port,'-H','127.0.0.1'],{cwd:root,env:childEnv,stdio:'inherit',detached:true}),
    spawn('npm',['exec','--workspace=apps/realtime','--','wrangler','dev','--config','wrangler.development.toml','--ip','127.0.0.1','--port',new URL(env.NEXT_PUBLIC_REALTIME_URL).port],{cwd:root,env:childEnv,stdio:'inherit',detached:true})];
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;const tree=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));const owned=new Set(children.map(c=>c.pid));let changed=true;while(changed){changed=false;for(const [pid,ppid] of tree)if(owned.has(ppid)&&!owned.has(pid)){owned.add(pid);changed=true;}}for(const pid of [...owned].reverse()){try{process.kill(pid,'SIGTERM');}catch{}}await storage.close();};
  process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
  for(const child of children){child.on('error',()=>{process.exitCode=1;void stop();});child.on('exit',code=>{if(!stopping && code)process.exitCode=code;void stop();});}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const action=process.argv[2];
  if(action==='setup')await setup();
  else if(action==='dev')await dev();
  else if(action==='stop')db(['stop']);
  else throw new Error('Use setup, dev or stop');
}
