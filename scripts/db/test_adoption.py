"""Rehearse the documented ledger transaction exclusively on a disposable stack."""
import hashlib
import json
import re
import subprocess

from capture import ROOT


def verify_adoption(psql, query, env, command, project, log, baseline):
    doc = (ROOT / 'docs/database-baseline.md').read_text()
    blocks = re.findall(r'```sql\n(.*?)```', doc, re.S)
    # Dedent Markdown without maintaining a second copy of the adoption SQL.
    block = next(b for b in blocks if 'set local uxcommunity.baseline_sha256' in b)
    digest = hashlib.sha256(baseline.read_bytes()).hexdigest()
    # Five synthetic entries, not production's versions/statements. Include an
    # application row to prove adoption does not touch populated tables.
    query("""begin;
        delete from supabase_migrations.schema_migrations;
        insert into supabase_migrations.schema_migrations(version,name,statements)
        select '2026010100000'||n::text,'local_rehearsal',array['-- synthetic local ledger']
          from generate_series(1,5) n;
        insert into public.users(name,email,password_hash)
          values ('Adoption rehearsal','adoption@example.test','fixture-only');
        commit;""")
    old = query("select md5(coalesce(jsonb_agg(to_jsonb(m) order by m.version)::text,'[]')) from supabase_migrations.schema_migrations m")
    sql = block.replace('REPLACE_WITH_REVIEWED_64_HEX_SHA256', digest)
    rejected = sql.replace('REPLACE_WITH_REVIEWED_32_HEX_MD5', '0' * 32)
    result = subprocess.run(psql, input=rejected, env=env, text=True, capture_output=True)
    if result.returncode == 0 or 'Ledger differs from the approved secured export' not in result.stderr:
        raise RuntimeError('Adoption did not reject the wrong ledger digest')
    if query('select count(*) from supabase_migrations.schema_migrations') != '5':
        raise RuntimeError('Failed adoption modified the old ledger')
    result = subprocess.run(psql, input=sql.replace('REPLACE_WITH_REVIEWED_32_HEX_MD5', old), env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Documented local adoption rehearsal failed: ' + result.stderr)
    if query('select count(*) from public.users') != '1':
        raise RuntimeError('Adoption affected application rows')
    actual = json.loads(query("select jsonb_agg(version) from supabase_migrations.schema_migrations"))
    if actual != ['20261031163000']:
        raise RuntimeError('Adoption did not establish exactly one baseline entry')
    # The real pinned CLI must apply a later file without re-running baseline
    # DDL against this populated schema. Its guard would fail if replayed.
    forward = project / 'migrations/20261101000000_adoption_rehearsal.sql'
    forward.write_text('create table public.baseline_forward_rehearsal(id integer primary key);\n')
    try:
        with log.open('a') as stream:
            result = subprocess.run(command + ['migration', 'up', '--local', '--yes'], env=env, stdout=stream, stderr=subprocess.STDOUT)
        if result.returncode or query("select to_regclass('public.baseline_forward_rehearsal') is not null") != 't':
            raise RuntimeError('Forward migration after adoption failed; private log: ' + str(log))
        if query('select count(*) from public.users') != '1':
            raise RuntimeError('Forward application affected existing fixture rows')
    finally:
        forward.unlink()
    # Only disposable fixtures are cleaned up. No archived SQL is referenced.
    query("""begin;
        drop table public.baseline_forward_rehearsal;
        delete from supabase_migrations.schema_migrations where version='20261101000000';
        delete from public.users where email='adoption@example.test';
        commit;""")
    return 'passed: documented SQL, wrong-digest rollback, five synthetic entries to one baseline, populated rows preserved, real CLI forward migration without baseline replay'
