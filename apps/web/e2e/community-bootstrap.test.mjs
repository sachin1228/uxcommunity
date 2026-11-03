import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { build } from 'esbuild';

let GET;
// Run the actual route orchestration with controlled read dependencies. This
// catches optional work accidentally being invoked or awaited by the fast path.
before(async () => {
  const modules = {
    'next/server': 'export const NextResponse = { json: (body, init) => Response.json(body, init) };',
    '@/lib/auth/session': 'export const requireSession = async () => ({ userId: "member" });',
    '@/lib/server-timing': 'export const estimateJsonBytes = body => JSON.stringify(body).length;',
    '@/lib/supabase/service': 'export const createServiceClient = () => globalThis.bootstrapTest.db;',
    '@/lib/communities/read-models': `
      export const loadCommunityReadModel = async () => {
        globalThis.bootstrapTest.modelCalls++;
        return globalThis.bootstrapTest.model;
      };
      export const loadCommunityMessagePage = async () => ({ ok: true, data: { messages: [{ id: "msg" }] } });`,
    '@/lib/communities/content-events': `export const loadCommunityContentEvents = async () => {
      globalThis.bootstrapTest.cardCalls++;
      return globalThis.bootstrapTest.cards;
    };`,
    '@/lib/communities/permissions': 'export const NO_COMMUNITY_PERMISSIONS = {}; export const hasAnyCommunityPermission = () => false;',
  };
  const result = await build({
    entryPoints: ['apps/web/app/api/communities/[id]/bootstrap/route.ts'],
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'controlled-reads', setup(builder) {
      builder.onResolve({ filter: /^(next\/server|@\/)/ }, ({ path }) => ({ path, namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => {
        assert.ok(path in modules, `missing test dependency: ${path}`);
        return { contents: modules[path], loader: 'js' };
      });
    } }],
  });
  ({ GET } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`));
});
function setup() {
  const state = globalThis.bootstrapTest = {
    modelCalls: 0, cardCalls: 0, ruleCalls: 0,
    model: { ok: true, data: { community: { enabled_tabs: ['chat'] } } },
    cards: [{ id: 'card' }],
  };
  const query = { select() { return this; }, eq() { return this; }, async order() { return { data: [] }; } };
  state.db = { from() { state.ruleCalls++; return query; } };
  return state;
}
function request({ chat = false, section = '' } = {}) {
  return {
    headers: new Headers(chat ? { 'X-Community-Bootstrap': 'chat' } : {}),
    nextUrl: new URL(`https://staging.invalid/bootstrap${section ? `?section=${section}` : ''}`),
  };
}
const context = { params: Promise.resolve({ id: 'room' }) };

test('critical chat response never starts rules or timeline reads', async () => {
  const state = setup();
  state.cards = new Promise(() => {});
  const response = await GET(request({ chat: true }), context);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.messages.messages, [{ id: 'msg' }]);
  assert.equal(body['content-events'], undefined);
  assert.equal(body.rules, undefined);
  assert.equal(state.cardCalls, 0);
  assert.equal(state.ruleCalls, 0);
  assert.equal(state.modelCalls, 1);
  assert.match(response.headers.get('server-timing'), /messages;dur=/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('legacy bootstrap retains all sections and shares the community read', async () => {
  const state = setup();
  const response = await GET(request(), context);
  const body = await response.json();
  assert.deepEqual(body['content-events'], { events: [{ id: 'card' }] });
  assert.deepEqual(body.rules, { rules: [] });
  assert.equal(state.cardCalls, 1);
  assert.equal(state.ruleCalls, 1);
  assert.equal(state.modelCalls, 1);
});
test('secondary history and critical snapshot still require membership', async () => {
  const state = setup();
  state.model = { ok: false, status: 403, error: 'Not a member' };
  const history = await GET(request({ section: 'content-events' }), context);
  assert.equal(history.status, 403);
  assert.equal(state.cardCalls, 0);
  const snapshot = await GET(request({ chat: true }), context);
  assert.equal(snapshot.status, 502);
  assert.equal((await snapshot.json()).messages, undefined);
});
