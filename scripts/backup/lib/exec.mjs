/**
 * Runs external programs (pg_dump, psql, pg_restore, age) without a shell.
 *
 * WHY NO SHELL
 *   Connection strings, bucket names and key prefixes are supplied by
 *   environment variables and operators. Passing an argument array to
 *   `spawn` (never `exec` with an interpolated string) means a quote or a `;`
 *   in a value can never become a second command.
 *
 * WHY OUTPUT IS CAPPED
 *   pg_dump and pg_restore are chatty on failure and silent on success. The
 *   cap keeps a pathological run from filling memory while still keeping enough
 *   of the message to diagnose it; the caller reports `truncated: true`.
 */

import { spawn } from "node:child_process";

const MAX_CAPTURE_BYTES = 256 * 1024;

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{env?: NodeJS.ProcessEnv, input?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string, truncated: boolean}>}
 */
export function run(command, args, options = {}) {
  const { env, input, timeoutMs = 30 * 60 * 1000 } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;

    const collect = (chunk, target) => {
      const text = chunk.toString("utf8");
      const combined = target + text;
      if (combined.length <= MAX_CAPTURE_BYTES) return combined;
      truncated = true;
      return combined.slice(0, MAX_CAPTURE_BYTES);
    };

    child.stdout.on("data", (chunk) => {
      stdout = collect(chunk, stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr = collect(chunk, stderr);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      truncated = true;
    }, timeoutMs);
    timer.unref?.();

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, truncated });
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Same as `run`, but a non-zero exit becomes a thrown Error carrying the
 * command's stderr — the message a human needs, with the secret-bearing
 * argument list omitted (pg_dump's first argument is a connection string).
 */
export async function runOrThrow(command, args, options = {}) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().slice(0, 4000);
    const error = new Error(`${command} exited with code ${result.code}${detail ? `: ${detail}` : ""}`);
    error.code = "ECHILD";
    error.exitCode = result.code;
    throw error;
  }
  return result;
}
