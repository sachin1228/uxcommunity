import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { readLocalEnvironment, root } from './local.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertWebEnvironment } from '../../packages/shared/src/environment.ts';

const staging=process.argv.includes('--staging');
const env=staging ? JSON.parse(await readFile(resolve(root,'.local/staging/environment.json'),'utf8')) : await readLocalEnvironment();
assertWebEnvironment(env);
if (staging && env.APP_ENV!=='staging') throw new Error('Only staging is accepted');
const base=env.NEXT_PUBLIC_APP_URL;
if (staging) {
  assert.equal((await fetch(`${base}/_isolation/check`)).status,403,'Isolation diagnostics require authorization');
  const r=await fetch(`${base}/_isolation/check`,{headers:{Authorization:`Bearer ${env.API_SECRET}`}});
  assert.equal(r.status,200,'Live staging environment identity');const check=await r.json();
  assert.equal(check.database,env.NEXT_PUBLIC_SUPABASE_URL);assert.equal(check.databaseStatus,200);assert.equal(check.fixtureExists,true);
  assert.ok(Object.values(check.runtimeMatches).every(Boolean),'Staging build/runtime secrets and allowlist agree');
}

const request=async(path,init={})=>fetch(`${base}${path}`,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});
const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`designer@${env.APP_ENV}.invalid`,password:env.DEV_USER_PASSWORD})});
assert.equal(login.status,200,`${env.APP_ENV} fixture login`);
const cookie=login.headers.get('set-cookie')?.match(/uxcommunity_session=([^;]+)/)?.[0];
assert.ok(cookie,'Session cookie');
const me=await request('/api/auth/me',{headers:{Cookie:cookie}});
assert.equal(me.status,200,'Authenticated web/mobile API');
assert.equal((await request('/api/auth/me',{headers:{Authorization:`Bearer ${cookie.split('=')[1]}`}})).status,200,'Mobile bearer session API');
const peerLogin=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`peer@${env.APP_ENV}.invalid`,password:env.DEV_USER_PASSWORD})});
assert.equal(peerLogin.status,200,'Peer login');
const receiverCookie=peerLogin.headers.get('set-cookie')?.match(/uxcommunity_session=([^;]+)/)?.[0];
assert.ok(receiverCookie);
const peerMe=await request('/api/auth/me',{headers:{Cookie:receiverCookie}});
const {user}=await peerMe.json();
assert.ok(user?.id,'Fixture user identity');
const community='de000000-0000-4000-8000-000000000001';
const room=`chat:${community}`;
const url=new URL(`${env.NEXT_PUBLIC_REALTIME_URL}/ws`);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('room',room);
const ws=new WebSocket(url,{headers:{Cookie:receiverCookie}});
const frames=[];
ws.on('message',data=>{try{frames.push(JSON.parse(String(data)));}catch{}});
const until=async(predicate)=>{
  const end=Date.now()+30000;
  while(!await predicate()){if(Date.now()>end)throw new Error('Local realtime timeout');await new Promise(resolve=>setTimeout(resolve,25));}
};
try {
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  ws.send(JSON.stringify({t:'join',user:{id:user.id,name:'Development smoke',avatar:null}}));
  await until(()=>frames.some(f=>f.t==='hello'));
  ws.send(JSON.stringify({t:'subscribe',room,topic:'message'}));
  await until(async()=>{
    const statsUrl=new URL(`${env.REALTIME_URL}/stats`);statsUrl.searchParams.set('room',room);
    const result=await fetch(statsUrl,{headers:{'x-realtime-publish-secret':env.REALTIME_PUBLISH_SECRET}});
    return result.ok && (await result.json()).subscriptionRefs>=1;
  });
  const form=new FormData();
  form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'fixture.png');
  const upload=await request('/api/profile/avatar',{method:'POST',headers:{Cookie:cookie},body:form});
  assert.equal(upload.status,200,'Application upload to local R2');
  const {avatar_url}=await upload.json();assert.ok(avatar_url.startsWith(env.R2_PUBLIC_URL+'/'));
  assert.equal((await fetch(avatar_url)).status,200,'Local media delivery');
  const post=await request(`/api/communities/${community}/messages`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({content:'Isolated smoke message'})});
  assert.equal(post.status,201,'Local chat write');
  await until(()=>frames.some(f=>f.t==='event'));
  for(const route of ['community-message-retention','event-notifications','verification-reapply','dependency-health']) {
    const response=await request(`/api/internal/${route}`,{method:'POST',headers:{Authorization:`Bearer ${env.API_SECRET}`,'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,401,`${route} is disabled outside production`);
  }
  console.info(`PASS: ${env.APP_ENV} login, authenticated mobile/web API, app upload/media, DO chat delivery and disabled cron endpoints`);
} finally {ws.terminate();}
