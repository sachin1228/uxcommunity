import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';

test('workerd accepts isolated fetches and never follows credentialed redirects', async () => {
  const hits=[];
  const server=createServer((req,res)=>{hits.push(req.url);if(req.url==='/redirect')res.writeHead(302,{Location:'https://app.uxcommunity.in/never-follow'}).end();else res.end('isolated');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const built=await build({stdin:{contents:`import {fetchIsolatedService} from './packages/shared/src/environment.ts';export default {async fetch(request){try{return await fetchIsolatedService('${base}'+new URL(request.url).pathname,{headers:{Authorization:'Bearer dummy-test-only'},cache:'no-store'},{APP_ENV:'development'});}catch{return new Response('redirect refused',{status:502})}}};`,resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
  const mf=new Miniflare({...convertV4MiniflareOptions({name:'isolated-fetch-test',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-08-01'}),telemetry:{enabled:false}});
  try {
    const ok=await mf.dispatchFetch('http://local/ok');assert.equal(ok.status,200);assert.equal(await ok.text(),'isolated');
    const redirect=await mf.dispatchFetch('http://local/redirect');assert.equal(redirect.status,502);assert.equal(await redirect.text(),'redirect refused');
    assert.deepEqual(hits,['/ok','/redirect']);
  } finally {await mf.dispose();await new Promise(resolve=>server.close(resolve));}
});
