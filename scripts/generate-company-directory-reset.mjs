#!/usr/bin/env node

/**
 * Writes the operation that resets the company directory to the v2 dataset.
 *
 *   node scripts/generate-company-directory-reset.mjs [--check]
 *
 * WHY THE v1 SEED IS GOING AWAY
 *   The 4,574 companies the v1 seed wrote were a bootstrap set: real names so
 *   the "Where do you work?" picker was not an empty box on day one, each with
 *   one unproven website domain. They are not the production directory. The
 *   production directory is a ~500,000-company dataset loaded from a generated
 *   CSV export by `scripts/import-company-directory.mjs`, which carries registry
 *   identity and provenance the seed never had. Keeping both would mean the
 *   directory is half a bootstrap list and half a dataset, with no way to tell
 *   them apart afterwards.
 *
 *   The seed's own INSERT statement is gone from the repository (it was
 *   `supabase/migrations/20260929140000_company_directory.sql`, and with it the
 *   generator that produced it and the migration that attributed its domains),
 *   so a database built from this repository creates an EMPTY directory:
 *   companies 0, company_domains 0, claims 0, evidence 0. A database that
 *   already ran those migrations still holds the 4,574 rows — deleting a
 *   migration file does not delete rows — and that is what this operation is
 *   for.
 *
 * WHY THE FILE IS GENERATED FROM THE SEED LAYER
 *   "Delete the 4,574 rows" is only safe if the 4,574 rows can be named, and
 *   they can: by the slugs the seed's own `company_slugify(name)` produced. A
 *   hand-written list would drift the first time the seed changed; reading the
 *   seed's retained copy makes the two files impossible to disagree. The copy is
 *   `data/company-directory/seeds/wikidata-p856.json`, exported from the seed
 *   migration by `--export-seed` before that migration was removed; it was
 *   verified equal to the migration's own list (4,574 names and domains, zero
 *   rows on either side of the difference) at the commit that removed the
 *   migration.
 *
 * WHAT IT WRITES, AND WHY IN THIS SHAPE
 *   * `company_directory_seed_retired` — the seed's own (name, domain) list,
 *     computed into slugs by the database's `company_slugify`, so the record of
 *     what was retired survives the deletion and later queries can ask "was this
 *     company part of the v1 seed?" without parsing a migration.
 *   * `company_directory_seed_retirement_plan()` — per-company: would this row
 *     be removed, and if not, which guard stopped it, with the dependent rows
 *     that would go with it. Read-only. This is the dry run.
 *   * `retire_company_directory_seed(p_dry_run, p_allow_retained)` — the
 *     removal itself, callable again safely, returning counts. It REFUSES to
 *     delete anything while a seeded company is still referenced by application
 *     data (`p_allow_retained => false`, the default), and deletes only the
 *     disposable rows when an operator has reviewed the rest.
 *   * `company_directory_seed_retained` — the seed rows that SURVIVED, with the
 *     reason. A view, so it cannot go stale.
 *
 *   There is deliberately NO self-applying block at the end of the file:
 *   applying the migration used to be the transition, and this is an operation a
 *   person starts with a dry run first.
 *
 *   The guards are the whole point of the file: a company is removable only if
 *   nobody has touched it. `docs/company-directory-reset.md` lists them with the
 *   foreign keys they answer to.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { slugify } from "./generate-company-directory-v2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = join(ROOT, "data/company-directory/seeds/wikidata-p856.json");
const OUT_PATH = join(ROOT, "supabase/reset/company_directory_seed_reset.sql");

/** A single-quoted SQL literal. Names really do contain apostrophes. */
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * The v1 seed's entities, out of the committed seed layer. Exported so the test
 * suite can assert the same file the SQL is generated from.
 */
export function loadSeedEntities(path = SEED_PATH) {
  const seed = JSON.parse(readFileSync(path, "utf8"));
  const entities = seed.entities ?? [];
  if (entities.length !== seed.entity_count) {
    throw new Error(
      `the seed layer says ${seed.entity_count} entities but holds ${entities.length}; ` +
        "regenerate the layer before generating this operation"
    );
  }
  return entities;
}

