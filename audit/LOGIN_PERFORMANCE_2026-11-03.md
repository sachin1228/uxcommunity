# Website login performance audit — 3 November 2026

The live website has substantial latency before password verification. Three
nonexistent-account requests took **1.33–1.40 seconds**, even though that path
never runs bcrypt. The successful flow on an optimized local build took
**0.09–0.23 seconds for the API** and **0.25–0.46 seconds from submission to a
painted feed**. Service waits and the dashboard loading sequence deserve the
first optimization work.

**A successful production login was not measured:** no production test account
or session was available. These measurements do not establish a production
login total or attribute an exact number of milliseconds to production Redis,
database, or bcrypt work.

## Measurements

Source revision: `9f9efe61`. Production target: `https://app.uxcommunity.in`.
Raw, sanitized measurements: [login-performance-2026-11-03.json](login-performance-2026-11-03.json).

| Measurement | Samples | Median | Range | Meaning |
|---|---:|---:|---:|---|
| Live login-page HTTP fetch, existing browser connection | 5 | 1,187 ms | 932–1,196 ms | Includes network, middleware and document delivery; excludes initial DNS/TLS and rendering |
| Live login API, nonexistent audit identity | 3 | 1,333 ms | 1,332–1,397 ms | Middleware + login rate limits + account lookup; no bcrypt/session creation |
| Live health API, bypassing limiter and database I/O | 3 | 555 ms | 505–676 ms | Network/Worker/framework reference, not an isolated network measurement |
| Local successful login API | 5 | 103 ms | 91–233 ms | Current cost-10 test account |
| Local submission → dashboard first contentful paint | 5 | 148 ms | 133–332 ms | Shell paint, not completed feed |
| Local submission → painted feed cards | 5 | 300 ms | 248–464 ms | Four returned feed items; background badges/sidebar may still be loading |
| Local bcrypt comparison, cost 10 | 7 | 71 ms | 68–75 ms | Isolated CPU benchmark on this machine |
| Local bcrypt comparison, cost 12 | 7 | 288 ms | 273–310 ms | Older stored-password setting; not Worker CPU timing |

One live browser navigation painted the login form at **1,820 ms**, with a
**1,448 ms TTFB**. A separate fresh curl request took **1,956 ms total**;
DNS/TCP/TLS completed by 625 ms. The remaining time includes network transit
and service processing, and cannot be called server execution time.

The first local API request after server startup took **325 ms**. Local tests
used `next build` + `next start`, the isolated local Supabase stack, and the
development in-memory limiter. They exclude remote Redis and Cloudflare runtime
costs. The first browser sample had a fresh asset cache; later samples reused
the browser cache. The feed server cache was warm in these five samples, so they
do not measure a cold feed RPC. This is a small diagnostic sample, not a load test or p95
measurement.

## Where the time goes

```text
Submit
  → middleware: JWT signature if present → global burst limiter
      → sustained limiter on its 2-second cache miss
  → login API: IP and email limiters together
  → users + profile lookup
  → bcrypt comparison
  → older hashes only: new hash + conditional database update
  → create_auth_session RPC
  → password-hash recheck
  → sign JWT → verification settings on its 30-second cache miss → cookie/JSON
  → import session-cache cleanup → hard navigation
  → dashboard middleware → registry check
  → user + profile + verification settings in parallel
  → legacy accounts only: awaited community auto-join repair
  → dashboard/client hydration → feed API → feed cards paint
```

- **Rate limiting:** [global-request-rate-limit.ts](../apps/web/lib/global-request-rate-limit.ts)
  awaits burst, then sustained. The route's IP/email checks are already parallel.
  Login therefore has **two serial Redis stages**, or **three on a sustained
  cache miss**. That is three or four limiter operations, not a measured count
  of underlying Redis HTTP requests. The public login page also passes through
  the global limiter despite being prerendered. The health/page difference
  makes this a strong candidate to instrument; it does not isolate Redis cost.
- **Login database chain:** [login/route.ts](../apps/web/app/api/auth/login/route.ts)
  makes **three mandatory serial database requests** for an ordinary successful
  login. Verification settings add a fourth on cache miss. Old-password rehash
  adds another write. The settings read currently comes at the end of the chain.
- **Password CPU:** current bcrypt cost is already 10. The local comparison was
  about four times faster than cost 12. An older account's first successful
  login also computes a cost-10 replacement and waits for its conditional write.
  The production share of old hashes was not inspected.
- **Dashboard loading:** [dashboard/layout.tsx](../apps/web/app/dashboard/layout.tsx)
  waits for registry validation and then more identity/profile reads. Its
  `loading.tsx` is inside the layout, so it cannot hide waits performed by that
  layout. Community repair can add many more database requests for affected
  accounts. The suggestions rail also performs a cached community RPC.
