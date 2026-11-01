"""Regression checks for every filename in the sole active migration stream."""
from pathlib import Path
import tempfile
import unittest

from test_fresh import validate_migrations


class MigrationValidation(unittest.TestCase):
    def check_files(self, names):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'supabase/migrations'
            path.mkdir(parents=True)
            for name in names:
                (path / name).touch()
            return validate_migrations(root)[1]

    baseline = '20261031163000_production_schema_baseline.sql'

    def test_forward_migrations_are_all_validated(self):
        self.assertEqual(self.check_files([self.baseline, '20261101120000_example.sql']), ['20261031163000', '20261101120000'])
        for bad in ('123_old.sql', '20261301120000_bad_date.sql', '20261101120000_Hyphen-name.sql'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.check_files([self.baseline, bad])

    def test_duplicate_forward_versions_rejected(self):
        with self.assertRaises(ValueError):
            self.check_files([self.baseline, '20261101120000_a.sql', '20261101120000_b.sql'])

    def test_baseline_required_and_history_rejected(self):
        for names in ([], ['20261101120000_new.sql'], ['20261001120000_old.sql', self.baseline]):
            with self.subTest(names=names), self.assertRaises(ValueError):
                self.check_files(names)


if __name__ == '__main__':
    unittest.main()
