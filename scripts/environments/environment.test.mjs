import test from 'node:test';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import { assertServiceUrl, assertMediaEnvironment, assertWebEnvironment, deliveryEnabled, jobsEnabled } from '../../packages/shared/src/environment.ts';
import { requireLocalDatabase, requireLocalPostgres } from './maintenance.mjs';

test('missing data environment and production aliases fail before network access', () => {
  assert.throws(()=>assertServiceUrl('http://localhost:3000',{}));
  for(const mode of ['development','staging']) {
    for(const url of ['https://eauupthwlnarkauwifmw.supabase.co','https://app.uxcommunity.in','https://app.uxcommunity.in.','https://rt.uxcommunity.in','https://media.uxcommunity.in','https://uxcommunity-web.example.workers.dev']) {
      assert.throws(()=>assertServiceUrl(url,{APP_ENV:mode,STAGING_ALLOWED_ORIGINS:url}),url);
    }
  }
  for(const url of ['https://localhost.evil.invalid','https://127.0.0.1.evil.invalid','https://user:password@localhost']) {
    assert.throws(()=>assertServiceUrl(url,{APP_ENV:'development'}));
  }
});
test('staging needs exact origins and dedicated buckets; local S3 cannot be remote', () => {
  const env={APP_ENV:'staging',STAGING_ALLOWED_ORIGINS:'https://staging.example.invalid'};
  assert.equal(assertServiceUrl('https://staging.example.invalid/api',env),'https://staging.example.invalid/api');
  assert.throws(()=>assertServiceUrl('https://other.example.invalid',env));
  assert.throws(()=>assertMediaEnvironment({...env,R2_BUCKET_NAME:'drafthub',R2_PRIVATE_BUCKET_NAME:'uxcommunity-private'}));
  assert.throws(()=>assertMediaEnvironment({APP_ENV:'development',R2_BUCKET_NAME:'uxcommunity-development-media',R2_PRIVATE_BUCKET_NAME:'uxcommunity-development-private',R2_PUBLIC_URL:'http://localhost:8788/media',R2_ACCOUNT_ID:'local',R2_ACCESS_KEY_ID:'local-development',R2_ENDPOINT:'https://account.r2.cloudflarestorage.com'}));
});
test('nonproduction push/email and cron remain off even with permissive flags', () => {
  for(const mode of ['development','staging']) {
    const env={APP_ENV:mode,PUSH_ENABLED:'true',CRON_ENABLED:'true',RESEND_API_KEY:'should-not-be-used'};
    assert.equal(deliveryEnabled(env),false);assert.equal(jobsEnabled(env),false);
    assert.throws(()=>assertWebEnvironment({...env,NEXT_PUBLIC_APP_ENV:'production'}));
  }
  assert.equal(deliveryEnabled({}),false);assert.equal(jobsEnabled({}),false);
  assert.equal(deliveryEnabled({APP_ENV:'production'}),true);
  assert.equal(jobsEnabled({APP_ENV:'production'}),true);
});
test('maintenance rejects remote targets and libpq service escape hatches', () => {
  assert.throws(()=>requireLocalDatabase('https://eauupthwlnarkauwifmw.supabase.co'));
  assert.doesNotThrow(()=>requireLocalDatabase('http://127.0.0.1:54321'));
  for(const env of [{PGHOST:'production.invalid'},{PGHOST:'localhost',PGHOSTADDR:'1.2.3.4'},{PGHOST:'localhost',PGSERVICE:'production'},{PGHOST:'localhost',PGDATABASE:'postgresql://production/db'}])assert.throws(()=>requireLocalPostgres(env));
  assert.doesNotThrow(()=>requireLocalPostgres({PGHOST:'/tmp/local-socket',PGDATABASE:'local'}));
});

test('mobile profiles reject production aliases and keep nonproduction sessions separate', async () => {
  const saved={...process.env};
  try {
    for (const [id,mode,api,rt,origin,expected] of [
      ['local','development','http://localhost:3000','http://localhost:8787',undefined,true],
      ['stage','staging','https://staging.example.invalid','https://staging.example.invalid/_realtime','https://staging.example.invalid',true],
      ['dot','staging','https://app.uxcommunity.in.','https://app.uxcommunity.in./_realtime','https://app.uxcommunity.in.',false],
      ['db','staging','https://eauupthwlnarkauwifmw.supabase.co','https://eauupthwlnarkauwifmw.supabase.co','https://eauupthwlnarkauwifmw.supabase.co',false],
      ['remote','development','https://example.invalid','http://localhost:8787',undefined,false],
    ]) {
      process.env.EXPO_PUBLIC_APP_ENV=mode;process.env.EXPO_PUBLIC_API_URL=api;process.env.EXPO_PUBLIC_REALTIME_URL=rt;
      if(origin)process.env.EXPO_PUBLIC_STAGING_ORIGIN=origin;else delete process.env.EXPO_PUBLIC_STAGING_ORIGIN;
      const mod=await import(new URL(`../../expo-app-standalone%203/lib/environment.ts?isolation=${id}`,import.meta.url));
      if(expected){assert.doesNotThrow(mod.validateMobileEnvironment);assert.equal(mod.mobilePushEnabled,false);assert.ok(mod.mobileEnvironmentKey('session').endsWith(`.${mode}`));}
      else assert.throws(mod.validateMobileEnvironment);
    }
  } finally {
    for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
  }
});


test('nonproduction native identity omits production Firebase configuration and its package-specific plugin', () => {
  const require=createRequire(import.meta.url), config=require('../../expo-app-standalone 3/app.json').expo;
  const configure=require('../../expo-app-standalone 3/app.config.js');const prior=process.env.EXPO_PUBLIC_APP_ENV;
  try {
    process.env.EXPO_PUBLIC_APP_ENV='production';assert.equal(configure({config}),config);
    for(const mode of ['development','staging']){
      process.env.EXPO_PUBLIC_APP_ENV=mode;const result=configure({config});
      assert.equal(result.android.googleServicesFile,undefined);assert.ok(result.android.package.endsWith(`.${mode}`));assert.ok(result.ios.bundleIdentifier.endsWith(`.${mode}`));
      assert.ok(!result.plugins.includes('./plugins/withChatNotifications'));
    }
  } finally {if(prior===undefined)delete process.env.EXPO_PUBLIC_APP_ENV;else process.env.EXPO_PUBLIC_APP_ENV=prior;}
});

test('staging realtime calls its web binding instead of public or production endpoints', async () => {
  const {fetchWebService}=await import('../../apps/realtime/src/web-service.ts');
  const original=globalThis.fetch;let boundCalls=0;
  globalThis.fetch=()=>{throw new Error('Public transport must not run');};
  const env={APP_ENV:'staging',STAGING_ALLOWED_ORIGINS:'https://staging.example.invalid',WEB_SERVICE:{fetch:async()=>{boundCalls++;return new Response('bound');}}};
  try {
    assert.equal(await (await fetchWebService(env,'https://staging.example.invalid/api/internal/session/validate',{})).text(),'bound');
    assert.equal(boundCalls,1);
    await assert.rejects(()=>fetchWebService(env,'https://app.uxcommunity.in/api/internal/session/validate',{}));assert.equal(boundCalls,1);
    assert.throws(()=>fetchWebService({...env,WEB_SERVICE:undefined},'https://staging.example.invalid',{}));
  } finally {globalThis.fetch=original;}
});
