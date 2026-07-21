---
name: Profile page migration
description: The profile page requires new columns on designer_profiles that must be applied in Supabase before the page works fully.
---

The profile page (`/dashboard/profile`) requires three new columns on `designer_profiles`:
- `linkedin_url text`
- `portfolio_url text`
- `bio text`

Migration file: `apps/web/supabase/migrations/20260721_profile_links.sql`

**Why:** The original schema only stored these on the `applications` table. The profile page lets users update them independently, so they need to live on `designer_profiles`.

**How to apply:** User must run the migration SQL in Supabase SQL editor (or via Supabase CLI `supabase db push`). Until applied, the profile page loads but linkedin/portfolio/bio fields will be empty and saves to those fields will fail silently.

**Auth pattern:** All profile API routes live at `/api/profile/*` and use `requireSession("user")`.
