import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {S3Client,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

const sourceHosts = new Set(['images.unsplash.com','i.pravatar.cc','api.dicebear.com']);
export function imageSource(value) {
  if (typeof value !== 'string') return false;
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && sourceHosts.has(u.hostname);} catch {return false;}
}
const digest = value => createHash('sha256').update(value).digest('hex');
function storage(env) {
  if (env.APP_ENV!=='staging' || env.R2_BUCKET_NAME!=='uxcommunity-staging-media') throw new Error('Staging media bucket required');
  return new S3Client({region:'auto',endpoint:env.R2_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED'});
}
export async function cleanupDemoMedia(env,metadata) {
 const client=storage(env);
 try {
  for (const entry of metadata.media ?? []) {
   if (!entry.key.startsWith(`demo/${metadata.run}/media/`) || entry.key.includes('..')) throw new Error('Media cleanup prefix mismatch');
   const url=await getSignedUrl(client,new DeleteObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:entry.key}),{expiresIn:300});
   const response=await fetch(url,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(30000)});
   if (!response.ok) throw new Error(`Media cleanup failed: ${response.status}`);
  }
 } finally {client.destroy();}
}
export async function migrateDemoMedia(env,manifestPath) {
 const metadata=JSON.parse(await readFile(manifestPath,'utf8'));
 if (metadata.database!==env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Media inventory database mismatch');
 const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const targets=[];
 const tables={communities:['image_url'],community_threads:['attachments'],community_showcase_posts:['image_url','attachments'],community_events:['cover_image_url']};
 for (const [table,fields] of Object.entries(tables)) {
  const {data,error}=await db.from(table).select(['id',...fields].join(',')).in('id',metadata.verify[table]);
  if(error)throw error;
  for(const row of data)targets.push({table,row,fields,key:'id'});
 }
 const {data:profiles,error:profileError}=await db.from('designer_profiles').select('user_id,avatar_url').in('user_id',metadata.verify.users);
 if(profileError)throw profileError;
 for(const row of profiles)targets.push({table:'designer_profiles',row,fields:['avatar_url'],key:'user_id'});
 const {data:companies,error:companyError}=await db.from('companies').select('id,logo_url').in('created_by',metadata.verify.users);
 if(companyError)throw companyError;
 for(const row of companies)targets.push({table:'companies',row,fields:['logo_url'],key:'id'});
 const urls=new Set();
 const scan=value=>{if(imageSource(value))urls.add(value);else if(Array.isArray(value))value.forEach(scan);else if(value && typeof value==='object')Object.values(value).forEach(scan);};
 for(const {row,fields} of targets)fields.forEach(f=>scan(row[f]));
 const map=new Map((metadata.media??[]).map(entry=>[entry.source,entry]));
 const client=storage(env);
 try {
  for(const source of urls) {
   let entry=map.get(source);
   if(!entry?.uploaded) {
    const response=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Image source failed (${new URL(source).hostname}): ${response.status}`);
    const type=(response.headers.get('content-type')??'').split(';')[0];
    const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/svg+xml':'svg'}[type];
    if(!ext)throw new Error('Unsupported image source type');
    const body=Buffer.from(await response.arrayBuffer());
    if(body.length>10*1024*1024)throw new Error('Demo image exceeds 10MB');
    const key=`demo/${metadata.run}/media/${digest(source)}.${ext}`;
    const recorded=Boolean(entry);
    entry=Object.assign(entry??{},{source,key,type,size:body.length,sha256:digest(body),url:`${env.R2_PUBLIC_URL}/${key}`});
    // Inventory is persisted before PUT, including partially completed migrations.
    metadata.media??=[];if(!recorded)metadata.media.push(entry);map.set(source,entry);
    await writeFile(manifestPath,JSON.stringify(metadata,null,2),{mode:0o600});
    const signed=await getSignedUrl(client,new PutObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key,ContentType:type}),{expiresIn:300});
    const upload=await fetch(signed,{method:'PUT',body,headers:{'Content-Type':type},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!upload.ok)throw new Error(`Staging upload failed: ${upload.status}`);
   }
   const check=await fetch(entry.url,{redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!check.ok || digest(Buffer.from(await check.arrayBuffer()))!==entry.sha256)throw new Error('Staging object byte verification failed');
   entry.uploaded=true;
   await writeFile(manifestPath,JSON.stringify(metadata,null,2),{mode:0o600});
   console.info(`Verified staging object ${map.size}: ${entry.key}`);
  }
 } finally {client.destroy();}
 const replace=value=>{
  if(typeof value==='string')return map.get(value)?.url??value;
  if(Array.isArray(value))return value.map(replace);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));
  return value;
 };
 for(const {table,row,fields,key} of targets) {
  const patch=Object.fromEntries(fields.map(f=>[f,replace(row[f])]));
  if(JSON.stringify(patch)===JSON.stringify(Object.fromEntries(fields.map(f=>[f,row[f]]))))continue;
  const {error}=await db.from(table).update(patch).eq(key,row[key]);if(error)throw error;
  const {data,error:readError}=await db.from(table).select(fields.join(',')).eq(key,row[key]).single();
  if(readError||fields.some(f=>JSON.stringify(data[f])!==JSON.stringify(patch[f])))throw new Error(`Media database verification failed: ${table}`);
 }
 console.info(`Migrated and verified ${urls.size} distinct demo images in ${env.R2_BUCKET_NAME}.`);
}
