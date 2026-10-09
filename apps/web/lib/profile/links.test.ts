import assert from "node:assert/strict"
import test from "node:test"

import { isProfileId, profileHref } from "./links"

test("profileHref encodes the id into the member profile route", () => {
  assert.equal(profileHref("0f8fad5b-d9cb-469f-a165-70867728950e"), "/dashboard/profile/0f8fad5b-d9cb-469f-a165-70867728950e")
  assert.equal(profileHref("a/b"), "/dashboard/profile/a%2Fb")
})

test("isProfileId accepts uuids in any case", () => {
  assert.equal(isProfileId("0f8fad5b-d9cb-469f-a165-70867728950e"), true)
  assert.equal(isProfileId("0F8FAD5B-D9CB-469F-A165-70867728950E"), true)
})

test("isProfileId rejects anything a uuid-literal query could not parse", () => {
  for (const value of ["", "member-1", "0f8fad5b-d9cb-469f-a165-70867728950", "0f8fad5b-d9cb-469f-a165-70867728950ee", "../profile"]) {
    assert.equal(isProfileId(value), false, value)
  }
})
