import test from 'node:test';
import assert from 'node:assert/strict';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { startStorage } from './storage.mjs';

test('real SDK uploads, presigning, private access and cleanup use only local R2', async () => {
  const secret='local-test-storage-secret-which-is-not-a-production-credential';
  const storage=await startStorage({secret,apiSecret:'local-mail',port:0});
  const endpoint=`http://127.0.0.1:${storage.port}`;
  const client=new S3Client({region:'auto',endpoint,forcePathStyle:true,credentials:{accessKeyId:'local-development',secretAccessKey:secret},requestChecksumCalculation:'WHEN_REQUIRED'});
  try {
    const Bucket='uxcommunity-development-media', Key='test/one & two.txt';
    await client.send(new PutObjectCommand({Bucket,Key,Body:'local bytes',ContentType:'text/plain'}));
    const head=await client.send(new HeadObjectCommand({Bucket,Key}));assert.equal(head.ContentLength,11);
    const get=await client.send(new GetObjectCommand({Bucket,Key}));assert.equal(await get.Body.transformToString(),'local bytes');
    const range=await client.send(new GetObjectCommand({Bucket,Key,Range:'bytes=0-4'}));assert.equal(await range.Body.transformToString(),'local');
    const url=await getSignedUrl(client,new PutObjectCommand({Bucket,Key:'direct.txt'}),{expiresIn:60});
    assert.equal((await fetch(url,{method:'PUT',body:'direct'})).status,200);
    await client.send(new CopyObjectCommand({Bucket,Key:'copy.txt',CopySource:`${Bucket}/direct.txt`}));
    const listed=await client.send(new ListObjectsV2Command({Bucket}));assert.equal(listed.Contents.length,3);
    const privateBucket='uxcommunity-development-private';
    await client.send(new PutObjectCommand({Bucket:privateBucket,Key:'resume.txt',Body:'private'}));
    assert.equal((await fetch(`${endpoint}/${privateBucket}/resume.txt`)).status,403);
    const privateUrl=await getSignedUrl(client,new GetObjectCommand({Bucket:privateBucket,Key:'resume.txt'}),{expiresIn:60});
    assert.equal(await (await fetch(privateUrl)).text(),'private');
    assert.equal((await fetch(privateUrl.replace('resume.txt','other.txt'))).status,403);
    const bad=new URL(privateUrl);bad.searchParams.set('X-Amz-Expires','0');assert.equal((await fetch(bad)).status,403);
    await client.send(new DeleteObjectsCommand({Bucket,Delete:{Objects:listed.Contents.map(o=>({Key:o.Key}))}}));
    assert.equal((await client.send(new ListObjectsV2Command({Bucket}))).Contents?.length ?? 0,0);
    const mail=await fetch(`${endpoint}/__mail`,{method:'POST',headers:{authorization:'Bearer local-mail'},body:JSON.stringify({to:'fake@development.invalid',subject:'test',text:'local code'})});
    assert.equal(mail.status,201);
    assert.equal((await fetch(`${endpoint}/__mail`)).status,403);
    assert.equal((await (await fetch(`${endpoint}/__mail`,{headers:{authorization:'Bearer local-mail'}})).json()).length,1);
  } finally { client.destroy();await storage.close(); }
});
