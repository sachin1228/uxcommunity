#!/usr/bin/env python3
"""Capture schema metadata only. Remote access uses Supabase's read-only endpoint."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def capture(*, project_ref=None, local_url=None):
    sql = (Path(__file__).with_name('catalog.sql')).read_text()
    if project_ref:
        token = os.environ['SUPABASE_ACCESS_TOKEN']
        request = urllib.request.Request(
            f'https://api.supabase.com/v1/projects/{project_ref}/database/query/read-only',
            data=json.dumps({'query': sql}).encode(),
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)[0]['snapshot']
        if result['meta']['read_only'] != 'on' or result['meta']['role'] != 'supabase_read_only_user':
            raise RuntimeError('Remote endpoint did not confirm enforced read-only access')
    else:
        parsed = urllib.parse.urlparse(local_url)
        if parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise ValueError('Direct database access is restricted to loopback test databases')
        # Never run psql startup files or inherit a remote service/host configuration.
        env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        env['PGOPTIONS'] = '-c default_transaction_read_only=on -c search_path=public -c statement_timeout=60000'
        completed = subprocess.run(
            ['psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '--dbname', local_url],
            input=sql, text=True, capture_output=True, env=env,
        )
        if completed.returncode:
            raise RuntimeError(completed.stderr)
        result = json.loads(completed.stdout)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--project-ref')
    source.add_argument('--local-url')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = capture(project_ref=args.project_ref, local_url=args.local_url)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f"Captured metadata: {len(data['relations'])} relations, {len(data['routines'])} non-extension routines")
