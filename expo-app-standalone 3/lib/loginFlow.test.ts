import assert from 'node:assert/strict';
import test from 'node:test';

import { loginWith, resolveLoginUser } from './loginFlow';
import type { LoginResult, User } from './auth';

const user: User = {
  id: 'user-b',
  name: 'B',
  email: 'b@example.com',
  role: 'user',
  profileComplete: true,
  avatar_url: null,
};

function exchange(response: LoginResult) {
  const calls: string[] = [];
  let meCalls = 0;
  const request = async (path: string) => {
    calls.push(path);
    return { data: response };
  };
  const fetchMe = async () => {
    meCalls += 1;
    calls.push('/api/auth/me');
    return user;
  };
  return { calls, request, fetchMe, meCalls: () => meCalls };
}

test('a current server response is used without /api/auth/me', async () => {
  const x = exchange({ success: true, user });
  const result = await loginWith(x.request, x.fetchMe, 'b@example.com', 'pw');

  assert.equal(result.user, user);
  assert.equal(result.isAdmin, false);
  assert.deepEqual(x.calls, ['/api/auth/login']);
  assert.equal(x.meCalls(), 0);
});

test('an older server response falls back to exactly one /me', async () => {
  const x = exchange({ success: true, name: 'B' });
  const result = await loginWith(x.request, x.fetchMe, 'b@example.com', 'pw');

  assert.equal(result.user, user);
  assert.deepEqual(x.calls, ['/api/auth/login', '/api/auth/me']);
});

test('the admin redirect still uses the fallback identity read', async () => {
  const x = exchange({ success: true, redirect: '/admin' });
  const result = await loginWith(x.request, x.fetchMe, 'admin@example.com', 'pw');

  assert.equal(result.isAdmin, true);
  assert.deepEqual(x.calls, ['/api/auth/login', '/api/auth/me']);
});

test('invalid credentials reject before any identity read', async () => {
  const calls: string[] = [];
  const request = async (path: string) => {
    calls.push(path);
    throw Object.assign(new Error('Invalid email or password.'), { status: 401 });
  };
  let meCalls = 0;

  await assert.rejects(
    loginWith(
      request,
      async () => {
        meCalls += 1;
        return user;
      },
      'b@example.com',
      'wrong',
    ),
    /Invalid email or password/,
  );
  assert.deepEqual(calls, ['/api/auth/login']);
  assert.equal(meCalls, 0);
});

test('server failures propagate and do not trigger an identity read', async () => {
  let meCalls = 0;
  const request = async () => {
    throw Object.assign(new Error('HTTP 500'), { status: 500 });
  };

  await assert.rejects(
    loginWith(
      request,
      async () => {
        meCalls += 1;
        return user;
      },
      'b@example.com',
      'pw',
    ),
    /HTTP 500/,
  );
  assert.equal(meCalls, 0);
});

test('a login without a user and a null /me is a failed identity restore', async () => {
  const result = await resolveLoginUser({ success: true }, async () => null);
  assert.equal(result, null);
});
