---
name: Private community archive
description: The intended semantics for removing a community from one member's sidebar.
---

“Delete community” in the member chat UI means archive it for that user, not hard-delete the shared community or its messages. The member remains joined, their visible history is cut off at the archive point, and a later message restores the community in their sidebar.

**Why:** The requested behavior is owner-specific and must not remove the community or messages for other members.

**How to apply:** Keep leave-membership behavior separate. Any future archive changes must preserve server-side membership checks, per-user history filtering, and realtime restoration on a new message.