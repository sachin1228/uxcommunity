#!/usr/bin/env python3
"""Render the captured live application schema, without table data or history SQL."""
import argparse
import json
from pathlib import Path


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def qualified(row):
    return ident(row['schema']) + '.' + ident(row['name'])


RIGHTS = {'a': 'INSERT', 'r': 'SELECT', 'w': 'UPDATE', 'd': 'DELETE',
          'D': 'TRUNCATE', 'x': 'REFERENCES', 't': 'TRIGGER', 'm': 'MAINTAIN',
          'X': 'EXECUTE', 'U': 'USAGE', 'C': 'CREATE', 'c': 'CONNECT', 'T': 'TEMPORARY'}


def acl_entries(value):
    if not value:
        return []
    result = []
    for entry in value.strip('{}').split(','):
        grantee, rest = entry.split('=', 1)
        privileges = rest.split('/', 1)[0]
        result.append((grantee.strip('"'), privileges))
    return result


def grants(kind, target, acl, owner, *, function=False, prefix=''):
    entries = acl_entries(acl)
    if acl is None:
        entries = [(owner, 'X'), ('', 'X')] if function else []
    roles = {'', 'anon', 'authenticated', 'service_role'} | {r for r, _ in entries if r != owner}
    role_sql = lambda r: ident(r) if r else 'PUBLIC'
    out = [f'{prefix}REVOKE ALL ON {kind} {target} FROM ' + ', '.join(role_sql(r) for r in sorted(roles)) + ';']
    for role, rights in entries:
        if role == owner:
            continue
        for grant_option in (False, True):
            values = []
            for i, right in enumerate(rights):
                if right == '*':
                    continue
                is_option = i + 1 < len(rights) and rights[i + 1] == '*'
                if is_option == grant_option:
                    values.append(RIGHTS[right])
            if values:
                out.append(f'{prefix}GRANT ' + ', '.join(values) + f' ON {kind} {target} TO {role_sql(role)}' + (' WITH GRANT OPTION' if grant_option else '') + ';')
    return out


