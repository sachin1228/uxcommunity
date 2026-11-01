import tempfile
import unittest
from pathlib import Path
from guard import validate

class LocalCommandPolicy(unittest.TestCase):
    def test_remote_operations_and_connection_overrides_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            for args in [['link'], ['db','push'], ['migration','repair'], ['db','reset'],
                         ['start','--db-url=postgresql://production/db'], ['status','--linked']]:
                with self.assertRaises(ValueError, msg=str(args)):
                    validate(args,root)

    def test_local_and_disposable_workdirs_are_supported(self):
        with tempfile.TemporaryDirectory() as root:
            validate(['start'],root)
            validate(['migration','up','--local','--yes'],root)
            validate(['--workdir',root,'status','--output-format','json'],'/unused')
            validate(['db','reset','--local'],root)

    def test_stale_production_link_blocks_local_commands(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'supabase/.temp'
            path.mkdir(parents=True)
            (path/'project-ref').write_text('remote')
            with self.assertRaises(ValueError):
                validate(['start'],root)

if __name__=='__main__':
    unittest.main()
