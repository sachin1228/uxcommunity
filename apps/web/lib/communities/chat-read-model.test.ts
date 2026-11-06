import assert from "node:assert/strict";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

type QueryResult = { data: Record<string, unknown> | null; error?: object };
type Query = { table: string; columns?: string; filters: Array<[string, unknown]> };
type State = {
  showcaseSupported: boolean;
  membership: QueryResult;
  community: QueryResult;
  queries: Query[];
  dpCalls: number;
  db: { from: (table: string) => unknown };
};
const globals = globalThis as typeof globalThis & { chatReadModelTest: State };
let load: typeof import("./chat-read-model").loadCommunityChatReadModel;

before(async () => {
  const modules: Record<string, string> = {
    "server-only": "",
    react: "export const cache = fn => fn;",
    "@/lib/supabase/service": "export const createServiceClient = () => globalThis.chatReadModelTest.db;",
    "./showcase-flag": "export const canStoreShowcaseFlag = async () => globalThis.chatReadModelTest.showcaseSupported;",
    "./dp": `export const resolveCommunityDp = async () => {
      globalThis.chatReadModelTest.dpCalls++;
      return { image_url: "resolved-image" };
    };`,
  };
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./chat-read-model.ts", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm",
    plugins: [{ name: "controlled-chat-reads", setup(builder) {
      builder.onResolve({ filter: /^(server-only|react|@\/|\.\/)/ }, ({ path }) => {
        assert.ok(path in modules, `Unexpected critical-path dependency: ${path}`);
        return { path, namespace: "test" };
      });
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: modules[path], loader: "js" }));
    } }],
  });
  const snapshot = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  load = snapshot.loadCommunityChatReadModel;
});

function setup() {
  const state: State = {
    showcaseSupported: true,
    membership: { data: {
      last_read_at: "2026-11-01T00:00:00Z",
      role: "member",
      notifications_muted: true,
      notifications_muted_until: null,
    } },
    community: { data: { id: "room", name: "Designers", type: "city", reference_id: "city", image_url: null,
      is_private: true, enabled_tabs: ["chat"], showcase_enabled: false,
      member_count: 42, owner_id: "owner-1" } },
    queries: [], dpCalls: 0,
    db: { from(table) {
      assert.ok(table === "community_members" || table === "communities", `Secondary table on critical path: ${table}`);
      const query: Query = { table, filters: [] };
      state.queries.push(query);
      return {
        select(columns: string) { query.columns = columns; return this; },
        eq(column: string, value: unknown) { query.filters.push([column, value]); return this; },
        async maybeSingle() { return table === "community_members" ? state.membership : state.community; },
      };
    } },
  };
  globals.chatReadModelTest = state;
  return state;
}

test("critical snapshot validates membership and active community without secondary metadata reads", async () => {
  const state = setup();
  const result = await load("room", "viewer");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, {
    community: { id: "room", name: "Designers", type: "city", image_url: "resolved-image", is_private: true,
      enabled_tabs: ["chat"], showcase_enabled: false, member_count: 42, owner_id: "owner-1",
      current_user_role: "member", notifications_muted: true, notifications_muted_until: null,
      details_loaded: false },
    members: [], lastReadAt: "2026-11-01T00:00:00Z",
  });
  assert.equal(state.queries.length, 2);
  assert.deepEqual(state.queries[0], {
    table: "community_members",
    columns: "last_read_at, role, notifications_muted, notifications_muted_until",
    filters: [["community_id", "room"], ["user_id", "viewer"]],
  });
  assert.deepEqual(state.queries[1].filters, [["id", "room"], ["is_active", true]]);
  assert.doesNotMatch(state.queries[1].columns!, /description|invite_token|current_user_permissions/);
});

test("the same two rows resolve the owner role", async () => {
  const state = setup();
  state.community.data!.owner_id = "viewer";
  const result = await load("room", "viewer");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.community.current_user_role, "owner");
  assert.equal(result.data.community.member_count, 42);
  assert.equal(state.queries.length, 2, "the owner role comes from the community row, not a second read");
});

test("critical snapshot refuses non-members and inactive or missing communities", async () => {
  const state = setup();
  state.membership = { data: null };
  const denied = await load("room", "viewer");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);
  assert.equal(state.dpCalls, 0);
  state.membership = { data: { last_read_at: null, role: "member", notifications_muted: false, notifications_muted_until: null } };
  state.community = { data: null };
  const missing = await load("room", "viewer");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  state.membership = { data: null, error: {} };
  const failed = await load("room", "viewer");
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.status, 500);
});

test("critical snapshot tolerates an environment without the showcase column", async () => {
  const state = setup();
  state.showcaseSupported = false;
  delete state.community.data!.showcase_enabled;
  const result = await load("room", "viewer");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.community.showcase_enabled, null);
  assert.doesNotMatch(state.queries[1].columns!, /showcase_enabled/);
});
