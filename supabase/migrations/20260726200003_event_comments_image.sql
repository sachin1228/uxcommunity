-- Add optional image attachment to event comments
alter table event_comments
  add column if not exists image_url text check (image_url is null or char_length(image_url) <= 2048);
