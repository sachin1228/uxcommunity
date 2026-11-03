import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

export const demoVideos = [
 {source:'https://download.blender.org/peach/trailer/trailer_iphone.m4v',name:'Big Buck Bunny — compact trailer',credit:'© 2008 Blender Foundation / www.bigbuckbunny.org',study:'Animation study: anticipation and silhouette'},
 {source:'https://media.w3.org/2010/05/sintel/trailer.mp4',name:'Sintel — trailer',credit:'© 2010 Blender Foundation / durian.blender.org',study:'Animation study: lighting and visual storytelling'},
 {source:'https://media.w3.org/2010/05/bunny/trailer.mp4',name:'Big Buck Bunny — higher bitrate trailer',credit:'© 2008 Blender Foundation / www.bigbuckbunny.org',study:'Motion study: comparing detail and streaming quality'},
];
const clipTopics=['Character posing','Environmental lighting','Expressive silhouettes','Camera framing','Anticipation','Visual rhythm','Secondary motion','Material contrast','Colour storytelling','Staging a scene','Gesture and expression','Timing a reaction','Depth and composition','Action continuity','Weight and momentum','Readable movement','Shape language','Texture detail','Focus and attention','Light and shadow','Scene transitions','Animation polish'];
for(let i=0;i<22;i++) {
 const start=12+i*22,duration=[8,12,18,24][i%4];
 demoVideos.push({source:`https://media.w3.org/2010/05/bunny/movie.mp4#clip=${start}-${duration}`,movie:'https://media.w3.org/2010/05/bunny/movie.mp4',start,duration,name:`Big Buck Bunny — ${clipTopics[i].toLowerCase()}`,credit:'© 2008 Blender Foundation / www.bigbuckbunny.org',study:`Motion study: ${clipTopics[i].toLowerCase()}`});
}
export const videoPostIndices=[6,18,30,...Array.from({length:48},(_,i)=>i).filter(i=>i%4!==3 && ![6,18,30].includes(i)).slice(0,22)];

export async function addDemoVideos(env,manifestPath) {
 const metadata=JSON.parse(await readFile(manifestPath,'utf8'));
 if(metadata.database!==env.NEXT_PUBLIC_SUPABASE_URL)throw new Error('Video inventory database mismatch');
 const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const client=storage(env);
 const temp=await mkdtemp(join(tmpdir(),'uxc-demo-video-'));
 let moviePath;
 try {
  for(const [i,video] of demoVideos.entries()) {
   const postId=metadata.verify.community_showcase_posts[videoPostIndices[i]];
   const {data:post,error}=await db.from('community_showcase_posts').select('id,attachments').eq('id',postId).single();
   if(error)throw error;
   metadata.media??=[];
   let entry=metadata.media.find(m=>m.source===video.source);
   if(!entry?.uploaded) {
    let body;
    if(video.movie) {
     if(!moviePath) {
      const response=await fetch(video.movie,{redirect:'error',signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw new Error('Animation source unavailable');
      moviePath=join(temp,'source.mp4');
      let size=0;
      await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>300*1024*1024?new Error('Source exceeds 300MB'):null,chunk);}}),createWriteStream(moviePath));
     }
     const output=join(temp,`clip-${i}.mp4`);
     const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(video.start),'-i',moviePath,'-t',String(video.duration),'-map','0:v:0','-map','0:a:0?','-c','copy','-avoid_negative_ts','make_zero','-movflags','+faststart',output],{encoding:'utf8',timeout:60000});
     if(result.status!==0)throw new Error(`Clip extraction failed: ${result.stderr??'ffmpeg unavailable'}`);
     if((await stat(output)).size>50*1024*1024)throw new Error('Clip exceeds staging upload limit');
     body=await readFile(output);
     const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',output],{encoding:'utf8'});
     if(probe.status!==0||Number(JSON.parse(probe.stdout).format.duration)<1)throw new Error('Clip media metadata invalid');
    } else {
     const response=await fetch(video.source,{redirect:'error',signal:AbortSignal.timeout(60000)});
     if(!response.ok||!['video/mp4','video/x-m4v'].includes((response.headers.get('content-type')??'').split(';')[0]))throw new Error('Video source unavailable or wrong type');
     if(Number(response.headers.get('content-length'))>50*1024*1024)throw new Error('Video exceeds staging demo limit');
     body=Buffer.from(await response.arrayBuffer());
    }
    if(body.length>50*1024*1024)throw new Error('Video exceeds staging demo limit');
    const key=`demo/${metadata.run}/media/${digest(video.source)}.mp4`;
    const recorded=Boolean(entry);
    entry=Object.assign(entry??{},{source:video.source,key,type:'video/mp4',size:body.length,sha256:digest(body),url:`${env.R2_PUBLIC_URL}/${key}`,credit:video.credit,license:'https://creativecommons.org/licenses/by/3.0/'});
    if(!recorded)metadata.media.push(entry);
    await writeFile(manifestPath,JSON.stringify(metadata,null,2),{mode:0o600});
    const signed=await getSignedUrl(client,new PutObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key,ContentType:'video/mp4'}),{expiresIn:300});
    const upload=await fetch(signed,{method:'PUT',body,headers:{'Content-Type':'video/mp4'},redirect:'error',signal:AbortSignal.timeout(60000)});
    if(!upload.ok)throw new Error(`Video upload failed: ${upload.status}`);
   }
   const playback=await fetch(entry.url,{redirect:'error',signal:AbortSignal.timeout(60000)});
   const bytes=Buffer.from(await playback.arrayBuffer());
   if(!playback.ok||digest(bytes)!==entry.sha256)throw new Error('Video bytes failed verification');
   for(const offset of [0,Math.floor(bytes.length/2)]) {
    const end=offset+1023;
    const range=await fetch(entry.url,{headers:{Range:`bytes=${offset}-${end}`},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(range.status!==206||range.headers.get('content-range')!==`bytes ${offset}-${end}/${bytes.length}`||!Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(offset,end+1)))throw new Error('Video seeking verification failed');
   }
   entry.uploaded=true;
   await writeFile(manifestPath,JSON.stringify(metadata,null,2),{mode:0o600});
   const attachment={name:video.name,url:entry.url,type:'video/mp4',size:entry.size};
   const patch={title:`${video.study}\n\n${video.name}. ${video.credit}. Licensed CC BY 3.0: ${entry.license}. Shared as a motion and 3D design reference, with credit to the original artists.${video.movie?` Excerpt starting around ${video.start}s, approximately ${video.duration}s long, trimmed and remuxed for this demo.`:''}`,category:'motion_design',is_public:true,attachments:[attachment,...(post.attachments??[]).filter(a=>a.type?.startsWith('image/'))],created_at:new Date(Date.now()-i*180000).toISOString()};
   const {error:updateError}=await db.from('community_showcase_posts').update(patch).eq('id',postId);if(updateError)throw updateError;
   const {data:check,error:checkError}=await db.from('community_showcase_posts').select('attachments').eq('id',postId).single();
   if(checkError||check.attachments[0]?.url!==entry.url)throw new Error('Video attachment database verification failed');
   console.info(`Video verified for playback and seeking: ${video.name} (${entry.size} bytes)`);
  }
 } finally {client.destroy();await rm(temp,{recursive:true,force:true});}
}