def render(snapshot):
    out = [
        '-- Schema extracted exclusively from live production catalogs; no table rows.',
        '-- Supabase platform schemas/roles are supplied by the pinned local stack.',
        '-- This baseline is for EMPTY installations. Production adoption is separate.',
        'SET search_path = public, extensions;',
        'SET check_function_bodies = false;',
        "DO $empty$ BEGIN IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')) THEN RAISE EXCEPTION 'baseline_requires_empty_application_schema'; END IF; END $empty$;",
    ]
    for extension in snapshot['extensions']:
        if extension['name'] == 'plpgsql':
            continue
        out.append(f'CREATE SCHEMA IF NOT EXISTS {ident(extension["schema"])};')
        out.append(f'CREATE EXTENSION IF NOT EXISTS {ident(extension["name"])} WITH SCHEMA {ident(extension["schema"])};')
    for row in snapshot['types']:
        if row['schema'] != 'public':
            continue
        if row['kind'] != 'e':
            raise ValueError('Unimplemented live type kind: ' + str(row))
        out.append(f'CREATE TYPE {qualified(row)} AS ENUM (' + ', '.join(literal(x) for x in row['labels']) + ');')
    relations = [r for r in snapshot['relations'] if r['schema'] == 'public' and not r.get('extension')]
    for row in snapshot['sequences']:
        if row['schema'] != 'public':
            continue
        out.append(f'CREATE SEQUENCE {qualified(row)} AS {row["type"]} START WITH {row["start"]} INCREMENT BY {row["increment"]} MINVALUE {row["min"]} MAXVALUE {row["max"]} CACHE {row["cache"]}' + (' CYCLE' if row['cycle'] else ' NO CYCLE') + ';')
    for row in relations:
        if row['kind'] not in ('r', 'p'):
            continue
        if row['kind'] != 'r':
            raise ValueError('Partitioned table needs explicit partition metadata')
        columns = sorted((c for c in snapshot['columns'] if c['schema'] == 'public' and c['table'] == row['name']), key=lambda c: c['position'])
        definitions = []
        for c in columns:
            definition = ident(c['name']) + ' ' + c['type']
            if c['collation']:
                definition += ' COLLATE ' + ident(c['collation'])
            if c['generated']:
                definition += ' GENERATED ALWAYS AS (' + c['default'] + ') STORED'
            elif c['identity']:
                definition += ' GENERATED ' + ('ALWAYS' if c['identity'] == 'a' else 'BY DEFAULT') + ' AS IDENTITY'
            elif c['default'] is not None:
                definition += ' DEFAULT ' + c['default']
            if c['not_null']:
                definition += ' NOT NULL'
            definitions.append(definition)
        out.append(f'CREATE TABLE {qualified(row)} (\n  ' + ',\n  '.join(definitions) + '\n);')
    # Every table exists before any foreign key is installed.
    constraints = [c for c in snapshot['constraints'] if c['schema'] == 'public']
    for row in sorted(constraints, key=lambda c: (c['type'] == 'f', c['table'], c['name'])):
        out.append(f'ALTER TABLE {ident(row["schema"])}.{ident(row["table"])} ADD CONSTRAINT {ident(row["name"])} {row["definition"]};')
    backing = {c['index'] for c in constraints if c.get('index')}
    for row in snapshot['indexes']:
        if row['schema'] == 'public' and row['name'] not in backing:
            if not row['valid'] or not row['ready']:
                raise ValueError('Live index is invalid: ' + row['name'])
            out.append(row['definition'] + ';')
    for row in snapshot['routines']:
        if row['schema'] == 'public':
            out.append(row['definition'].rstrip(';\n') + ';')
    pending = {r['name']: r for r in relations if r['kind'] in ('v', 'm')}
    while pending:
        ready = [name for name in pending if not any(d['view'] == name and d['depends_schema'] == 'public' and d['depends_on'] in pending for d in snapshot['view_dependencies'])]
        if not ready:
            raise ValueError('Unresolved live view dependency cycle')
        for name in sorted(ready):
            row = pending.pop(name)
            options = ' WITH (' + ', '.join(row['options']) + ')' if row['options'] else ''
            out.append(('CREATE MATERIALIZED VIEW ' if row['kind'] == 'm' else 'CREATE VIEW ') + qualified(row) + options + ' AS\n' + row['view_definition'].rstrip(';\n') + (' WITH NO DATA' if row['kind'] == 'm' else '') + ';')
    for row in snapshot['triggers']:
        if row['schema'] != 'public':
            continue
        out.append(row['definition'] + ';')
        enabled = {'D': 'DISABLE', 'R': 'ENABLE REPLICA', 'A': 'ENABLE ALWAYS'}.get(row['enabled'])
        if enabled:
            out.append(f'ALTER TABLE {ident(row["schema"])}.{ident(row["table"])} {enabled} TRIGGER {ident(row["name"])};')
    for row in relations:
        if row['kind'] in ('r', 'p'):
            if row['rls']:
                out.append(f'ALTER TABLE {qualified(row)} ENABLE ROW LEVEL SECURITY;')
            if row['force_rls']:
                out.append(f'ALTER TABLE {qualified(row)} FORCE ROW LEVEL SECURITY;')
            if row['replica_identity'] in ('f', 'n'):
                out.append(f'ALTER TABLE {qualified(row)} REPLICA IDENTITY ' + ('FULL' if row['replica_identity'] == 'f' else 'NOTHING') + ';')
            elif row['replica_identity'] == 'i':
                index = next(i for i in snapshot['indexes'] if i['schema'] == 'public' and i['table'] == row['name'] and i['replica_identity'])
                out.append(f'ALTER TABLE {qualified(row)} REPLICA IDENTITY USING INDEX {ident(index["name"])};')
        out.extend(grants('SEQUENCE' if row['kind'] == 'S' else 'TABLE', qualified(row), row['acl'], row['owner']))
        if row.get('comment'):
            out.append(f'COMMENT ON ' + ('VIEW' if row['kind'] == 'v' else 'MATERIALIZED VIEW' if row['kind'] == 'm' else 'TABLE') + f' {qualified(row)} IS {literal(row["comment"])};')
    for row in snapshot['policies']:
        if row['schemaname'] != 'public':
            continue
        roles = ', '.join('PUBLIC' if r == 'public' else ident(r) for r in row['roles'])
        out.append(f'CREATE POLICY {ident(row["policyname"])} ON {ident(row["schemaname"])}.{ident(row["tablename"])} AS {row["permissive"]} FOR {row["cmd"]} TO {roles}' + (f' USING ({row["qual"]})' if row['qual'] else '') + (f' WITH CHECK ({row["with_check"]})' if row['with_check'] else '') + ';')
    for row in snapshot['routines']:
        if row['schema'] == 'public':
            target = qualified(row) + '(' + row['identity'] + ')'
            out.extend(grants('PROCEDURE' if row['kind'] == 'p' else 'FUNCTION', target, row['acl'], row['owner'], function=True))
            if row.get('comment'):
                out.append(f'COMMENT ON FUNCTION {target} IS {literal(row["comment"])};')
    for row in snapshot['columns']:
        if row['schema'] == 'public' and row.get('comment'):
            out.append(f'COMMENT ON COLUMN {ident(row["schema"])}.{ident(row["table"])}.{ident(row["name"])} IS {literal(row["comment"])};')
    for row in snapshot['rules']:
        if row['schema'] == 'public':
            out.append(row['definition'].rstrip(';') + ';')
    # Reproduce application-owner defaults. Supabase-owned defaults remain platform-managed.
    for row in snapshot['default_privileges']:
        if row['owner'] != 'postgres':
            continue
        kind = {'r': 'TABLES', 'f': 'FUNCTIONS', 'S': 'SEQUENCES'}.get(row['kind'])
        if not kind:
            raise ValueError('Unsupported default privilege type')
        prefix = 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres' + (f' IN SCHEMA {ident(row["schema"])}' if row['schema'] else '') + ' '
        for statement in grants(kind, '', row['acl'], 'postgres'):
            out.append(prefix + statement.replace('  ', ' '))
    # The only intentional departures from live production, verified separately.
    out.extend([
        '-- Intended protection: independent community-update push switch.',
        'ALTER TABLE public.notification_preferences ADD COLUMN community_push_enabled boolean NOT NULL DEFAULT true;',
        '-- Ordinary UNIQUE permits multiple NULLs for direct signups.',
        'ALTER TABLE public.users ADD CONSTRAINT users_application_id_unique UNIQUE (application_id);',
        "NOTIFY pgrst, 'reload schema';",
    ])
    return '\n\n'.join(out) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text())
    args.output.write_text(render(snapshot))
