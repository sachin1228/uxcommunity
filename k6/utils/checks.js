/**
 * Reusable check factories for common response patterns.
 */

/**
 * Returns a checks object asserting the response is a successful JSON array.
 *
 * @param {string} label  — prefix for check names
 */
export function arrayResponse(label) {
  return {
    [`${label}: status 200`]: (r) => r.status === 200,
    [`${label}: body is array`]: (r) => {
      try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
    },
  };
}

/**
 * Returns a checks object asserting the response is a successful JSON object.
 *
 * @param {string} label
 * @param {string[]} [keys]  — optional top-level keys that must be present
 */
export function objectResponse(label, keys = []) {
  return {
    [`${label}: status 200`]: (r) => r.status === 200,
    [`${label}: body is object`]: (r) => {
      try {
        const b = JSON.parse(r.body);
        return b !== null && typeof b === 'object' && !Array.isArray(b);
      } catch { return false; }
    },
    ...Object.fromEntries(
      keys.map((k) => [
        `${label}: has key '${k}'`,
        (r) => { try { return k in JSON.parse(r.body); } catch { return false; } },
      ]),
    ),
  };
}

/**
 * Returns a checks object asserting a POST created something (201 or 200).
 *
 * @param {string} label
 */
export function createdResponse(label) {
  return {
    [`${label}: status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${label}: body is object`]: (r) => {
      try {
        const b = JSON.parse(r.body);
        return b !== null && typeof b === 'object';
      } catch { return false; }
    },
  };
}

/**
 * Returns a checks object asserting the response is 401 / 403 (access denied).
 *
 * @param {string} label
 */
export function deniedResponse(label) {
  return {
    [`${label}: access denied`]: (r) => r.status === 401 || r.status === 403,
  };
}
