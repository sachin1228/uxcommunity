import test from 'node:test';
import assert from 'node:assert/strict';
import { productionFiles } from './production-env.mjs';

test('production environment serialization preserves shell metacharacters and refuses missing credentials',()=>{
  const config='[vars]\nAPP_ENV = "production"\nNEXT_PUBLIC_APP_ENV = "production"\nNEXT_PUBLIC_APP_URL = "https://app.example.invalid"\n';
  const keys=['SESSION_SECRET','SUPABASE_SERVICE_ROLE_KEY','API_SECRET','REALTIME_URL','REALTIME_PUBLISH_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','RESEND_API_KEY','EMAIL_FROM','GIPHY_API_KEY','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_URL','R2_PRIVATE_BUCKET_NAME','ADMIN_EMAIL','ADMIN_PASSWORD','API_URL'];
  const value='test-only $value `literal` "quoted" \\ path';
  const env=Object.fromEntries(keys.map(k=>[k,value]));
  const result=productionFiles(config,env);
  assert.equal(JSON.parse(result.realtime).SESSION_SECRET,value);
  assert.equal(JSON.parse(result.runtime).SESSION_SECRET,value);
  assert.equal(JSON.parse(result.buildEnvironment).SESSION_SECRET,value);
  assert.ok(!result.build.includes(value));
  assert.throws(()=>productionFiles(config,{...env,API_SECRET:''}),/API_SECRET/);
  assert.throws(()=>productionFiles('[vars]\nAPP_ENV = "staging"',env),/Wrong release environment/);
});
