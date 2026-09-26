/**
 * Shape and validation rules for the generated k6 user fixture.
 *
 * `k6/data/test-users.json` holds the plaintext password, the database user id,
 * and a pre-signed session JWT for every seeded load-test user, so it is a
 * credentials file: it is produced locally by `k6/scripts/seed-users.js` and
 * matched by the `k6/data/*.json` rule in .gitignore. It must never be
 * committed, and it must never be replaced by a checked-in copy.
 *
 * Keeping the rules here means the seeder, the k6 scenarios, and the unit tests
 * agree on what a usable fixture looks like and every failure can point at the
 * same fix. This module deliberately imports nothing: k6 bundles it into the
 * scenarios, and Node loads it directly for the scripts and tests.
 */

/** Repo-relative path, used in developer-facing error messages. */
export const FIXTURE_PATH = 'k6/data/test-users.json';

/** Same file, as passed to `open()` from inside k6/scenarios/. */
export const FIXTURE_PATH_FROM_SCENARIOS = '../data/test-users.json';

/**
 * Fields every record must carry a non-empty string for. `name` is excluded
 * because it only feeds message text in the chat scenarios.
 */
export const REQUIRED_FIELDS = ['email', 'password', 'userId', 'sessionToken'];

/** Field order written by the seeder. */
export const FIXTURE_FIELDS = ['email', 'password', 'name', 'userId', 'sessionToken'];

/** The script that creates the users and re-writes the fixture. */
export const SETUP_COMMAND = 'npm run k6:seed';

const FIXTURE_ENV_HINT =
  '  Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_COMMUNITY_ID, SESSION_SECRET\n' +
  '  SESSION_SECRET must match the target environment so the generated\n' +
  '  sessions are accepted there.';

/** How to fix the missing fixture. */
export const MISSING_FIXTURE_HINT =
  `Generate it locally with: ${SETUP_COMMAND}\n${FIXTURE_ENV_HINT}`;

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * Required fields that are absent, not a string, or empty on one record.
 *
 * @param {unknown} user
 * @returns {string[]}
 */
export function emptyFields(user) {
  if (!user || typeof user !== 'object') return [...REQUIRED_FIELDS];
  return REQUIRED_FIELDS.filter(
    (field) => typeof user[field] !== 'string' || user[field].length === 0,
  );
}

/**
 * Validate a parsed fixture. Throws an Error whose message tells the developer
 * exactly how to regenerate the file; returns the array unchanged when valid.
 *
 * @param {unknown} value                 parsed JSON contents
 * @param {{ source?: string, requiredUsers?: number }} [options]
 * @returns {Array<object>}
 */
export function validateFixture(value, options = {}) {
  const source = options.source || FIXTURE_PATH;

  if (!Array.isArray(value)) {
    throw new Error(
      `${source} must be a JSON array of seeded users (found ${typeOf(value)}).\n` +
      `${MISSING_FIXTURE_HINT}`,
    );
  }

  if (value.length === 0) {
    throw new Error(
      `${source} contains no seeded users.\n${MISSING_FIXTURE_HINT}`,
    );
  }

  const problems = [];
  for (let index = 0; index < value.length; index += 1) {
    const missing = emptyFields(value[index]);
    if (missing.length > 0) {
      problems.push(`entry ${index + 1} is missing ${missing.join(', ')}`);
      if (problems.length === 3) break;
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `${source} has entries without credentials or sessions:\n  - ${problems.join('\n  - ')}\n` +
      `${MISSING_FIXTURE_HINT}`,
    );
  }

  const requiredUsers = options.requiredUsers;
  if (typeof requiredUsers === 'number' && requiredUsers > value.length) {
    throw new Error(
      `${requiredUsers} VUs requested, but ${source} only has ${value.length} seeded users.\n` +
      `  Raise K6_USER_COUNT and re-run ${SETUP_COMMAND}`,
    );
  }

  return value;
}

/**
 * Build the fixture payload written by the seeder. Validates before the caller
 * touches the filesystem, so a partially-seeded run can never leave a file with
 * empty passwords or tokens behind.
 *
 * @param {Array<{ email: string, password: string, name?: string, userId: string, sessionToken: string }>} entries
 * @returns {Array<object>} records in FIXTURE_FIELDS order
 */
export function buildFixture(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      `Refusing to write ${FIXTURE_PATH} with no seeded users. ` +
      'Every seeded user needs an id before its session can be signed.',
    );
  }

  const users = entries.map((entry) => {
    const user = {};
    for (const field of FIXTURE_FIELDS) {
      if (entry[field] !== undefined) user[field] = entry[field];
    }
    return user;
  });

  return validateFixture(users, { source: `generated ${FIXTURE_PATH}` });
}
