import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSignupIdentity,
  buildSignupPayload,
  buildSignupProfile,
  firstMissingProfileField,
  joinSignupName,
  signupErrorMessage,
  validateSignupIdentity,
  type SignupIdentityInput,
  type SignupSelection,
} from './signupFlow';

const identity: SignupIdentityInput = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  password: 'design123',
  confirmPassword: 'design123',
};

const selection: SignupSelection = {
  cityId: 'city-uuid',
  sectorId: 'sector-uuid',
  jobTitle: 'product-designer',
  experienceLevel: 'mid-level',
};

test('the two name inputs become one trimmed name', () => {
  assert.equal(joinSignupName('  Ada ', ' Lovelace  '), 'Ada Lovelace');
  assert.equal(joinSignupName('Ada', '   '), 'Ada');
  assert.equal(joinSignupName('', 'Lovelace'), 'Lovelace');
});

test('a complete identity passes every rule', () => {
  assert.deepEqual(validateSignupIdentity(identity), {});
});

test('both name parts are required', () => {
  const errors = validateSignupIdentity({ ...identity, firstName: '  ', lastName: '' });
  assert.equal(errors.firstName, 'Please enter your name.');
  assert.equal(errors.lastName, 'Please enter your surname.');
});

test('the email must look like an address', () => {
  assert.equal(
    validateSignupIdentity({ ...identity, email: '' }).email,
    'Please enter your email address.',
  );
  assert.equal(
    validateSignupIdentity({ ...identity, email: 'ada.example.com' }).email,
    'Please enter a valid email address.',
  );
  // Surrounding whitespace from the keyboard's autocorrect is tolerated.
  assert.deepEqual(validateSignupIdentity({ ...identity, email: ' ada@example.com ' }), {});
});

test('the password mirrors the server rules (8 chars, one number)', () => {
  assert.equal(
    validateSignupIdentity({ ...identity, password: 'short1' }).password,
    'Password must be at least 8 characters.',
  );
  assert.equal(
    validateSignupIdentity({ ...identity, password: 'onlyletters' }).password,
    'Must contain at least one number.',
  );
  assert.equal(
    validateSignupIdentity({ ...identity, confirmPassword: 'design12' }).confirmPassword,
    'Passwords do not match.',
  );
});

test('empty passwords are reported before any comparison', () => {
  const errors = validateSignupIdentity({ ...identity, password: '', confirmPassword: '' });
  assert.equal(errors.password, 'Please enter a password.');
  assert.equal(errors.confirmPassword, 'Please confirm your password.');
});

test('step 1 builds the body /api/signup/direct validates', () => {
  assert.deepEqual(buildSignupIdentity({ ...identity, email: ' ADA@example.com ' }), {
    name: 'Ada Lovelace',
    email: 'ADA@example.com',
    password: 'design123',
    confirm_password: 'design123',
  });
});

test('step 2 maps the selection to the stored profile (slugs for levels)', () => {
  assert.deepEqual(buildSignupProfile(selection), {
    city_id: 'city-uuid',
    sector_id: 'sector-uuid',
    experience_level: 'mid-level',
    job_title: 'product-designer',
  });
});

test('step 2 reports the first missing field in the web form order', () => {
  assert.deepEqual(firstMissingProfileField(selection), null);

  assert.deepEqual(firstMissingProfileField({ ...selection, cityId: '' }), {
    field: 'cityId',
    message: 'Please select a city.',
  });
  assert.deepEqual(firstMissingProfileField({ ...selection, cityId: '', sectorId: '' }), {
    field: 'cityId',
    message: 'Please select a city.',
  });
  assert.deepEqual(firstMissingProfileField({ ...selection, sectorId: '' }), {
    field: 'sectorId',
    message: 'Please select an industry sector.',
  });
  assert.deepEqual(firstMissingProfileField({ ...selection, jobTitle: '' }), {
    field: 'jobTitle',
    message: 'Please select a job title.',
  });
  assert.deepEqual(firstMissingProfileField({ ...selection, experienceLevel: '' }), {
    field: 'experienceLevel',
    message: 'Please select your experience level.',
  });
});

test('the final payload omits avatar_source unless a picture was chosen', () => {
  assert.deepEqual(buildSignupPayload(identity, selection, { hasAvatar: false }), {
    identity: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'design123',
      confirm_password: 'design123',
    },
    profile: {
      city_id: 'city-uuid',
      sector_id: 'sector-uuid',
      experience_level: 'mid-level',
      job_title: 'product-designer',
    },
  });

  assert.equal(
    buildSignupPayload(identity, selection, { hasAvatar: true }).avatar_source,
    'upload',
  );
});

test('error messages prefer the first field issue, then the API message', () => {
  assert.equal(
    signupErrorMessage(
      {
        message: 'Validation failed',
        data: { issues: { email: ['Please enter a valid email address'], password: ['Too short'] } },
      },
      'fallback',
    ),
    'Please enter a valid email address',
  );

  assert.equal(
    signupErrorMessage({ message: 'An account with this email already exists.' }, 'fallback'),
    'An account with this email already exists.',
  );

  assert.equal(signupErrorMessage({ message: '' }, 'fallback'), 'fallback');
  assert.equal(signupErrorMessage(null, 'fallback'), 'fallback');
});
