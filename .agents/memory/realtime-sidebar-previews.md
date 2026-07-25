---
name: Realtime sidebar previews
description: Durable rules for keeping reaction-driven community sidebar previews synchronized.
---

Sidebar reaction previews are derived from community-wide reaction events, not only from the latest message. Each preview must retain the reacted message identity and reaction timestamp so delayed message/name lookups cannot overwrite a newer reaction or clear the wrong preview.

**Why:** Reactions can target older messages, and Supabase Realtime plus asynchronous lookups can deliver related updates out of order.

**How to apply:** When changing reaction preview behavior, handle INSERT, UPDATE, and DELETE events, select the newest reaction per community on refresh, and compare message identity plus event time before applying async results.