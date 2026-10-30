/**
 * Minimal `--key value` / `--flag` parser shared by the backup scripts.
 *
 * Kept deliberately small: these scripts are run by a workflow and by an
 * operator under pressure, so an unknown flag must be a loud error rather than
 * silently ignored (a typo in `--targt-url` must not fall back to production).
 */

export function parseArgs(argv, { known, flags = [] }) {
  const options = {};
  for (const flag of flags) options[flag] = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument ${JSON.stringify(token)} (options start with --)`);
    }

    const body = token.slice(2);
    const equals = body.indexOf("=");
    const name = equals >= 0 ? body.slice(0, equals) : body;

    if (!known.includes(name)) {
      throw new Error(`Unknown option --${name}. Known options: ${known.map((k) => `--${k}`).join(", ")}`);
    }

    if (flags.includes(name)) {
      if (equals >= 0) throw new Error(`--${name} is a flag and takes no value`);
      options[name] = true;
      continue;
    }

    if (equals >= 0) {
      options[name] = body.slice(equals + 1);
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} needs a value`);
    }
    options[name] = value;
    index += 1;
  }

  return options;
}
