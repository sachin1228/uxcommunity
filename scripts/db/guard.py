"""Local-only command policy for the pinned Supabase CLI wrapper."""
import sys
from pathlib import Path

def validate(arguments, root):
    args = list(arguments)
    work = Path(root)
    if '--workdir' in args:
        i = args.index('--workdir')
        work = Path(args[i+1]).resolve()
        del args[i:i+2]
    if args == ['--version']:
        return
    if any((work / 'supabase' / p).exists() for p in ('.temp/project-ref', '.link.json')):
        raise ValueError('Remote project link refused by local database tooling')
    if any(a.startswith(('--db-url', '--project-ref', '--linked', '--password', '--workdir=')) for a in args):
        raise ValueError('Remote connection overrides are not accepted')
    allowed = args and (args[0] in ('start', 'stop', 'status') or
        (args[:2] == ['migration','new']) or
        (args[:2] == ['migration','up'] and '--local' in args) or
        (args[:2] == ['db','reset'] and '--local' in args))
    if not allowed:
        raise ValueError('Only local start/stop/status, new migrations and explicitly local apply/reset are supported')

if __name__ == '__main__':
    validate(sys.argv[2:], sys.argv[1])
