-- Join requests can carry an optional message from the requester.
--
-- The homepage community preview asks for one when a member requests a private
-- community from the feed, and admins see it in the members tab next to the
-- request. Requests raised elsewhere (the Explore page) simply leave it null.

alter table public.community_join_requests
  add column if not exists request_message text;

-- Cap the free-text note the same way the chat caps messages.
alter table public.community_join_requests
  add constraint community_join_requests_message_len_check
  check (char_length(request_message) <= 500);
