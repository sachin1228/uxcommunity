import test from 'node:test';
import assert from 'node:assert/strict';
import { sendExpoPushBatches } from '../../apps/web/lib/push/expo.ts';
import { sendFcmDataMessages } from '../../apps/web/lib/push/fcm.ts';
import { processExpoPushReceipts } from '../../apps/web/lib/push/receipts.ts';
import { sendWelcomeEmail } from '../../apps/web/lib/email/index.ts';

test('staging never contacts push, receipt or email providers even with real-looking tokens and keys', async()=>{
  const saved={...process.env}; const original=globalThis.fetch;
  let requests=0;
  const fetch=async()=>{requests++;throw new Error('Provider must not be contacted');};
  try {
    process.env.APP_ENV='staging';process.env.NEXT_PUBLIC_APP_URL='https://staging.example.invalid';
    process.env.RESEND_API_KEY='nonproduction-key-must-never-be-used';
    globalThis.fetch=fetch;
    const expo=await sendExpoPushBatches([{to:'ExponentPushToken[production-like-device]',body:'blocked'}],{fetch});
    assert.equal(expo.requests,0);assert.equal(expo.delivered,0);assert.deepEqual(expo.deadTokens,[]);
    const fcm=await sendFcmDataMessages([{token:'production-like-token',data:{test:'blocked'}}],{fetch});
    assert.deepEqual(fcm.outcomes,[]);
    const receipts=await processExpoPushReceipts([{ticketId:'production-like-ticket',token:'production-like-token'}],{fetch});
    assert.equal(receipts.requests,0);assert.deepEqual(receipts.deadTokens,[]);
    await sendWelcomeEmail('real-user@example.invalid','User');
    assert.equal(requests,0);
  } finally {
    globalThis.fetch=original;
    for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
    Object.assign(process.env,saved);
  }
});