- **Another browser round trip:** [HomeFeed.tsx](../apps/web/app/dashboard/HomeFeed.tsx)
  starts the first feed fetch in a client effect after hydration. Sidebar,
  unread-message, notification and limits APIs also start during dashboard
  startup. Each authenticated API repeats its own authorization/limiter work.
- **Cache-cleanup import:** [login/page.tsx](../apps/web/app/login/page.tsx)
  awaits a dynamic import before navigating. This is a potential cold-asset
  wait, but it was only **0.7–4.2 ms** from API response to navigation in the
  successful local samples, so it is a lower priority on present evidence.

In the fastest local sample, database fetches inside login totaled **12.6 ms**;
the rest of the **90.8 ms** API time was **78.2 ms**, consistent with the
separate bcrypt benchmark plus framework/signing work. In two slower samples,
database fetches totaled about **150 ms**, illustrating why CPU alone cannot
explain every slow login. Fetch spans stop at response headers and are not
database engine execution times.

## Recommended changes, in order

1. **Measure the live phases before tuning.** Reuse the existing
   [server timer](../apps/web/lib/server-timing.ts) for middleware and login:
   global burst/sustained, login limits, account lookup, bcrypt, rehash,
   session creation, password guard, settings and total. Add browser marks for
   submission, API completion, shell paint and feed readiness. The live login
   response exposed only Cloudflare's `cfExtPri`, without application durations.
   Correlate timings without logging credentials, hashes or cookies.
2. **Reduce serial limiter waits.** Check burst/sustained concurrently when a
   sustained read is needed, preserving both quotas. Consider an atomic Redis
   operation for multiple login quotas, and measure Redis locality from the
   Sydney Worker. Inspect timeout outcomes: the installed limiter defaults to
   5 seconds per call. Set an explicit measured deadline consistent with the
   application's existing outage policy. Savings depend on the live spans;
   parallel global checks remove one serial Redis wait on a cache miss.
3. **Remove one login database hop safely.** Extend `create_auth_session` to
   validate the expected password hash and insert the session in one transaction
   with user-row locking. Then remove the route's separate post-insert
   hash read. Retain password-reset, suspension and generation protections;
   deleting that read without an atomic replacement is unsafe. Fetch banner
   settings earlier in parallel, or skip them for approved users whose banner
   is always hidden.
4. **Shorten the dashboard's blocking work.** Combine the live registry/user/
   profile projection so the layout does not re-fetch identity fields in a
   second database stage. Preserve fresh revocation checks. Move legacy
   community repair to an explicit, durable migration/job. Give the suggestions
   rail its own Suspense boundary so it cannot hold up primary feed content.
5. **Start feed work on the server.** Render or stream the first feed page under
   a dedicated boundary, using the already validated request identity. Defer
   secondary badges/limits until the primary view paints, or batch their
   bootstrap reads where useful. This can remove the browser hydration → feed
   API waterfall; measure total server rendering time as well as visible paint.
6. **Keep current session isolation.** The hard navigation intentionally drops
   Next's previous account Router Cache. Keep it unless a replacement proves
   account switching cannot expose stale data. Warm the cleanup module before
   submission if cold-chunk traces show a material wait. Do not further reduce
   password cost as the first performance intervention.

The deployed responses consistently reported `cf-placement: remote-SYD`, matching
the configured Sydney database placement. Moving the Worker to India alone
could increase every database hop. An India-region database/Redis migration
could be evaluated separately if the audience is primarily there; current
evidence does not justify promising savings from that migration.

## Validation and remaining evidence

- The optimized build passed. Five successful browser runs reached four painted
  feed cards; returned login/feed responses were successful.
- Very rapid repeated local logins caused one feed HTTP 429 under the global
  limiter. That run was excluded, then remaining samples were paced 11 seconds
  apart. This was test traffic, not evidence of ordinary-user failure.
- Production work was limited to public GETs and three rejected attempts using
  a nonexistent audit identity. No production account or application content was changed.
- No application behavior was changed. The audit adds this report and sanitized
  timing evidence. Local measurement helpers remain under ignored `.local/login-audit/`.
- To establish the actual production total, repeat a successful browser flow
  with a dedicated test account, warm/cold sessions, old/current hashes, and
  representative user networks. Report min/median/range initially and p95 once
  a representative sample exists. Re-run the same measurements after changes;
  the audit does not claim an achieved speedup.

References: [Cloudflare placement and headers](https://developers.cloudflare.com/workers/configuration/placement/),
[Next.js loading boundaries](https://nextjs.org/docs/app/api-reference/file-conventions/loading),
[Server-Timing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing).
