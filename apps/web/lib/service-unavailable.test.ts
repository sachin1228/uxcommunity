import assert from "node:assert/strict"
import test from "node:test"

import {
  isDocumentRequest,
  serviceUnavailableResponse,
  withServiceUnavailableFallback,
} from "./service-unavailable"

const PAGE_URL = "https://app.uxcommunity.in/login"

function browserNavigation(path = "/login", init: RequestInit = {}) {
  return new Request(`https://app.uxcommunity.in${path}`, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "sec-fetch-dest": "document",
    },
    ...init,
  })
}

function apiRequest(path = "/api/auth/login") {
  return new Request(`https://app.uxcommunity.in${path}`, {
    headers: { accept: "*/*" },
  })
}

test("recognises browser navigations but not API or RSC fetches", () => {
  assert.equal(isDocumentRequest(browserNavigation()), true)
  assert.equal(isDocumentRequest(apiRequest()), false)
  assert.equal(
    isDocumentRequest(
      new Request(PAGE_URL, { headers: { accept: "text/x-component" } }),
    ),
    false,
  )
})

test("serves the branded page for a document request", async () => {
  const response = serviceUnavailableResponse(browserNavigation())

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("retry-after"), "30")

  const html = await response.text()
  assert.match(html, /Error 503/)
  assert.match(html, /The server is temporarily busy/)
  assert.match(html, /Please try again later/)
  assert.match(html, /href=""/)
  assert.match(html, /aria-label="uxcommunity"/)
})

test("keeps a HEAD response bodyless", () => {
  const response = serviceUnavailableResponse(
    browserNavigation("/login", { method: "HEAD" }),
  )

  assert.equal(response.status, 503)
  assert.equal(response.body, null)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
})

test("answers API requests with JSON", async () => {
  const response = serviceUnavailableResponse(apiRequest())

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/)
  assert.deepEqual(await response.json(), {
    error: "Service unavailable. Please try again.",
  })
})

test("answers non-document, non-API requests with plain text", async () => {
  const response = serviceUnavailableResponse(
    new Request(PAGE_URL, { headers: { accept: "text/x-component" } }),
  )

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8")
  assert.equal(await response.text(), "Service unavailable")
})

test("replaces an empty 503 document response with the branded page", async () => {
  const response = await withServiceUnavailableFallback(browserNavigation(), () =>
    Promise.resolve(new Response(null, { status: 503 })),
  )

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
  assert.match(await response.text(), /The server is temporarily busy/)
})

test("leaves successful and non-document responses untouched", async () => {
  const ok = new Response("ok", { status: 200 })
  const apiUnavailable = Response.json(
    { error: "database timeout" },
    { status: 503 },
  )

  assert.equal(
    await withServiceUnavailableFallback(browserNavigation(), () =>
      Promise.resolve(ok),
    ),
    ok,
  )
  assert.equal(
    await withServiceUnavailableFallback(apiRequest(), () =>
      Promise.resolve(apiUnavailable),
    ),
    apiUnavailable,
  )
})

test("turns a thrown handler into the branded page", async () => {
  const originalError = console.error
  console.error = () => {}
  try {
    const page = await withServiceUnavailableFallback(browserNavigation(), () =>
      Promise.reject(new Error("boom")),
    )
    assert.equal(page.status, 503)
    assert.match(await page.text(), /The server is temporarily busy/)

    const api = await withServiceUnavailableFallback(apiRequest(), () =>
      Promise.reject(new Error("boom")),
    )
    assert.equal(api.status, 503)
    assert.deepEqual(await api.json(), {
      error: "Service unavailable. Please try again.",
    })
  } finally {
    console.error = originalError
  }
})
