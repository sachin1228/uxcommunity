alter table community_events
  add column if not exists cover_image_url text
    check (cover_image_url is null or char_length(cover_image_url) <= 2048);
