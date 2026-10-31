import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedMutationOrigin,
  isLocalHost,
  shouldRedirectToHttps,
} from "./request-origin";

test("localhost stays on HTTP", () => {
  assert.equal(isLocalHost("localhost:3000"), true);
  assert.equal(shouldRedirectToHttps({ protocol: "http:", host: "localhost:3000" }), false);
});

test("production HTTP is redirected", () => {
  assert.equal(
    shouldRedirectToHttps({
      protocol: "http:",
      host: "app.uxcommunity.in",
      forwardedProto: "http",
    }),
    true,
  );
  assert.equal(
    shouldRedirectToHttps({
      protocol: "http:",
      host: "app.uxcommunity.in",
      forwardedProto: "https",
    }),
    false,
  );
});

test("cf-visitor is a fallback scheme", () => {
  assert.equal(
    shouldRedirectToHttps({
      protocol: "http:",
      host: "app.uxcommunity.in",
      cfVisitorScheme: "http",
    }),
    true,
  );
});

test("same-origin mutations are allowed", () => {
  assert.equal(
    isAllowedMutationOrigin({
      origin: "https://app.uxcommunity.in",
      requestHost: "app.uxcommunity.in",
      secFetchSite: "same-origin",
    }),
    true,
  );
});

test("cross-site and mismatched origins are refused", () => {
  assert.equal(
    isAllowedMutationOrigin({
      origin: "https://evil.example",
      requestHost: "app.uxcommunity.in",
      secFetchSite: "same-origin",
    }),
    false,
  );
  assert.equal(
    isAllowedMutationOrigin({
      origin: "https://app.uxcommunity.in",
      requestHost: "app.uxcommunity.in",
      secFetchSite: "cross-site",
    }),
    false,
  );
  assert.equal(
    isAllowedMutationOrigin({
      origin: "null",
      requestHost: "app.uxcommunity.in",
    }),
    false,
  );
});

test("native/server requests without Origin remain allowed", () => {
  assert.equal(
    isAllowedMutationOrigin({
      origin: null,
      requestHost: "app.uxcommunity.in",
    }),
    true,
  );
});
