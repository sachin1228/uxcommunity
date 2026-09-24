---
title: "Add For You / Your Communities feed filter and remove sidebar beta notice"
---

## Summary

The homepage feed gets a real feed-source switcher, and a few pieces of dead/vibrating UI go away:

- **For You / Your Communities filter now works.** "For You" shows every public post as before; "Your Communities" restricts the feed to communities the member belongs to. Enforced server-side via a new optional `p_member_only` argument on `get_home_feed_page` (migration `20260924120000_home_feed_member_scope.sql`, already applied to the linked project — its migration history diverged from local files long ago, so `db push` can't be used; the file was applied with `supabase db query --linked`). Scope is part of the request-cache key and the server-side `unstable_cache`, the member's choice persists in localStorage (hydration-safe), and "Load older posts" keeps the active scope in its cursor URL.
- **Removed the glow** trailing the filter pill (component + `--filter-glow` token in both themes).
- **Removed the WhatsApp beta notice** from the sidebar along with its dismissal store (`lib/beta-notice.ts`) and `WhatsAppIcon` — both were single-use.
- **Fixed notification bodies not clamping to 2 lines**: a `block` class was overriding line-clamp's `display: -webkit-box`, so full 500-char bodies rendered. Verified in the running app (long bodies now clamp to exactly 2 lines).

## Notes for reviewers

- The old 3-arg `get_home_feed_page` overload remains (default `p_member_only = false`), so the Expo app's existing calls are unaffected.
- Unknown `scope` values degrade to `all` rather than erroring, so stale clients keep working.
- ⚠️ Repo-wide heads-up (pre-existing, not from this PR): the remote `supabase_migrations` table only records 1 migration while the repo has ~100, so `supabase db push` fails. Worth reconciling with `migration repair` or a squashed baseline in a follow-up.

## Test plan

- [x] `tsc --noEmit` clean for all touched files
- [x] Migration applied to the linked Supabase project; both scopes verified by executing the RPC directly (5 rows each for a member user)
- [x] Scope switcher verified in the running dev app: For You / Your Communities return different item sets, choice survives reload
- [x] Notification clamping verified in the running dev app (DOM probe: long bodies = exactly 2 lines)
- [ ] SQL tests: `npm run test:rpc-integration` (needs the pgtap fixture DB; signature + member-only-exclusion tests updated in `supabase/tests/performance_rpcs.test.sql`)

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
