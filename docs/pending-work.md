# Pending work

Deferred, agreed-upon work that is **not** blocking anything today. Each item
says what the current state is, why it matters, what "done" looks like, and what
to be careful about — so it can be picked up cold, months from now, without
re-deriving the investigation.

Last reviewed: 2026-09-30.

---

## 1. Retire the leftover Vercel site on the bare domain and `www`

**Priority:** cleanup plus one real hardening step. Nothing is broken today.

### Current state (verified 2026-09-30)

The domain answers on three names, served by **two different platforms**:

| Host | Served by | What it answers |
| --- | --- | --- |
| `uxcommunity.in` (apex) | Vercel | `308` redirect to `www` |
| `www.uxcommunity.in` | Vercel | `/` → `200` (the landing page); `/login`, `/dashboard`, `/api/healthz` and every app path → `404` |
| `app.uxcommunity.in` | Cloudflare (`uxcommunity-web`) | the real app |

The apex and `www` are the remains of the pre-Cloudflare deployment. `www`
serves the marketing landing page and nothing else — every app route 404s there.

### Why it matters

1. **It is a live trap for the realtime outage of 2026-09-30.** The realtime
   Worker authorizes community sockets by calling
   `${API_URL}/api/communities/:id/members/:userId/check`. Pointed at `www` or
   the apex, that call gets a `404` instead of the app's `{"ok":true}`, and
   every community socket in the product is refused with a `403` — the exact
   failure that filled the browser console with rejected WebSockets. Confirmed
   during that investigation: the same request answered `404` on `www` and
   `{"ok":true}` on `app`. One origin answering the domain family removes the
   failure mode instead of guarding against it.
2. **Users land on a dead end.** Typing the domain without `app.` shows a page
   whose links lead nowhere: no login, no dashboard, `404` on every path.
3. **Search engines see the same brand on two hosts** answering differently.
4. **The site depends on an account nobody uses any more.** A paused project,
   a billing change or a recycled hostname breaks the bare domain and `www` in a
   way that looks like the product is down.
5. **Two places to deploy a website** (the landing page on one platform, the app
   on Cloudflare) means two dashboards and two ways to break.

### What "done" looks like

- The landing page is served from Cloudflare (next to the app), or the apex and
  `www` redirect to it.
- `uxcommunity.in`, `www.uxcommunity.in` and `app.uxcommunity.in` all answer
  from Cloudflare — the only remaining platform.
- The old project is deleted, so nothing outside Cloudflare answers for the
  domain.
- `NEXT_PUBLIC_APP_URL`, `API_URL` and every other configured origin still name
  `app.uxcommunity.in` (the address the fix of 2026-09-30 corrected).
- `npm run audit:vercel` stays clean — see `scripts/audit-vercel.mjs`, which
  blocks a second deployment target from creeping back into the tree.

### Order of work, and what to be careful about

1. Decide where the landing page should live from now on (the natural home is
   Cloudflare, beside the app).
2. Move that page, and verify it renders on a temporary host **before** touching
   DNS. It is real content — this is a move, not a delete.
3. Repoint the apex and `www` DNS at Cloudflare, with a redirect to the chosen
   destination.
4. Delete the old project.
5. Verify all three names, then update this file.

DNS changes take a few minutes to take effect, so do this when you can watch the
result rather than right before stepping away.

---

## 2. Replace the internal `API_SECRET`

**Priority:** security hardening. Not blocking.

### Current state

The secret that authenticates the realtime Worker's membership check
(`Authorization: Bearer <API_SECRET>` against
`/api/communities/:id/members/:userId/check`) is the string
`test-internal-api-secret-for-local-dev` — a **dev placeholder** that is also the
production value, in three places: the GitHub Actions secret `API_SECRET`
(which the deploy writes into both Workers), `apps/web/.env.local`, and
`apps/realtime/.dev.vars`. Both env files are gitignored and the value has never
been committed, but it is guessable.

Anyone who knows it can ask the app whether **any** `(community, user)` pair is a
member — a membership oracle over the whole database. The endpoint has no other
guard: it answers `401` for a wrong secret and `{"ok":true|false}` for the right
one, which is how the value was confirmed against production in the first place.

### What "done" looks like

- `API_SECRET` is a random value (e.g. `openssl rand -base64 48`) in the GitHub
  secret, `apps/web/.env.local` and `apps/realtime/.dev.vars`, all byte-identical.
- A deploy has run, so both Workers carry the new value.
- The old value returns `401 {"ok":false,"error":"unauthorized"}` from the
  membership endpoint.
- `node scripts/smoke-realtime.mjs --url https://rt.uxcommunity.in` passes,
  including its membership check, which names the wrong secret if the two sides
  ever drift apart again.

### Watch out for

The same value is used by **both** Workers from **one** GitHub secret on
purpose — the web app compares against it and the realtime Worker sends it. A
rotation that updates only one side turns every community socket into a `403`
(`realtime.membership.api_denied` in the Worker's logs names it), so rotate both
together and let the smoke check confirm it.

---

## 3. Confirm the first post-merge deploy

The live Worker's `API_URL` and `API_SECRET` were set by hand on 2026-09-30
(with `wrangler secret put`) to repair production, and the matching GitHub
secrets were corrected immediately after. These now agree, so the next deploy is
a no-op for them.

Worth watching once: the **Deploy to Cloudflare** run after the first merge
should pass its membership check. That check calls the endpoint with the same two
secrets the deploy just pushed, so a green run proves the source of truth (GitHub)
and production are in sync — and a red one names the secret that is wrong
instead of silently shipping a dead realtime layer.

---

## 4. Optional: run the smoke harness's own tests on pull requests

`scripts/smoke-realtime.test.mjs` runs in `deploy.yml` (on push to `main`), so a
mistake in the harness is caught before it is allowed to gate a deploy. Moving
that `node --test` step into `ci.yml` as well would surface it on the pull
request instead, where the diff is.

---

## Background

The realtime outage those fixes came from, and the guardrails that now cover it,
are in pull request #564: a refused community socket logs
`realtime.membership.api_denied` with the status and host that answered, and no
deploy ships while the membership URL or secret cannot reach the app.
