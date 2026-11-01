import copy
import json
from pathlib import Path
import unittest

from compare import acl, compare, tokens

ROOT = Path(__file__).resolve().parents[2]


class ComparisonSafety(unittest.TestCase):
    def test_literal_spaces_and_case_are_not_normalized_away(self):
        self.assertNotEqual(tokens("select 'A B'"), tokens("select 'a  B'"))
        self.assertEqual(tokens('SELECT /* ignored */ x'), tokens('select x'))
        self.assertNotEqual(tokens("select E'a\\\' b'"), tokens("select E'a\\\'  b'"))

    def test_grant_options_remain_attached_to_their_privilege(self):
        self.assertNotEqual(acl('{service_role=ar*/postgres}', 'relations', 'postgres'),
                            acl('{service_role=a*r/postgres}', 'relations', 'postgres'))

    def test_wrong_intended_column_is_not_accepted_by_name(self):
        source = json.loads((ROOT / 'supabase/schema/production-catalog.json').read_text())
        fresh = copy.deepcopy(source)
        fresh['columns'].append({'schema': 'public', 'table': 'notification_preferences',
                                 'name': 'community_push_enabled', 'type': 'text', 'not_null': True,
                                 'default': 'true', 'generated': '', 'identity': '', 'position': 999})
        result = compare(source, fresh)
        self.assertEqual(result['unexpected_application_differences'], 1)
        self.assertFalse(result['intended_protections_present'])

    def test_exact_adoption_check_rejects_unapplied_protections(self):
        source = json.loads((ROOT / 'supabase/schema/production-catalog.json').read_text())
        fresh = json.loads((ROOT / 'supabase/schema/verification/fresh-catalog.json').read_text())
        self.assertEqual(compare(source, fresh, exact=True)['unexpected_application_differences'], 3)
        self.assertEqual(compare(fresh, fresh, exact=True)['unexpected_application_differences'], 0)
        self.assertTrue(compare(fresh, fresh, exact=True)['intended_protections_present'])

    def test_public_schema_and_default_grants_are_blocking(self):
        source = json.loads((ROOT / 'supabase/schema/verification/fresh-catalog.json').read_text())
        for category in ('schemas', 'default_privileges'):
            with self.subTest(category=category):
                fresh = copy.deepcopy(source)
                row = next(r for r in fresh[category] if r.get('schema', r.get('name')) == 'public')
                row['acl'] = '{}'
                self.assertEqual(compare(source, fresh, exact=True)['unexpected_application_differences'], 1)


if __name__ == '__main__':
    unittest.main()
