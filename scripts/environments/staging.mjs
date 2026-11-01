import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertWebEnvironment } from '../../packages/shared/src/environment.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(await readFile(process.env.STAGING_MANIFEST ?? resolve(root,'.local/staging/environment.json'),'utf8'));
if(manifest.APP_ENV!=='staging')throw new Error('Only staging manifests are accepted');
assertWebEnvironment(manifest);
if(manifest.NEXT_PUBLIC_REALTIME_URL!==`${manifest.NEXT_PUBLIC_APP_URL}/_realtime`)throw new Error('Browser realtime must use the staging same-origin gateway');
for(const key of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','ADMIN_PASSWORD'])if(!manifest[key])throw new Error(`Missing ${key}`);
const action=process.argv[2] ?? 'validate';
if(action==='validate')console.info('Staging manifest validated; no resource or deployment changed');
else if(action==='deploy' || action==='provision-storage') {
  const token=process.env.CLOUDFLARE_STAGING_API_TOKEN, account=process.env.CLOUDFLARE_STAGING_ACCOUNT_ID;
  if(!token || !account)throw new Error('Explicit staging deployment credentials required; production credentials are never a fallback');
  if(account!==manifest.R2_ACCOUNT_ID)throw new Error('Staging media and deployment account mismatch');
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PG|SUPABASE_|R2_|REALTIME_|NEXT_PUBLIC_|EXPO_PUBLIC_|UPSTASH_|RESEND_|FCM_|SESSION_SECRET$|API_SECRET$|API_URL$|ADMIN_|GIPHY_|APP_ENV$|CLOUDFLARE_)/.test(k))),...manifest,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account};
  const run=(args,cwd=root,input)=>{
    const r=spawnSync('npx',args,{cwd,env,stdio:input ? ['pipe','inherit','inherit']:'inherit',input});
    if(r.status!==0)throw new Error('Staging command failed; deployment stopped');
  };
  if(action==='provision-storage') {
    for(const bucket of ['uxcommunity-staging-media','uxcommunity-staging-private','uxcommunity-staging-next-cache'])run(['wrangler','r2','bucket','create',bucket]);
    console.info('Dedicated staging buckets created. Configure public media delivery; keep private bucket public access disabled.');
  } else {
    if(process.env.CI!=='true')throw new Error('Deploy through the staging workflow; local development files are not overwritten');
    const vars=Object.entries(manifest).filter(([k])=>k.startsWith('NEXT_PUBLIC_') || k==='APP_ENV').map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n';
    await writeFile(resolve(root,'apps/web/.env.production.local'),vars,{mode:0o600});
    const rt={API_URL:manifest.NEXT_PUBLIC_APP_URL,API_SECRET:manifest.API_SECRET,SESSION_SECRET:manifest.SESSION_SECRET,REALTIME_PUBLISH_SECRET:manifest.REALTIME_PUBLISH_SECRET,STAGING_ALLOWED_ORIGINS:manifest.STAGING_ALLOWED_ORIGINS};
    run(['wrangler','deploy','--config','wrangler.staging.toml'],resolve(root,'apps/realtime'));
    run(['wrangler','secret','bulk','--config','wrangler.staging.toml'],resolve(root,'apps/realtime'),JSON.stringify(rt));
    run(['opennextjs-cloudflare','build','--config','wrangler.staging.toml'],resolve(root,'apps/web'));
    run(['opennextjs-cloudflare','deploy','--config','wrangler.staging.toml'],resolve(root,'apps/web'));
    run(['wrangler','secret','bulk','--config','wrangler.staging.toml'],resolve(root,'apps/web'),JSON.stringify(Object.fromEntries(Object.entries(manifest).filter(([key])=>!['APP_ENV','NEXT_PUBLIC_APP_ENV','DEV_USER_PASSWORD','STAGING_DATABASE_REF'].includes(key)))));
  }
} else throw new Error('Use validate, provision-storage or deploy');
