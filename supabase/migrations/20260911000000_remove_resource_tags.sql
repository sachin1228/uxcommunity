-- Remove the tags column from community_resources.
-- Tags are no longer collected or displayed on resources.

alter table community_resources
  drop column if exists tags;
