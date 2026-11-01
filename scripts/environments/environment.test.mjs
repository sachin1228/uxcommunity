import test from 'node:test';
import assert from 'node:assert/strict';
import { assertServiceUrl, assertMediaEnvironment, assertWebEnvironment, deliveryEnabled, jobsEnabled } from '../../packages/shared/src/environment.ts';
import { requireLocalDatabase, requireLocalPostgres } from './maintenance.mjs';

test('missing data environment and production aliases fail before network access', () => {
  assert.throws(()=>assertServiceUrl('http://localhost:3000',{}));
  for(const mode of ['development','staging']) {
    for(const url of ['https://eauupthwlnarkauwifmw.supabase.co','https://app.uxcommunity.in','https://rt.uxcommunity.in','https://media.uxcommunity.in','https://uxcommunity-web.example.workers.dev']) {
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
  assert.equal(deliveryEnabled({APP_ENV:'production'}),true);
  assert.equal(jobsEnabled({APP_ENV:'production'}),true);
});
test('maintenance rejects remote targets and libpq service escape hatches', () => {
  assert.throws(()=>requireLocalDatabase('https://eauupthwlnarkauwifmw.supabase.co'));
  assert.doesNotThrow(()=>requireLocalDatabase('http://127.0.0.1:54321'));
  for(const env of [{PGHOST:'production.invalid'},{PGHOST:'localhost',PGHOSTADDR:'1.2.3.4'},{PGHOST:'localhost',PGSERVICE:'production'},{PGHOST:'localhost',PGDATABASE:'postgresql://production/db'}])assert.throws(()=>requireLocalPostgres(env));
  assert.doesNotThrow(()=>requireLocalPostgres({PGHOST:'/tmp/local-socket',PGDATABASE:'local'}));
});
