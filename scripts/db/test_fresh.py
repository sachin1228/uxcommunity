#!/usr/bin/env python3
"""Boot a new unlinked Supabase stack, apply only active migrations, and compare schemas."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.parse

from capture import ROOT, capture
from compare import compare, write_report


def validate_migrations():
    files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    versions = []
    # Prove the frozen baseline against production before applying future changes.
    for path in files[:1]:
        match = re.fullmatch(r'(\d{14})_[a-z0-9_]+\.sql', path.name)
        if not match:
            raise ValueError(f'Migration must have a unique 14-digit timestamp: {path.name}')
        datetime.strptime(match[1], '%Y%m%d%H%M%S')
        if match[1] < '20261031163000':
            raise ValueError('Historical SQL must not re-enter the active migration stream')
        versions.append(match[1])
    if not files or len(set(versions)) != len(versions):
        raise ValueError('Missing migrations or duplicate versions')
    if list((ROOT / 'apps/web/supabase/migrations').glob('*.sql')):
        raise ValueError('Nested historical migration directory is still active')
    return files, versions


def run(args):
    files, versions = validate_migrations()
    expected_version = (ROOT / 'supabase/cli-version').read_text().strip()
    cli = ['bash', str(ROOT / 'scripts/db/cli.sh')]
    # This process must not inherit production credentials, links or libpq settings.
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_'))}
    env['SUPABASE_EXPERIMENTAL_STACK'] = '1'
    version = subprocess.check_output(cli + ['--version'], text=True, env=env).strip()
    if version != expected_version:
        raise RuntimeError(f'Expected Supabase CLI {expected_version}; got {version}')
    output = args.report_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='uxc-baseline-'))
    project = work / 'supabase'
    (project / 'migrations').mkdir(parents=True)
    shutil.copy(ROOT / 'supabase/config.toml', project / 'config.toml')
    lock = ROOT / 'supabase/supabase.lock'
    if lock.exists():
        shutil.copy(lock, project / lock.name)
    for path in files:
        shutil.copy(path, project / 'migrations' / path.name)
    command = cli + ['--workdir', str(work)]
    log = work / 'private-cli.log'
    started = False
    try:
        print(f'Starting empty disposable Supabase with CLI {version}', flush=True)
        with log.open('w') as stream:
            result = subprocess.run(command + ['start', '--runtime', args.runtime, '--exclude', 'studio,mail,analytics,pooler,functions', '--eager'] + (['--frozen'] if lock.exists() else []), env=env, stdout=stream, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f'Local Supabase start failed; private log: {log}')
        started = True
        status = json.loads(subprocess.check_output(command + ['status', '--output-format', 'json'], env=env, text=True))
        if Path(status['identity']['project_root']).resolve() != work.resolve():
            raise RuntimeError('CLI returned a different stack; refusing database access')
        url = status['env']['DB_URL']
        if urllib.parse.urlparse(url).hostname not in ('localhost', '127.0.0.1', '::1'):
            raise RuntimeError('Test target is not loopback')
        psql = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--dbname', url]

        def query(sql):
            return subprocess.check_output(psql + ['-A', '-t', '-c', sql], env=env, text=True).strip()

        # All migration history reads below are LOCAL only; no remote ledger is queried.
        recorded = json.loads(query("select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations"))
        if recorded != versions[:1]:
            raise RuntimeError(f'Local history differs from active stream: {recorded}')
        fresh = capture(local_url=url)
        (output / 'fresh-catalog.json').write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + '\n')
        source = json.loads((ROOT / 'supabase/schema/production-catalog.json').read_text())
        result = compare(source, fresh)
        write_report(result, output)
        if result['unexpected_application_differences'] or not result['intended_protections_present']:
            raise RuntimeError('Schema comparison failed; see the complete report')
        empty = {}
        for row in fresh['relations']:
            if row['schema'] == 'public' and row['kind'] in ('r', 'p'):
                name = '"' + row['name'].replace('"', '""') + '"'
                empty[row['name']] = int(query('select count(*) from public.' + name))
        if any(empty.values()):
            raise RuntimeError('Baseline inserted application rows')
        if int(query('select count(*) from storage.buckets')):
            raise RuntimeError('Fresh baseline created storage buckets')
        # Validate stored bodies after all dependent views/tables exist. No RPC
        # is invoked, and the validation transaction is rolled back.
        definitions = '\n'.join(r['definition'].rstrip(';\n') + ';' for r in fresh['routines'] if r['schema'] == 'public')
        completed = subprocess.run(psql, input='begin; set local check_function_bodies=on;\n' + definitions + '\nrollback;', env=env, capture_output=True, text=True)
        if completed.returncode:
            raise RuntimeError('Stored routine validation failed: ' + completed.stderr)
        if len(files) > 1:
            for path in files[1:]:
                shutil.copy(path, project / 'migrations' / path.name)
            with log.open('a') as stream:
                completed = subprocess.run(command + ['migration', 'up', '--local', '--yes'], env=env, stdout=stream, stderr=subprocess.STDOUT)
            if completed.returncode:
                raise RuntimeError('Forward migration failed; private log: ' + str(log))
            current = capture(local_url=url)
            (output / 'current-catalog.json').write_text(json.dumps(current, indent=2, ensure_ascii=False) + '\n')
        recorded = json.loads(query("select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations"))
        if recorded != versions:
            raise RuntimeError('Forward migration history differs from active files')
        subprocess.run(psql + ['-f', str(ROOT / 'scripts/db/test_protections.sql')], env=env, check=True, capture_output=True, text=True)
        if any(int(query('select count(*) from public.' + table)) for table in ('users', 'applications', 'notification_preferences', 'moderation_audit_log')):
            raise RuntimeError('Protection test fixtures were not rolled back')
        if args.sql_tests:
            subprocess.run(psql + ['-c', 'create extension if not exists pgtap'], env=env, check=True, capture_output=True)
            for test in args.sql_tests:
                path = Path(test).resolve()
                completed = subprocess.run(psql + ['-f', str(path)], env=env, check=True, capture_output=True, text=True)
                if re.search(r'^\s*not ok\b', completed.stdout, re.M | re.I):
                    raise RuntimeError('pgTAP assertion failure in ' + str(path))
        (output / 'verification.json').write_text(json.dumps({
            'cli_version': version, 'runtime': status['runtime'],
            'production_capture': source['meta'], 'fresh_capture': fresh['meta'],
            'migration_versions': recorded,
            'migration_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
            'empty_application_tables': empty, 'storage_bucket_count': 0,
            'protection_behavior_tests': 'passed; fixture transaction rolled back',
            'stored_routine_validation': 'all public definitions validated with check_function_bodies=on; no RPC invoked',
            'unexpected_application_differences': result['unexpected_application_differences'],
            'platform_difference_count': result['platform_difference_count'],
            'representation_only_count': result['representation_only_count'],
            'production_actions': 'none; comparisons use saved read-only catalog capture',
        }, indent=2) + '\n')
        if not lock.exists():
            raise RuntimeError('Service lock is missing; resolve and review it before testing')
        print(f'PASS: {len(empty)} empty application tables; both protections; no unexpected application drift', flush=True)
        print(f'Full comparison: {output / "schema-comparison.md"}', flush=True)
    finally:
        # Destroy only the uniquely owned throwaway stack, never all local stacks.
        with log.open('a') as stream:
            cleanup = subprocess.run(command + ['stack', 'destroy', '--yes'], env=env, stdout=stream, stderr=subprocess.STDOUT)
        if started and cleanup.returncode:
            raise RuntimeError('Disposable stack cleanup failed; retained private workdir: ' + str(work))
        if started and not args.keep_workdir:
            shutil.rmtree(work)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', choices=('auto', 'native', 'docker', 'podman'), default='auto')
    parser.add_argument('--report-dir', type=Path, default=ROOT / 'test-results/schema')
    parser.add_argument('--keep-workdir', action='store_true')
    parser.add_argument('sql_tests', nargs='*')
    run(parser.parse_args())
