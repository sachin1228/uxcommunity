#!/usr/bin/env python3
"""Compare every captured catalog object; separate application and platform differences."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

KEYS = {
    'schemas': ('name',), 'relations': ('schema', 'name'),
    'columns': ('schema', 'table', 'name'), 'constraints': ('schema', 'table', 'name'),
    'indexes': ('schema', 'table', 'name'), 'routines': ('schema', 'name', 'identity'),
    'triggers': ('schema', 'table', 'name'), 'policies': ('schemaname', 'tablename', 'policyname'),
    'types': ('schema', 'name'), 'sequences': ('schema', 'name'), 'roles': ('name',),
    'role_memberships': ('role', 'member', 'grantor'),
    'default_privileges': ('owner', 'schema', 'kind'), 'extensions': ('name',),
    'publications': ('name',), 'publication_tables': ('pubname', 'schemaname', 'tablename'),
    'event_triggers': ('name',), 'rules': ('schema', 'table', 'name'),
    'foreign_servers': ('name',),
}
SQL_FIELDS = {'definition', 'view_definition', 'default', 'qual', 'with_check', 'result', 'identity'}
INTENT = {
    ('columns', 'public|notification_preferences|community_push_enabled'),
    ('constraints', 'public|users|users_application_id_unique'),
    ('indexes', 'public|users|users_application_id_unique'),
}


def tokens(sql):
    """Ignore SQL formatting/comments, preserving quoted literal contents exactly."""
    result, i = [], 0
    while i < len(sql):
        if sql[i].isspace():
            i += 1
        elif sql.startswith('--', i):
            end = sql.find('\n', i)
            i = len(sql) if end == -1 else end
        elif sql.startswith('/*', i):
            level, i = 1, i + 2
            while level and i < len(sql):
                if sql.startswith('/*', i):
                    level, i = level + 1, i + 2
                elif sql.startswith('*/', i):
                    level, i = level - 1, i + 2
                else:
                    i += 1
        elif sql[i] in "'\"":
            quote, start = sql[i], i
            escaped = quote == "'" and start > 0 and sql[start - 1].lower() == 'e' and (start == 1 or not sql[start - 2].isalnum())
            i += 1
            while i < len(sql):
                if escaped and sql[i] == '\\':
                    i += 2
                    continue
                if sql[i] == quote:
                    i += 1
                    if i < len(sql) and sql[i] == quote:
                        i += 1
                        continue
                    break
                i += 1
            value = sql[start:i]
            if quote == '"' and re.fullmatch(r'"[a-z_][a-z_0-9]*"', value):
                value = value[1:-1]
            result.append(value)
        elif sql[i] == '$' and (tag := re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$', sql[i:])):
            delimiter = tag.group()
            start = i + len(delimiter)
            end = sql.find(delimiter, start)
            if end == -1:
                raise ValueError('Unterminated dollar quote')
            result.append(tokens(sql[start:end]))
            i = end + len(delimiter)
        elif word := re.match(r'[A-Za-z_][A-Za-z_0-9$]*', sql[i:]):
            result.append(word.group().lower())
            i += len(word.group())
        else:
            result.append(sql[i])
            i += 1
    return result


def acl(value, category, owner):
    if value is None:
        if category == 'routines':
            return {'': {'X': False}, owner: {'X': False}}
        if category == 'types':
            return {'': {'U': False}, owner: {'U': False}}
        return {}
    result = {}
    for item in value.strip('{}').split(','):
        role, rights = item.split('=', 1)
        rights = rights.split('/', 1)[0]
        result[role.strip('"')] = {right: i + 1 < len(rights) and rights[i + 1] == '*'
                                  for i, right in enumerate(rights) if right != '*'}
    return result


def normalize(row, category):
    result = dict(row)
    # attnum includes historical holes for dropped columns; logical order is checked separately.
    result.pop('position', None)
    for field in SQL_FIELDS:
        if isinstance(result.get(field), str):
            result[field] = tokens(result[field])
    if 'acl' in result:
        result['acl'] = acl(result['acl'], category, result.get('owner'))
        if category == 'default_privileges':
            # Schema defaults augment global owner privileges; explicit owner entries are redundant.
            result['acl'].pop(result.get('owner'), None)
    if result.get('options'):
        result['options'] = sorted(result['options'])
    return result


def compare(production, fresh, *, exact=False):
    differences = []
    counts = {}
    for category, fields in KEYS.items():
        key = lambda r: '|'.join(str(r.get(f)) for f in fields)
        before = {key(r): r for r in production[category]}
        after = {key(r): r for r in fresh[category]}
        counts[category] = {'production': len(before), 'fresh': len(after), 'equal': 0}
        for name in sorted(before.keys() | after.keys()):
            p, f = before.get(name), after.get(name)
            if p is not None and f is not None and normalize(p, category) == normalize(f, category):
                counts[category]['equal'] += 1
                continue
            row = p or f
            application = row.get('schema', row.get('schemaname')) == 'public' and category not in ('default_privileges', 'schemas')
            scope = 'application' if application else 'supabase_platform_or_database_configuration'
            status = 'missing_from_fresh' if f is None else 'fresh_only' if p is None else 'different'
            fields_changed = []
            if p is not None and f is not None:
                pn, fn = normalize(p, category), normalize(f, category)
                fields_changed = sorted(k for k in pn.keys() | fn.keys() if pn.get(k) != fn.get(k))
            representation = False
            if category == 'relations' and name == 'public|report_groups' and fields_changed == ['view_definition']:
                # PG 17.11 adds redundant output labels to non-leading UNION arms.
                # Those labels do not determine UNION output names; all view columns
                # are compared independently. Retain this difference in the report.
                stripped = re.sub(r"(SELECT '(?:showcase|resource|event)'::text) AS text,", r'\1,', f['view_definition'])
                representation = tokens(stripped) == tokens(p['view_definition'])
            intended = (category, name) in INTENT and p is None and f is not None
            if intended and category == 'columns':
                intended = f['type'] == 'boolean' and f['not_null'] and f['default'] == 'true' and not f['generated'] and not f['identity']
            elif intended and category == 'constraints':
                intended = f['type'] == 'u' and f['validated'] and not f['deferrable'] and tokens(f['definition']) == tokens('UNIQUE (application_id)')
            elif intended and category == 'indexes':
                intended = f['valid'] and f['ready'] and f['unique'] and tokens(f['definition']) == tokens('CREATE UNIQUE INDEX users_application_id_unique ON public.users USING btree (application_id)')
            if exact:
                intended = False
            differences.append({'category': category, 'key': name, 'scope': scope, 'status': status,
                                'intentional_protection': intended,
                                'representation_only': representation,
                                'changed_fields': fields_changed, 'production': p, 'fresh': f})
    if production['database_config'] != fresh['database_config']:
        differences.append({'category': 'database_config', 'key': 'database',
                            'scope': 'supabase_platform_or_database_configuration', 'status': 'different',
                            'intentional_protection': False, 'changed_fields': [],
                            'production': production['database_config'], 'fresh': fresh['database_config']})
    # Compare logical column order for every shared application table/view.
    shared = {r['name'] for r in production['relations'] if r['schema'] == 'public'} & {r['name'] for r in fresh['relations'] if r['schema'] == 'public'}
    for table in sorted(shared):
        columns = lambda s: [r['name'] for r in sorted(s['columns'], key=lambda r: r['position']) if r['schema'] == 'public' and r['table'] == table and r['name'] != 'community_push_enabled']
        if columns(production) != columns(fresh):
            differences.append({'category': 'column_order', 'key': 'public|' + table, 'scope': 'application', 'status': 'different', 'intentional_protection': False, 'changed_fields': [], 'production': columns(production), 'fresh': columns(fresh)})
    unexpected = [d for d in differences if d['scope'] == 'application' and not d['intentional_protection'] and not d.get('representation_only')]
    column = next((r for r in fresh['columns'] if r['schema'] == 'public' and r['table'] == 'notification_preferences' and r['name'] == 'community_push_enabled'), None)
    constraint = next((r for r in fresh['constraints'] if r['schema'] == 'public' and r['table'] == 'users' and r['name'] == 'users_application_id_unique'), None)
    index = next((r for r in fresh['indexes'] if r['schema'] == 'public' and r['table'] == 'users' and r['name'] == 'users_application_id_unique'), None)
    protections = bool(column and column['type'] == 'boolean' and column['not_null'] and column['default'] == 'true' and not column['generated'] and not column['identity']
                       and constraint and constraint['type'] == 'u' and constraint['validated'] and not constraint['deferrable']
                       and tokens(constraint['definition']) == tokens('UNIQUE (application_id)')
                       and index and index['valid'] and index['ready'] and index['unique']
                       and tokens(index['definition']) == tokens('CREATE UNIQUE INDEX users_application_id_unique ON public.users USING btree (application_id)'))
    return {'production_capture': production['meta'], 'fresh_capture': fresh['meta'],
            'counts': counts, 'unexpected_application_differences': len(unexpected),
            'intended_protections_present': protections,
            'representation_only_count': sum(bool(d.get('representation_only')) for d in differences),
            'platform_difference_count': sum(d['scope'] != 'application' for d in differences),
            'differences': differences,
            'comparison_rules': ['Exclude old migration-ledger schema entirely; never query its rows.',
                                 'Ignore dropped-column physical attnum holes; compare logical public-column order.',
                                 'Ignore SQL formatting/comments without changing quoted literal contents.',
                                 'Compare effective ACL grantees/rights; do not compare grantor spelling or redundant default-owner entries.',
                                 'List every observed platform difference; these are not a claim of global database equality.']}


def write_report(result, output):
    output.mkdir(parents=True, exist_ok=True)
    (output / 'schema-differences.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    rows = ['# Production versus fresh baseline', '',
            f"Production capture: {result['production_capture']['captured_at']} (read-only).",
            f"Fresh PostgreSQL: {result['fresh_capture']['version']}.", '',
            f"Unexpected application differences: **{result['unexpected_application_differences']}**.",
            f"Both intended protections represented: **{result['intended_protections_present']}**.",
            f"Recorded PostgreSQL deparser-only differences: **{result['representation_only_count']}**.",
            f"Supabase platform / database configuration differences: **{result['platform_difference_count']}**.", '',
            'The baseline owns the live public application schema. Supabase supplies managed schemas, roles, services, and extension implementation objects. Every observed platform difference is listed below and in the JSON; the databases are not claimed globally identical.', '',
            '| Category | Production | Fresh | Equal objects |', '|---|---:|---:|---:|']
    for category, counts in result['counts'].items():
        rows.append(f"| {category} | {counts['production']} | {counts['fresh']} | {counts['equal']} |")
    rows += ['', '| Scope | Category / object | Difference | Fields |', '|---|---|---|---|']
    for difference in result['differences']:
        name = difference['key'].replace('|', '.')
        scope = 'intended protection' if difference['intentional_protection'] else 'PostgreSQL deparser formatting' if difference.get('representation_only') else difference['scope']
        rows.append(f"| {scope} | {difference['category']}: `{name}` | {difference['status']} | {', '.join(difference['changed_fields'])} |")
    rows += ['', 'Exact source/result definitions, properties, and grants for each difference are retained in [schema-differences.json](schema-differences.json). No production table rows or sequence counter values are captured.']
    (output / 'schema-comparison.md').write_text('\n'.join(rows) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('production', type=Path)
    parser.add_argument('fresh', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--exact', action='store_true', help='Require existing production to already contain both protections; use only saved captures')
    args = parser.parse_args()
    result = compare(json.loads(args.production.read_text()), json.loads(args.fresh.read_text()), exact=args.exact)
    write_report(result, args.output)
    print(json.dumps({k: v for k, v in result.items() if k in ('unexpected_application_differences', 'intended_protections_present', 'platform_difference_count')}))
    raise SystemExit(1 if result['unexpected_application_differences'] or not result['intended_protections_present'] else 0)
