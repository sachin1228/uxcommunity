/**
 * Signup flow rules, split from the transport so the web-parity contract is
 * testable without React Native.
 *
 * The web app collects the same three steps (`apps/web/app/signup/page.tsx`)
 * and validates them with `directSignupStep1Schema` /
 * `signupStep2Schema` (`apps/web/lib/validations.ts`). These helpers mirror
 * those rules exactly, so the mobile form rejects the same input the server
 * would reject — and builds the same payload `/api/signup/avatar` expects.
 *
 *   Step 1  identity   name + surname, email, password, confirm password
 *   Step 2  profile    city, sector, experience level, job title
 *   Step 3  picture    optional avatar, uploaded with the final request
 */

export interface SignupIdentityInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

/** The identity object `/api/signup/direct` and `/api/signup/avatar` accept. */
export interface SignupIdentity {
  name: string;
  email: string;
  password: string;
  confirm_password: string;
}

/** The step-2 selection as the member sees it (values are master-data ids). */
export interface SignupSelection {
  cityId: string;
  sectorId: string;
  jobTitle: string;
  experienceLevel: string;
}

/** The profile object `/api/signup/avatar` stores. */
export interface SignupProfile {
  city_id: string;
  sector_id: string;
  experience_level: string;
  job_title: string;
}

export type SignupIdentityField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'password'
  | 'confirmPassword';

export type SignupIdentityErrors = Partial<Record<SignupIdentityField, string>>;

export type SignupProfileField =
  | 'cityId'
  | 'sectorId'
  | 'jobTitle'
  | 'experienceLevel';

/**
 * The most specific message an API failure carries: the first field issue the
 * route returned (`issues`), otherwise the error's own message (the routes put
 * the human-readable reason in `error`), otherwise the caller's fallback.
 */
export function signupErrorMessage(error: unknown, fallback: string): string {
  const shaped = error as {
    message?: string;
    data?: { issues?: Record<string, string[]>; error?: string };
  } | null;

  const issues = shaped?.data?.issues;
  if (issues && typeof issues === 'object') {
    for (const value of Object.values(issues)) {
      if (Array.isArray(value) && value.length > 0) return String(value[0]);
    }
  }

  const message = shaped?.message ?? shaped?.data?.error;
  return message && message.trim() ? message : fallback;
}

/** The exact body `/api/signup/avatar` validates with completeSignupSchema. */
export interface SignupPayload {
  identity: SignupIdentity;
  profile: SignupProfile;
  avatar_source?: 'upload';
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Combines the two name inputs into the single `name` the API stores. */
export function joinSignupName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
}

/** Validates step 1 with the same rules as the web form + server schemas. */
export function validateSignupIdentity(input: SignupIdentityInput): SignupIdentityErrors {
  const errors: SignupIdentityErrors = {};

  if (!input.firstName.trim()) errors.firstName = 'Please enter your name.';
  if (!input.lastName.trim()) errors.lastName = 'Please enter your surname.';

  const email = input.email.trim();
  if (!email) errors.email = 'Please enter your email address.';
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'Please enter a valid email address.';

  if (!input.password) errors.password = 'Please enter a password.';
  else if (input.password.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (!/[0-9]/.test(input.password)) errors.password = 'Must contain at least one number.';

  if (!input.confirmPassword) errors.confirmPassword = 'Please confirm your password.';
  else if (input.confirmPassword !== input.password) errors.confirmPassword = 'Passwords do not match.';

  return errors;
}

/** The message for the first field that is not a valid string id. */
const PROFILE_FIELDS: Array<[SignupProfileField, keyof SignupProfile, string]> = [
  ['cityId', 'city_id', 'Please select a city.'],
  ['sectorId', 'sector_id', 'Please select an industry sector.'],
  ['jobTitle', 'job_title', 'Please select a job title.'],
  ['experienceLevel', 'experience_level', 'Please select your experience level.'],
];

/**
 * Step 2 is all-selected or not; returns the first missing field (in the same
 * order the web form checks them) or null when complete.
 */
export function firstMissingProfileField(
  selection: SignupSelection,
): { field: SignupProfileField; message: string } | null {
  const profile = buildSignupProfile(selection);
  for (const [field, key, message] of PROFILE_FIELDS) {
    if (!profile[key]) return { field, message };
  }
  return null;
}

export function buildSignupIdentity(input: SignupIdentityInput): SignupIdentity {
  return {
    name: joinSignupName(input.firstName, input.lastName),
    email: input.email.trim(),
    password: input.password,
    confirm_password: input.confirmPassword,
  };
}

export function buildSignupProfile(selection: SignupSelection): SignupProfile {
  return {
    city_id: selection.cityId,
    sector_id: selection.sectorId,
    experience_level: selection.experienceLevel,
    job_title: selection.jobTitle,
  };
}

/**
 * The body `/api/signup/avatar` expects. `avatar_source` is only present when a
 * picture rides the request — the server rejects a file without it, and
 * rejects the marker without a file.
 */
export function buildSignupPayload(
  identity: SignupIdentityInput,
  selection: SignupSelection,
  options: { hasAvatar: boolean },
): SignupPayload {
  return {
    identity: buildSignupIdentity(identity),
    profile: buildSignupProfile(selection),
    ...(options.hasAvatar ? { avatar_source: 'upload' as const } : {}),
  };
}
