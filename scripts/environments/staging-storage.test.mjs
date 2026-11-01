import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useR2Bindings } from '../../apps/web/lib/r2-bindings.ts';
import { serveStagingMedia } from '../../apps/web/lib/r2-delivery.ts';

test('staging bindings and signed delivery cannot address production or expose private files', async () => {
  const mf=new Miniflare({...convertV4MiniflareOptions({name:'staging-storage-test',modules:true,compatibilityDate:'2026-08-01',script:'export default {fetch(){return new Response("test")}}',r2Buckets:['MEDIA','PRIVATE']}),telemetry:{enabled:false}});
  const env={APP_ENV:'staging',MEDIA_R2_BUCKET:await mf.getR2Bucket('MEDIA'),PRIVATE_R2_BUCKET:await mf.getR2Bucket('PRIVATE'),R2_ACCESS_KEY_ID:'staging-runtime',R2_SECRET_ACCESS_KEY:'staging-test-signing-secret-with-no-cloudflare-api-access'};
  const client=useR2Bindings(new S3Client({region:'auto',endpoint:'https://staging.example.invalid/_s3',forcePathStyle:true,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED'}),env);
  try {
    const Bucket='uxcommunity-staging-media',Key='test/one & two.txt';
    await client.send(new PutObjectCommand({Bucket,Key,Body:'staging bytes',ContentType:'text/plain'}));
    assert.equal(await (await client.send(new GetObjectCommand({Bucket,Key}))).Body.transformToString(),'staging bytes');
    assert.equal((await client.send(new ListObjectsV2Command({Bucket}))).Contents.length,1);
    await assert.rejects(()=>client.send(new PutObjectCommand({Bucket:'drafthub',Key:'refused',Body:'no'})),/Unbound/);
    const publicResponse=await serveStagingMedia(new Request(`https://staging.example.invalid/_media/${encodeURI(Key)}`),env);
    assert.equal(publicResponse.status,200);assert.equal(await publicResponse.text(),'staging bytes');
    const upload=await getSignedUrl(client,new PutObjectCommand({Bucket:'uxcommunity-staging-private',Key:'resume.pdf'}),{expiresIn:60});
    assert.equal((await serveStagingMedia(new Request(upload,{method:'PUT',body:'private bytes'}),env)).status,200);
    const unsigned=upload.split('?')[0];assert.equal((await serveStagingMedia(new Request(unsigned),env)).status,403);
    const signed=await getSignedUrl(client,new GetObjectCommand({Bucket:'uxcommunity-staging-private',Key:'resume.pdf'}),{expiresIn:60});
    const response=await serveStagingMedia(new Request(signed),env);assert.equal(response.status,200);assert.equal(await response.text(),'private bytes');assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    assert.equal((await serveStagingMedia(new Request(signed.replace('resume.pdf','tampered.pdf')),env)).status,403);
    assert.equal((await serveStagingMedia(new Request(signed.replace('uxcommunity-staging-private','drafthub')),env)).status,404);
    const range=await serveStagingMedia(new Request(signed,{headers:{Range:'bytes=0-6'}}),env);assert.equal(range.status,206);assert.equal(await range.text(),'private');
    await client.send(new DeleteObjectsCommand({Bucket,Delete:{Objects:[{Key}]}}));
    assert.equal((await client.send(new ListObjectsV2Command({Bucket}))).Contents.length,0);
  } finally {client.destroy();await mf.dispose();}
});
