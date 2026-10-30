/**
 * Logging for the backup/restore scripts.
 *
 * WHY THIS IS A MODULE
 *   These scripts run unattended in GitHub Actions and are read afterwards by
 *   whoever is paged. Every line therefore carries a UTC timestamp and a level,
 *   and the process exit code is the only thing the workflow branches on.
 *
 * WHAT MUST NEVER BE LOGGED
 *   A connection string with a password, an R2 secret, an age private key, or a
 *   dump's contents. Callers pass already-redacted values; `redactUrl` in
 *   ./config.mjs is the one function that turns a credentialed URL into
 *   something safe to print.
 */

const stamp = () => new Date().toISOString();

function emit(level, message, fields) {
  const suffix = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
  process.stderr.write(`${stamp()} ${level} ${message}${suffix}\n`);
}

export const log = {
  info: (message, fields) => emit("INFO", message, fields),
  warn: (message, fields) => emit("WARN", message, fields),
  error: (message, fields) => emit("ERROR", message, fields),
  /** A numbered step, so a failed run says exactly where it stopped. */
  step: (n, total, message, fields) => emit("INFO", `[${n}/${total}] ${message}`, fields),
};

/**
 * Prints the machine-readable summary to stdout. The workflow captures this to
 * display the backup's key, size and counts in the run summary.
 */
export function emitSummary(summary) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