export function resetSql(entities) {
  const names = entities.map((entity) => entity.name).filter(Boolean);
  const domains = entities.map((entity) => entity.website_domain).filter(Boolean);
  if (names.length !== entities.length || domains.length !== entities.length) {
    throw new Error(
      "the seed layer has an entity without a name or a domain; the seed wrote one " +
        "company and one claim per entry, so this operation would retire the wrong set"
    );
  }
  if (new Set(names).size !== names.length) {
    throw new Error(
      "the seed layer lists a name twice; `company_directory_seed_retired` is keyed by " +
        "name, so duplicates would have to be understood before this operation can be generated"
    );
  }
  // The slug is what identifies a row in the plan, and the SQL computes it with
  // the database's own `company_slugify`. Two names that reduce to one slug would
  // collide on the retired record's unique index, so they are refused here, by
  // computing the same slug the same way the deleted generator did.
  const slugCollisions = new Map();
  for (const name of names) {
    const slug = slugify(name);
    if (slugCollisions.has(slug)) {
      throw new Error(
        `the seed layer's names ${JSON.stringify(slugCollisions.get(slug))} and ` +
          `${JSON.stringify(name)} both slugify to ${slug}`
      );
    }
    slugCollisions.set(slug, name);
  }

  const rows = entities
    .map((entity) => `    (${literal(entity.name)}, ${literal(entity.website_domain)})`)
    .join(",\n");

  return `-- ============================================================
-- OPERATION: reset the company directory to the v2 dataset
--
-- NOT A MIGRATION.
--   This file is not in \`supabase/migrations/\`, so neither \`supabase db push\`
--   nor a fresh \`db reset\` applies it, and a database built from this repository
--   starts with an EMPTY company directory. It is the one-time transition for a
--   database that already ran the v1 seed migration.
--
-- HOW TO RUN IT
--   node scripts/reset-company-directory-seed.mjs            # dry run, no writes
--   node scripts/reset-company-directory-seed.mjs --apply    # the removal
--
-- GENERATED FILE — do not edit by hand.
--   node scripts/generate-company-directory-reset.mjs
--   Source: data/company-directory/seeds/wikidata-p856.json, the retained copy of
--   the v1 seed's own (name, domain) pairs.
--
-- WHAT THIS REMOVES
--   The ${names.length.toLocaleString("en-US")} companies the v1 seed created, and the single
--   unverified website claim each one carries. That data was a bootstrap set for
--   the company picker. The production directory is loaded separately, from a
--   generated CSV export, by scripts/import-company-directory.mjs.
--
-- WHAT IT REFUSES TO REMOVE, EVER
--   A seeded company that anybody has touched stays, and is reported by the
--   \`company_directory_seed_retained\` view with the reason:
--
--     * a member joined it          -> company_members
--     * a proof or a pending code exists for it, or it is the recorded owner of
--       a domain a member proved   -> company_email_verifications
--     * a member's profile points at it -> designer_profiles.company_id
--     * it owns a verified domain   -> company_domains.verified
--     * an operator reviewed it     -> company_domain_reviews
--     * a delegation names it       -> company_domain_delegations
--     * it carries any observation  -> domain_evidence
--     * it carries a claim the seed did not write, or a registry identity, or a
--       provenance another layer set -> company_domains.source / companies.source
--
--   Those are the only foreign keys that point at \`companies\` (12 of them; see
--   docs/company-directory-reset.md). Memberships, verification records, profile
--   pointers and operator decisions are application data, not directory data, and
--   a directory transition may not delete them. A seeded row that a person or an
--   operator has touched is therefore KEPT, loudly — and while one exists, the
--   removal refuses to run at all unless an operator has reviewed it and asks for
--   \`p_allow_retained => true\`, which removes only the disposable rows.
--
-- WHAT IT DOES NOT DO
--   * no \`truncate\`, no \`drop table\`, no unqualified \`delete\`: every delete
--     names the retirement plan as its source;
--   * it deletes nothing outside the seeded companies: a member's company, a
--     company the importer wrote, and every row of the rest of the application
--     are untouched;
--   * it never writes \`verified\`, and never clears it;
--   * it does not touch any company outside the seed's own slug list, and it
--     cannot: the list is the identification.
--
-- IDEMPOTENT AND DETERMINISTIC
--   Re-running it deletes nothing (the rows are gone, and the plan is empty). It
--   is a no-op on a directory that has no seed rows, which is every database
--   built after the seed migration was removed.
--
-- ORDER
--   20260929120000 -> 20260929130000 -> 20260929150000 -> 20260929152000 -> this
--   file. The precondition below enforces the end of that: the plan counts rows
--   in tables the stewardship and review migrations create.
--
-- ROLLBACK
--   The rows are recoverable from the repository's history:
--   \`git show <commit>:supabase/migrations/20260929140000_company_directory.sql | psql\`
--   re-creates companies with the same slugs and the same domains, which is
--   lossless for exactly the rows this operation removes, because "nothing
--   references it" is the condition for removing it.
-- ============================================================


-- ─── Preconditions: the schema this operation plans against ──

-- Without this, a database that has not run the stewardship migration fails with
-- "relation domain_evidence does not exist" from inside a function definition,
-- which says nothing about what to do. The order matters and is worth a sentence.
do $seed_reset_preconditions$
begin
  if to_regclass('public.domain_evidence') is null
     or to_regclass('public.company_domain_delegations') is null
     or to_regclass('public.company_domain_reviews') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'companies' and column_name = 'source'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'seed_reset_needs_stewardship_schema',
      hint = 'apply 20260929150000_company_domain_stewardship.sql, then 20260929152000_company_domain_review.sql, then run this operation';
  end if;
end
$seed_reset_preconditions$;


-- ─── What was retired (the durable record) ──────────────────

-- Not a scratch table: it is how a later query answers "was this company one of
-- the bootstrap rows?" after the rows are gone, and how the retained view names
-- what it kept. Small (a few hundred kilobytes), read-only to clients.
create table if not exists public.company_directory_seed_retired (
  name       text primary key,
  domain     text not null,
  slug       text not null,
  retired_at timestamptz not null default now(),
  constraint company_directory_seed_retired_name_check
    check (char_length(btrim(name)) between 1 and 120),
  constraint company_directory_seed_retired_slug_check
    check (slug ~ '^[a-z0-9][a-z0-9-]*$')
);

create unique index if not exists company_directory_seed_retired_slug_idx
  on public.company_directory_seed_retired (slug);

comment on table public.company_directory_seed_retired is
  'The v1 directory seed''s own (name, domain) list, with the slug its company was created under. Written by supabase/reset/company_directory_seed_reset.sql so the retired rows stay identifiable after they are deleted; never written to again.';

alter table public.company_directory_seed_retired enable row level security;
revoke all on table public.company_directory_seed_retired from anon, authenticated;

-- The slug is computed by the database's own \`company_slugify\`, which is the
-- immutable function the seed used to build the slug in the first place. Doing
-- it in SQL rather than in the generator is what makes the two lists impossible
-- to disagree about what a company's slug was.
insert into public.company_directory_seed_retired (name, domain, slug)
select seed.name, seed.domain, public.company_slugify(seed.name)
from (values
${rows}
) as seed(name, domain)
on conflict (name) do nothing;


-- ─── The plan and the removal (replaced in place) ───────────

-- Dropped rather than replaced: the plan's return type gains columns as the
-- guards are extended, and \`create or replace\` refuses a changed result shape.
-- The view depends on the plan function, so it goes first.
drop view if exists public.company_directory_seed_retained;
drop function if exists public.company_directory_seed_retirement_plan();
drop function if exists public.retire_company_directory_seed(boolean, boolean);


-- ─── What would be removed, and why not (the dry run) ───────

-- One row per seeded company that is still present. \`disposable\` is the whole
-- answer: true means nothing in the database references it, and the only things
-- it holds are its own unverified website claim and any structure the directory
-- layers attached to it.
--
-- Read-only and safe to call on production: it is what an operator runs before
-- applying this operation to see the difference between 4,574 and the number
-- that will actually be removed.
create or replace function public.company_directory_seed_retirement_plan()
returns table (
  company_id         uuid,
  name               text,
  slug               text,
  domain             text,
  disposable         boolean,
  reason             text,
  claims             integer,
  members            integer,
  verifications      integer,
  profile_pointers   integer,
  verified_claims    integer,
  observations       integer,
  aliases            integer,
  relationships      integer,
  reviews            integer,
  delegations        integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with seeded as (
    select retired.slug, retired.name, retired.domain
    from public.company_directory_seed_retired as retired
  ),
  candidate as (
    select
      company.id,
      company.name,
      company.slug,
      company.source,
      company.source_id,
      seeded.domain
    from public.companies as company
    join seeded on seeded.slug = company.slug
    -- A member's company is never a seed row, even when the name matches: the
    -- seed inserted with \`on conflict (slug) do nothing\`, so a company a member
    -- created first is the row that exists and the seed's insert was skipped.
    where company.created_by is null
  ),
  counted as (
    select
      candidate.*,
      (select count(*)::integer from public.company_domains as cd
        where cd.company_id = candidate.id) as claims,
      (select count(*)::integer from public.company_members as m
        where m.company_id = candidate.id) as members,
      (select count(*)::integer from public.company_email_verifications as v
        where v.company_id = candidate.id
           or v.domain_owner_company_id = candidate.id) as verifications,
      (select count(*)::integer from public.designer_profiles as p
        where p.company_id = candidate.id) as profile_pointers,
      (select count(*)::integer from public.company_domains as cd
        where cd.company_id = candidate.id and cd.verified) as verified_claims,
      (select count(*)::integer from public.domain_evidence as e
        where e.company_id = candidate.id) as observations,
      -- Structure the directory layers attached. NOT a guard: an alias or a
      -- relationship is directory data and goes with the company. It is reported
      -- so the dry run can say what the removal takes with it.
      (select count(*)::integer from public.company_aliases as a
        where a.company_id = candidate.id) as aliases,
      (select count(*)::integer from public.company_relationships as rel
        where rel.parent_company_id = candidate.id
           or rel.child_company_id = candidate.id) as relationships,
      (select count(*)::integer from public.company_domain_reviews as r
        where r.company_id = candidate.id) as reviews,
      (select count(*)::integer from public.company_domain_delegations as g
        where g.company_id = candidate.id or g.granted_by = candidate.id) as delegations,
      -- Claims that are not the seed's own pairing. The seed wrote exactly ONE
      -- claim per company: this company, this domain, unproved, with no
      -- provenance (or the provenance the optional attribution migration gave
      -- it). Anything else on the row came from another layer or an operator — a
      -- second domain, or a source somebody set — and that is a touch like any
      -- other.
      --
      -- A NULL source is the seed's own claim, deliberately: the attribution
      -- migration was applied to some databases and not others, and the
      -- un-attributed shape must still be removable, or the reset would refuse
      -- to run over the entire seed.
      (select count(*)::integer from public.company_domains as cd
        where cd.company_id = candidate.id
          and (cd.domain <> candidate.domain
               or (cd.source is not null and cd.source <> 'wikidata-p856'))) as alien_claims
    from candidate
  )
  select
    counted.id,
    counted.name,
    counted.slug,
    counted.domain,
    -- Every guard at once. The order of the reason is the order a person would
    -- ask about them: a member first, then a proof, then an operator's work.
    (counted.members = 0
      and counted.verifications = 0
      and counted.profile_pointers = 0
      and counted.verified_claims = 0
      and counted.observations = 0
      and counted.reviews = 0
      and counted.delegations = 0
      and counted.alien_claims = 0
      and (counted.source is null or counted.source = 'wikidata-p856')
      and counted.source_id is null) as disposable,
    case
      when counted.members > 0 then 'member_joined'
      when counted.verifications > 0 then 'member_verification'
      when counted.profile_pointers > 0 then 'member_profile_points_at_it'
      when counted.verified_claims > 0 then 'owns_a_verified_domain'
      when counted.observations > 0 then 'carries_observations'
      when counted.reviews > 0 then 'operator_reviewed'
      when counted.delegations > 0 then 'delegation_names_it'
      when counted.alien_claims > 0 then 'claim_the_seed_did_not_write'
      when counted.source is not null and counted.source <> 'wikidata-p856' then 'another_layer_owns_it'
      when counted.source_id is not null then 'has_a_registry_identity'
      else null
    end,
    counted.claims,
    counted.members,
    counted.verifications,
    counted.profile_pointers,
    counted.verified_claims,
    counted.observations,
    counted.aliases,
    counted.relationships,
    counted.reviews,
    counted.delegations
  from counted
  order by counted.slug;
$$;

comment on function public.company_directory_seed_retirement_plan() is
  'Per seeded company still present: whether nothing references it (disposable), which guard stops its removal when something does, and what would go with it. Read-only; the dry run before applying the reset.';

revoke all on function public.company_directory_seed_retirement_plan() from public, anon, authenticated;
grant execute on function public.company_directory_seed_retirement_plan() to service_role;


-- ─── What was kept, and why (a view, so it cannot go stale) ──

create or replace view public.company_directory_seed_retained as
select
  plan.slug,
  plan.name,
  plan.domain,
  plan.company_id,
  plan.reason,
  plan.claims,
  plan.members,
  plan.verifications,
  plan.profile_pointers,
  plan.verified_claims,
  plan.observations,
  plan.aliases,
  plan.relationships,
  plan.reviews,
  plan.delegations
from public.company_directory_seed_retirement_plan() as plan
where not plan.disposable;

comment on view public.company_directory_seed_retained is
  'Seeded companies the reset refused to delete because a person or an operator had touched them, with the reason. Expected to be empty; each row is a decision for an operator, never a silent deletion.';

revoke all on public.company_directory_seed_retained from anon, authenticated;
grant select on public.company_directory_seed_retained to service_role;


-- ─── The removal ────────────────────────────────────────────

-- Callable again safely, and callable in dry-run mode: \`true\` returns the
-- counts without deleting anything.
--
-- \`p_allow_retained\` is the operator's acknowledgement. While a seeded company
-- that application data references is still present, the removal refuses to run
-- with the default (false) — a directory transition must not quietly leave half a
-- migration's worth of rows behind, and it must not delete the referenced ones
-- either. An operator reviews \`company_directory_seed_retained\` first, then asks
-- for the disposable rows to go.
--
-- The deletes are explicit and ordered, one table at a time, rather than left to
-- the foreign keys' ON DELETE CASCADE. Cascade would also work — every guard
-- above is exactly the set of references that must not cascade — but a transition
-- that removes production rows should name each table it empties and report the
-- row count, so the log is the evidence.
create or replace function public.retire_company_directory_seed(
  p_dry_run boolean default false,
  p_allow_retained boolean default false
)
returns table (
  companies_removed  bigint,
  claims_removed     bigint,
  dependents_removed bigint,
  companies_retained bigint,
  dry_run            boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_companies  bigint := 0;
  v_claims     bigint := 0;
  v_dependents bigint := 0;
  v_step       bigint;
  v_retained   bigint;
begin
  -- \`on commit drop\` already cleans up a successful call, and a failed one
  -- rolls its CREATE back; this guard only covers a rerun in one session, and it
  -- is written so it does not print a NOTICE into an operator's log.
  if to_regclass('pg_temp._seed_retirement_plan') is not null then
    drop table _seed_retirement_plan;
  end if;

  create temporary table _seed_retirement_plan on commit drop as
    select plan.company_id
    from public.company_directory_seed_retirement_plan() as plan
    where plan.disposable;

  -- Seeded rows still present that the plan refuses to remove. A member's
  -- company that happens to share a seed slug is not a seeded row, so it is not
  -- counted here (the plan excludes it by \`created_by\`).
  select count(*) into v_retained
  from public.company_directory_seed_retirement_plan() as plan
  where not plan.disposable;

  if p_dry_run then
    return query select
      (select count(*) from _seed_retirement_plan)::bigint,
      (select count(*)::bigint from public.company_domains as cd
        where cd.company_id in (select company_id from _seed_retirement_plan)),
      (select count(*)::bigint from public.domain_evidence as e
        where e.company_id in (select company_id from _seed_retirement_plan))
      + (select count(*)::bigint from public.company_aliases as a
        where a.company_id in (select company_id from _seed_retirement_plan))
      + (select count(*)::bigint from public.company_relationships as rel
        where rel.parent_company_id in (select company_id from _seed_retirement_plan)
           or rel.child_company_id in (select company_id from _seed_retirement_plan))
      + (select count(*)::bigint from public.company_domain_delegations as g
        where g.company_id in (select company_id from _seed_retirement_plan)
           or g.granted_by in (select company_id from _seed_retirement_plan))
      + (select count(*)::bigint from public.company_domain_reviews as r
        where r.company_id in (select company_id from _seed_retirement_plan)),
      v_retained,
      true;
    drop table _seed_retirement_plan;
    return;
  end if;

  -- The operator's gate. Nothing has been deleted at this point.
  if v_retained > 0 and not p_allow_retained then
    raise exception using
      errcode = 'P0001',
      message = 'seed_reset_retained_rows_present',
      hint = format(
        '%s seeded companies are referenced by application data; review public.company_directory_seed_retained, then re-run with p_allow_retained => true to remove only the disposable rows',
        v_retained
      );
  end if;

  -- Belt and braces, in the one direction that matters: refuse the whole
  -- transition if a row the plan called disposable is referenced after all. The
  -- guards above already exclude these, so this can only fire if the plan and
  -- the deletes ever disagree — and then the right answer is to stop, not to
  -- delete a member's company.
  if exists (
    select 1 from public.company_members as m
     where m.company_id in (select company_id from _seed_retirement_plan)
    union all
    select 1 from public.company_email_verifications as v
     where v.company_id in (select company_id from _seed_retirement_plan)
        or v.domain_owner_company_id in (select company_id from _seed_retirement_plan)
    union all
    select 1 from public.designer_profiles as p
     where p.company_id in (select company_id from _seed_retirement_plan)
    union all
    select 1 from public.company_domains as cd
     where cd.company_id in (select company_id from _seed_retirement_plan) and cd.verified
  ) then
    raise exception using errcode = 'P0001', message = 'seed_retirement_would_touch_member_data';
  end if;

  delete from public.company_domains as cd
   where cd.company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_claims := v_claims + v_step;

  delete from public.domain_evidence as e
   where e.company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  delete from public.company_aliases as a
   where a.company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  delete from public.company_relationships as rel
   where rel.parent_company_id in (select company_id from _seed_retirement_plan)
      or rel.child_company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  delete from public.company_domain_delegations as g
   where g.company_id in (select company_id from _seed_retirement_plan)
      or g.granted_by in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  delete from public.company_domain_reviews as r
   where r.company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  -- Last, and with the identity guard repeated: these are the rows this whole
  -- operation is about, so the predicate is stated where it deletes.
  delete from public.companies as c
   where c.id in (select company_id from _seed_retirement_plan)
     and c.created_by is null;
  get diagnostics v_step = row_count;
  v_companies := v_companies + v_step;

  drop table _seed_retirement_plan;

  return query select v_companies, v_claims, v_dependents, v_retained, false;
end;
$$;

comment on function public.retire_company_directory_seed(boolean, boolean) is
  'Removes the v1 seed''s companies and their unverified claims, and nothing else. Every other referencing table is a guard: a seeded row a member or an operator has touched is kept and reported by company_directory_seed_retained, and while one exists the removal raises unless p_allow_retained is true. Call with p_dry_run => true for the counts without deleting.';

revoke all on function public.retire_company_directory_seed(boolean, boolean) from public, anon, authenticated;
grant execute on function public.retire_company_directory_seed(boolean, boolean) to service_role;
`;
}

function main() {
  const entities = loadSeedEntities();
  const sql = resetSql(entities);

  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT_PATH, "utf8");
    if (current !== sql) {
      console.error(
        "the committed reset operation does not match the seed layer; " +
          "run `node scripts/generate-company-directory-reset.mjs` and commit the result"
      );
      process.exitCode = 1;
      return;
    }
    console.log(`reset operation matches the seed layer (${entities.length} companies)`);
    return;
  }

  writeFileSync(OUT_PATH, sql);
  console.log(
    `Wrote ${OUT_PATH.replace(`${ROOT}/`, "")} (${entities.length} companies, ${sql.length} bytes)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
