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
from test_initialization import verify_initialization
from test_adoption import verify_adoption


def validate_migrations(root=ROOT):
    files = sorted((root / 'supabase/migrations').glob('*.sql'))
    versions = []
    for path in files:
        match = re.fullmatch(r'(\d{14})_[a-z0-9_]+\.sql', path.name)
        if not match:
            raise ValueError(f'Migration must have a unique 14-digit timestamp: {path.name}')
        datetime.strptime(match[1], '%Y%m%d%H%M%S')
        if match[1] < '20261031163000':
            raise ValueError('Historical SQL must not re-enter the active migration stream')
        versions.append(match[1])
    if not files or len(set(versions)) != len(versions):
        raise ValueError('Missing migrations or duplicate versions')
    if files[0].name != '20261031163000_production_schema_baseline.sql':
        raise ValueError('The production baseline must be the first migration')
    if list((root / 'apps/web/supabase/migrations').glob('*.sql')):
        raise ValueError('Nested historical migration directory is still active')
    return files, versions


def run(args):
    files, versions = validate_migrations()
    lock = ROOT / 'supabase/supabase.lock'
    if not lock.is_file():
        raise RuntimeError('Service lock is missing; resolve and review it before testing')
    expected_version = (ROOT / 'supabase/cli-version').read_text().strip()
    cli = ['bash', str(ROOT / 'scripts/db/cli.sh')]
    # This process must not inherit production credentials, links or libpq settings.
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'SUPABASE_'))}
    env['SUPABASE_EXPERIMENTAL_STACK'] = '1'
    staging = args.production_compatible
    if staging:
        if args.runtime != 'docker':
            raise ValueError('--production-compatible requires Docker (official Supabase PG 17.6 image)')
        env['SUPABASE_EXPERIMENTAL_STACK'] = '0'
        env['SUPABASE_USE_SLIM_IMAGES'] = 'false'
    version = subprocess.check_output(cli + ['--version'], text=True, env=env).strip()
    if version != expected_version:
        raise RuntimeError(f'Expected Supabase CLI {expected_version}; got {version}')
    output = args.report_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='uxc-baseline-'))
    project = work / 'supabase'
    (project / 'migrations').mkdir(parents=True)
    shutil.copy(ROOT / 'supabase/config.toml', project / 'config.toml')
    shutil.copy(lock, project / lock.name)
    if staging:
        # Only the disposable test uses the CLI's upstream-image backend. Its
        # platform bootstrap is Supabase-owned; the application stream is the
        # same single baseline. No project-ref, link, seed or old SQL is copied.
        config = (project / 'config.toml').read_text().replace('project_id = "uxcommunity"', f'project_id = "{work.name}"').replace('stack = true', 'stack = false')
        (project / 'config.toml').write_text(config)
        (project / '.temp').mkdir()
        (project / '.temp/postgres-version').write_text('17.6.1.054@sha256:982abcf1b97c2787f002327d0b30224f1bad819748a22bb1e979bb42dd701a48')
    # Compare the immutable baseline before applying any future migrations.
    for path in files[:1]:
        shutil.copy(path, project / 'migrations' / path.name)
    command = cli + ['--workdir', str(work)]
    log = work / 'private-cli.log'
    started = False
    try:
        print(f'Starting empty disposable Supabase with CLI {version}', flush=True)
        with log.open('w') as stream:
            start_flags = ['--exclude', 'studio,imgproxy,inbucket,logflare,vector,supavisor,edge-runtime'] if staging else ['--runtime', args.runtime, '--exclude', 'studio,mail,analytics,pooler,functions', '--eager', '--frozen']
            result = subprocess.run(command + ['start'] + start_flags, env=env, stdout=stream, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f'Local Supabase start failed; private log: {log}')
        started = True
        status = json.loads(subprocess.check_output(command + ['status', '--output-format', 'json'], env=env, text=True))
        if staging:
            # A unique project/container identity must be owned by this run.
            container = json.loads(subprocess.check_output(['docker', 'inspect', 'supabase_db_' + work.name], text=True))[0]
            if container['Config']['Labels'].get('com.supabase.cli.project') != work.name:
                raise RuntimeError('Staging container identity differs from disposable project')
            status = {'env': status, 'runtime': 'docker-upstream-supabase-17.6'}
        elif Path(status['identity']['project_root']).resolve() != work.resolve():
            raise RuntimeError('CLI returned a different stack; refusing database access')
        url = status['env']['DB_URL']
        if urllib.parse.urlparse(url).hostname not in ('localhost', '127.0.0.1', '::1'):
            raise RuntimeError('Test target is not loopback')
        psql = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--dbname', url]

        def query(sql):
            completed = subprocess.run(psql + ['-A', '-t', '-c', sql], env=env, text=True, capture_output=True)
            if completed.returncode:
                raise RuntimeError('Local SQL failed: ' + completed.stderr)
            return completed.stdout.strip()

        # All migration history reads below are LOCAL only; no remote ledger is queried.
        recorded = json.loads(query("select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations"))
        if recorded != versions[:1]:
            raise RuntimeError(f'Local history differs from active stream: {recorded}')
        fresh = capture(local_url=url)
        (output / 'fresh-catalog.json').write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + '\n')
        source = json.loads((ROOT / 'supabase/schema/production-catalog.json').read_text())
        if staging:
            if fresh['meta']['version'] != source['meta']['version']:
                raise RuntimeError('Staging PostgreSQL version does not match production')
            for field in ('encoding', 'collation', 'ctype'):
                if fresh['database_config'][field] != source['database_config'][field]:
                    raise RuntimeError('Staging locale differs from production: ' + field)
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
        adoption = verify_adoption(psql, query, env, command, project, log, files[0])
        if compare(fresh, capture(local_url=url), exact=True)['unexpected_application_differences']:
            raise RuntimeError('Adoption rehearsal changed application schema')
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
        completed = subprocess.run(psql + ['-f', str(ROOT / 'scripts/db/test_protections.sql')], env=env, capture_output=True, text=True)
        if completed.returncode:
            raise RuntimeError('Protection test failed: ' + completed.stderr)
        if any(int(query('select count(*) from public.' + table)) for table in ('users', 'applications', 'notification_preferences', 'moderation_audit_log')):
            raise RuntimeError('Protection test fixtures were not rolled back')
        initialization = verify_initialization(url, query)
        initialized = capture(local_url=url)
        if compare(fresh, initialized, exact=True)['unexpected_application_differences'] and len(files) == 1:
            raise RuntimeError('Initialization changed application schema')
        if args.sql_tests:
            completed = subprocess.run(psql + ['-c', 'create extension if not exists pgtap with schema extensions'], env=env, capture_output=True, text=True)
            if completed.returncode:
                raise RuntimeError('pgTAP setup failed: ' + completed.stderr)
            failures = []
            for test in args.sql_tests:
                path = Path(test).resolve()
                completed = subprocess.run(psql + ['-A', '-t', '-f', str(path)], env=env, capture_output=True, text=True)
                (output / (path.name + '.tap')).write_text(completed.stdout + completed.stderr)
                plans = re.findall(r'^1\.\.(\d+)\s*$', completed.stdout, re.M)
                assertions = re.findall(r'^(?:not )?ok \d+\b', completed.stdout, re.M)
                if (completed.returncode or re.search(r'^\s*not ok\b', completed.stdout, re.M | re.I)
                        or len(plans) != 1 or len(assertions) != int(plans[0])):
                    failures.append(path.name)
            if failures:
                raise RuntimeError('pgTAP failures: ' + ', '.join(failures) + '; full TAP output: ' + str(output))
        (output / 'verification.json').write_text(json.dumps({
            'cli_version': version, 'runtime': status['runtime'],
            'production_capture': source['meta'], 'fresh_capture': fresh['meta'],
            'migration_versions': recorded,
            'migration_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
            'empty_application_tables': empty, 'storage_bucket_count': 0,
            'protection_behavior_tests': 'passed; fixture transaction rolled back',
            'initialization_tests': initialization,
            'adoption_rehearsal': adoption,
            'sql_tests_passed': [Path(p).name for p in args.sql_tests],
            'stored_routine_validation': 'all public definitions validated with check_function_bodies=on; no RPC invoked',
            'unexpected_application_differences': result['unexpected_application_differences'],
            'platform_difference_count': result['platform_difference_count'],
            'representation_only_count': result['representation_only_count'],
            'production_actions': 'none; comparisons use saved read-only catalog capture',
            'staging_image': container['Config']['Image'] if staging else None,
        }, indent=2) + '\n')
        if not lock.exists():
            raise RuntimeError('Service lock is missing; resolve and review it before testing')
        print(f'PASS: {len(empty)} empty application tables; both protections; no unexpected application drift', flush=True)
        print(f'Full comparison: {output / "schema-comparison.md"}', flush=True)
    finally:
        # Destroy only the uniquely owned throwaway stack, never all local stacks.
        with log.open('a') as stream:
            cleanup_flags = ['stop', '--no-backup'] if staging else ['stack', 'destroy', '--yes']
            cleanup = subprocess.run(command + cleanup_flags, env=env, stdout=stream, stderr=subprocess.STDOUT)
        if started and cleanup.returncode:
            raise RuntimeError('Disposable stack cleanup failed; retained private workdir: ' + str(work))
        if started and not args.keep_workdir:
            shutil.rmtree(work)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', choices=('auto', 'native', 'docker', 'podman'), default='auto')
    parser.add_argument('--report-dir', type=Path, default=ROOT / 'test-results/schema')
    parser.add_argument('--keep-workdir', action='store_true')
    parser.add_argument('--production-compatible', action='store_true', help='Test official Supabase PostgreSQL 17.6 image and require production locale')
    parser.add_argument('sql_tests', nargs='*')
    run(parser.parse_args())
