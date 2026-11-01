"""Current-code contracts and integration checks for explicit initialization."""
import copy
import json
import re
import unittest

from capture import ROOT
from initialize import CATALOGS, initialize, load_inputs


def fixture_inputs():
    config = json.loads((ROOT / 'supabase/initialization/required.json').read_text())
    # Fictional test options, never shipped as installation defaults.
    catalogs = {'cities': [{'name': "Test O'Brien \\ $conflict$ City"}],
                'design_sectors': [{'name': 'Test sector'}],
                'experience_levels': [],
                'job_titles': [{'slug': 'test_designer', 'name': 'Test Designer'}]}
    return load_inputs(config, catalogs, include_levels=True)


def verify_initialization(url, query):
    inputs = fixture_inputs()
    initialize(url, inputs)
    tables = ('creation_limits', 'verification_settings', *CATALOGS)
    snapshot_sql = "select jsonb_build_object(" + ','.join(
        f"'{t}',(select jsonb_agg(to_jsonb(t) order by id) from public.{t} t)" if t != 'creation_limits' else
        f"'{t}',(select jsonb_agg(to_jsonb(t) order by kind) from public.{t} t)" for t in tables) + ')'
    before = query(snapshot_sql)
    initialize(url, inputs)
    if query(snapshot_sql) != before:
        raise RuntimeError('Repeated initialization changed existing values or timestamps')
    conflict = copy.deepcopy(inputs)
    conflict['verification_settings']['grace_days'] = 1
    conflict['creation_limits'].append(dict(kind='invalid', limit_count=99, period='total'))
    try:
        initialize(url, conflict)
    except RuntimeError as error:
        if 'Initialization conflict in verification_settings' not in str(error):
            raise
    else:
        raise RuntimeError('Conflicting initialization was accepted')
    if query(snapshot_sql) != before:
        raise RuntimeError('Conflicting initialization did not roll back atomically')
    # Prove the actual signup RPC can consume all four catalogs using the
    # service role used by the application. Its user/profile rows roll back.
    query("""begin; set local role service_role;
        select * from public.complete_signup(
          'Initialization test', 'init-signup@example.test', 'test-only-hash',
          (select id from public.cities limit 1),
          (select id from public.design_sectors limit 1),
          (select slug from public.experience_levels limit 1),
          (select slug from public.job_titles limit 1), null, null);
        rollback;""")
    if query('select count(*) from public.users') != '0':
        raise RuntimeError('Signup fixture was not rolled back')
    return 'passed: repeatability, conflict rollback, existing values/timestamps, service-role signup RPC'


class InitializationContracts(unittest.TestCase):
    def test_values_have_current_code_sources(self):
        inputs = fixture_inputs()
        source = (ROOT / 'apps/web/lib/creation-limits.ts').read_text()
        for row in inputs['creation_limits']:
            message = re.search(r'\b' + row['kind'] + r':\s*"([^"\n]+)"', source)[1]
            self.assertIn(str(row['limit_count']), message)
        policy = (ROOT / 'apps/web/lib/verification/policy.ts').read_text()
        self.assertIn('DEFAULT_VERIFICATION_GRACE_DAYS = 0', policy)
        levels = (ROOT / 'apps/web/app/api/admin/experience-levels/route.ts').read_text().split('];', 1)[0]
        self.assertEqual([(r['slug'], r['name']) for r in inputs['experience_levels']],
                         re.findall(r'\{ slug: "([^"]+)",\s+name: "([^"]+)"', levels))

    def test_missing_catalogs_are_never_guessed(self):
        config = json.loads((ROOT / 'supabase/initialization/required.json').read_text())
        catalogs = json.loads((ROOT / 'supabase/initialization/catalogs.example.json').read_text())
        with self.assertRaises(ValueError):
            load_inputs(config, catalogs, True)

    def test_remote_initialization_is_refused(self):
        with self.assertRaises(ValueError):
            initialize('postgresql://example.invalid/postgres', fixture_inputs())


if __name__ == '__main__':
    unittest.main()
