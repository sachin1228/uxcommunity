import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

type State = {
  imageMap: Record<string, string | null>;
  mapCalls: number;
};
const globals = globalThis as typeof globalThis & { communityDpTest: State };
let resolveCommunityDp: typeof import("./dp").resolveCommunityDp;

before(async () => {
  const modules: Record<string, string> = {
    "server-only": "",
    "@/lib/master-data-cache": `
      export const TABLE_LOOKUP = {
        city: { table: "cities", idCol: "id" },
        sector: { table: "design_sectors", idCol: "id" },
      };
      export const getMasterImageMap = async () => {
        globalThis.communityDpTest.mapCalls++;
        return globalThis.communityDpTest.imageMap;
      };
    `,
  };
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./dp.ts", import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "controlled-master-map",
        setup(builder) {
          builder.onResolve({ filter: /^(server-only|@\/)/ }, ({ path }) => {
            assert.ok(path in modules, `Unexpected dependency: ${path}`);
            return { path, namespace: "test" };
          });
          builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
            contents: modules[path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const snapshot = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  resolveCommunityDp = snapshot.resolveCommunityDp;
});

beforeEach(() => {
  globals.communityDpTest = { imageMap: {}, mapCalls: 0 };
});

test("the mirrored copy wins without reading the cached master map", async () => {
  globals.communityDpTest.imageMap = { "city-1": "https://r2/master.webp" };

  const dp = await resolveCommunityDp({
    type: "city",
    reference_id: "city-1",
    image_url: "https://r2/mirrored.webp",
  });

  assert.equal(dp.image_url, "https://r2/mirrored.webp");
  assert.equal(globals.communityDpTest.mapCalls, 0);
});

test("a missing copy falls back to the master row", async () => {
  globals.communityDpTest.imageMap = { "city-1": "https://r2/master.webp" };

  const dp = await resolveCommunityDp({
    type: "city",
    reference_id: "city-1",
    image_url: null,
  });

  assert.equal(dp.image_url, "https://r2/master.webp");
  assert.equal(globals.communityDpTest.mapCalls, 1);
});

test("a missing copy with no master picture resolves to null", async () => {
  globals.communityDpTest.imageMap = { "city-1": null };

  const dp = await resolveCommunityDp({
    type: "city",
    reference_id: "city-1",
    image_url: null,
  });

  assert.equal(dp.image_url, null);
});

test("member-led communities never consult master data", async () => {
  const dp = await resolveCommunityDp({
    type: "user",
    reference_id: null,
    image_url: null,
  });

  assert.equal(dp.image_url, null);
  assert.equal(globals.communityDpTest.mapCalls, 0);
});

test("a master-backed community without a reference keeps its stored picture", async () => {
  const dp = await resolveCommunityDp({
    type: "city",
    reference_id: null,
    image_url: "https://r2/member-upload.webp",
  });

  assert.equal(dp.image_url, "https://r2/member-upload.webp");
  assert.equal(globals.communityDpTest.mapCalls, 0);
});
