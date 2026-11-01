#!/usr/bin/env python3
"""Explicit insert-only initialization of an unlinked local Supabase environment."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.parse

from capture import ROOT

CATALOGS = ('cities', 'design_sectors', 'experience_levels', 'job_titles')
PERIODS = dict(posts_daily='day', events_monthly='month', jobs_monthly='month',
               dms_monthly='month', communities_total='total', community_joins='standing')


def load_inputs(config, catalogs, include_levels=False):
    """Reject incomplete inputs before any database connection or write."""
    if not isinstance(config, dict) or set(config) != {'creation_limits', 'verification_settings'}:
        raise ValueError('Configuration must contain creation_limits and verification_settings only')
    limits = config['creation_limits']
    if not isinstance(limits, list) or len(limits) != 6 or not all(isinstance(r, dict) for r in limits):
        raise ValueError('All six creation budgets are required')
    if {r.get('kind') for r in limits} != set(PERIODS):
        raise ValueError('Creation budget kinds must match the current application')
    for row in limits:
        if set(row) != {'kind', 'limit_count', 'period'} or type(row['limit_count']) is not int or not 0 < row['limit_count'] < 2147483648 or row['period'] != PERIODS[row['kind']]:
            raise ValueError('Invalid creation budget: ' + str(row))
    setting = config['verification_settings']
    if not isinstance(setting, dict) or set(setting) != {'id', 'grace_days'} or setting['id'] is not True or type(setting['grace_days']) is not int or not 0 <= setting['grace_days'] <= 30:
        raise ValueError('Verification setting requires id=true and grace_days between 0 and 30')
    if not isinstance(catalogs, dict) or set(catalogs) != set(CATALOGS) or not all(isinstance(rows, list) for rows in catalogs.values()):
        raise ValueError('Catalog input must contain cities, design_sectors, experience_levels, job_titles')
    catalogs = {key: list(rows) for key, rows in catalogs.items()}
    if include_levels:
        if catalogs['experience_levels']:
            raise ValueError('Choose supplied experience levels OR --include-default-experience-levels')
        catalogs['experience_levels'] = json.loads((ROOT / 'supabase/initialization/experience-levels.json').read_text())
    for table, rows in catalogs.items():
        if not rows:
            raise ValueError(f'{table}: supply at least one active option; no catalog values are guessed')
        keys = []
        for row in rows:
            columns = {'name', 'slug'} if table in ('experience_levels', 'job_titles') else {'name'}
            if not isinstance(row, dict) or set(row) != columns or not isinstance(row['name'], str) or not 1 <= len(row['name'].strip()) <= 100 or row['name'] != row['name'].strip():
                raise ValueError(f'{table}: expected a trimmed name (1–100 characters)' + (' and slug' if 'slug' in columns else ''))
            if 'slug' in columns and (not isinstance(row['slug'], str) or not re.fullmatch(r'[a-z0-9]+(?:_[a-z0-9]+)*', row['slug'])):
                raise ValueError(f'{table}: invalid slug')
            keys.append(row.get('slug', row['name']))
        if len(set(keys)) != len(keys):
            raise ValueError(f'{table}: duplicate input keys')
    return {**config, **catalogs}


def initialization_sql(inputs):
    # All identifiers/types below are fixed. JSON is a SQL string literal with
    # quotes escaped; standard_conforming_strings prevents backslash escapes.
    groups = [('creation_limits', ('kind', 'limit_count', 'period'), 'kind', 'text,integer,text'),
              ('verification_settings', ('id', 'grace_days'), 'id', 'boolean,integer')]
    groups += [(t, ('slug', 'name') if t in ('experience_levels', 'job_titles') else ('name',),
                'slug' if t in ('experience_levels', 'job_titles') else 'name',
                'text,text' if t in ('experience_levels', 'job_titles') else 'text') for t in CATALOGS]
    sql = ["begin; set local lock_timeout='2s'; set local statement_timeout='30s'; set local standard_conforming_strings=on;",
           "select pg_advisory_xact_lock(hashtextextended('uxcommunity:initialize',0));"]
    for table, cols, key, types in groups:
        rows = inputs[table] if table != 'verification_settings' else [inputs[table]]
        literal = "'" + json.dumps(rows, ensure_ascii=False).replace("'", "''") + "'::jsonb"
        definitions = ','.join(f'{c} {t}' for c, t in zip(cols, types.split(',')))
        names = ','.join(cols)
        sql += [f'insert into public.{table} ({names}) select {names} from jsonb_to_recordset({literal}) as i({definitions}) on conflict ({key}) do nothing;']
        differences = ' or '.join(f't.{c} is distinct from i.{c}' for c in cols)
        if table in CATALOGS:
            differences += ' or not t.is_active'
        # A conflict aborts the whole transaction, including newly inserted rows.
        # It cannot silently reset an administrator's values or reactivate options.
        body = f"begin if exists(select 1 from jsonb_to_recordset({literal}) as i({definitions}) join public.{table} t using ({key}) where {differences}) then raise exception 'Initialization conflict in {table}; existing values preserved. Review inputs; no rows committed.'; end if; end"
        # Quote the entire DO body too: an operator-supplied name can contain
        # dollar delimiters, apostrophes or backslashes without becoming SQL.
        sql += ["do '" + body.replace("'", "''") + "';"]
    sql += ['commit;']
    return '\n'.join(sql)


def initialize(local_url, inputs):
    if urllib.parse.urlparse(local_url).hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise ValueError('Initialization accepts only the verified local Supabase stack')
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_'))}
    result = subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--dbname', local_url],
                            input=initialization_sql(inputs), env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'supabase/initialization/required.json')
    parser.add_argument('--catalogs', type=Path, required=True)
    parser.add_argument('--include-default-experience-levels', action='store_true')
    args = parser.parse_args()
    inputs = load_inputs(json.loads(args.config.read_text()), json.loads(args.catalogs.read_text()), args.include_default_experience_levels)
    if any((ROOT / path).exists() for path in ('supabase/.temp/project-ref', 'supabase/.link.json')):
        raise RuntimeError('Remove the old local project link before initializing a fresh environment')
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_'))}
    status = json.loads(subprocess.check_output(['bash', str(ROOT / 'scripts/db/cli.sh'), 'status', '--output-format', 'json'], env=env, text=True))
    if Path(status['identity']['project_root']).resolve() != ROOT:
        raise RuntimeError('CLI returned a different local project; refusing initialization')
    initialize(status['env']['DB_URL'], inputs)
    print('Initialized required configuration and supplied signup catalogs. Existing matching rows retained; optional content untouched.')
