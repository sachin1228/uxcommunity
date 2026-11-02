import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function productionFiles(config, env) {
  const vars={};
  const section=config.split('[vars]')[1]?.split(/\n\[/)[0];
  if(!section)throw new Error('Production public configuration missing');
  for(const line of section.split('\n')) {
    const match=/^([A-Z_]+)\s*=\s*(".*")\s*$/.exec(line);
    if(match)vars[match[1]]=JSON.parse(match[2]);
  }
  if(vars.APP_ENV!=='production' || vars.NEXT_PUBLIC_APP_ENV!=='production')throw new Error('Wrong release environment');
  const runtime={};
  for(const key of ['SESSION_SECRET','SUPABASE_SERVICE_ROLE_KEY','API_SECRET','REALTIME_URL','REALTIME_PUBLISH_SECRET',
    'UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','RESEND_API_KEY','EMAIL_FROM','GIPHY_API_KEY','R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_URL','R2_PRIVATE_BUCKET_NAME','ADMIN_EMAIL','ADMIN_PASSWORD']) {
    if(!env[key])throw new Error(`Missing production secret: ${key}`);
    runtime[key]=env[key];
  }
  runtime.INVITATION_EXPIRY_DAYS=env.INVITATION_EXPIRY_DAYS || '7';
  if(!env.API_URL)throw new Error('Missing production secret: API_URL');
  const dotenv=values=>Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n';
  return {
    build:dotenv(vars), runtime:JSON.stringify(runtime), buildEnvironment:JSON.stringify({...vars,...runtime}),
    realtime:JSON.stringify({SESSION_SECRET:env.SESSION_SECRET,REALTIME_PUBLISH_SECRET:env.REALTIME_PUBLISH_SECRET,API_URL:env.API_URL,API_SECRET:env.API_SECRET}),
  };
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  if (process.argv[2] === 'build') {
    const env=JSON.parse(await readFile(resolve(root,'apps/web/.production-build-env.json'),'utf8'));
    execFileSync('npx',['opennextjs-cloudflare','build'],{cwd:resolve(root,'apps/web'),env:{...process.env,...env},stdio:'inherit'});
  } else {
    const files=productionFiles(await readFile(resolve(root,'apps/web/wrangler.toml'),'utf8'),process.env);
    for(const [path,content] of [['apps/web/.env.production.local',files.build],['apps/web/.production-runtime.json',files.runtime],['apps/web/.production-build-env.json',files.buildEnvironment],['apps/realtime/.production-secrets.json',files.realtime]]) {
      await writeFile(resolve(root,path),content,{mode:0o600});
    }
  }
}
