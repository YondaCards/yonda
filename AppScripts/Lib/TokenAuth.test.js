const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyIdTokenClaims } = require('./TokenAuth.js');

const AUD = '123-abc.apps.googleusercontent.com';
const ALLOWED = ['owner@example.com', 'partner@example.com'];

test('accepts a valid claims object for an allowed email', () => {
  const result = verifyIdTokenClaims(
    { aud: AUD, email: 'owner@example.com', email_verified: 'true' },
    AUD,
    ALLOWED
  );
  assert.deepEqual(result, { ok: true, email: 'owner@example.com' });
});

test('accepts email_verified as a boolean true (not just the string)', () => {
  const result = verifyIdTokenClaims(
    { aud: AUD, email: 'owner@example.com', email_verified: true },
    AUD,
    ALLOWED
  );
  assert.equal(result.ok, true);
});

test('rejects a token issued for a different OAuth client', () => {
  const result = verifyIdTokenClaims(
    { aud: 'someone-elses-client-id', email: 'owner@example.com', email_verified: 'true' },
    AUD,
    ALLOWED
  );
  assert.equal(result.ok, false);
});

test('rejects an unverified email', () => {
  const result = verifyIdTokenClaims(
    { aud: AUD, email: 'owner@example.com', email_verified: 'false' },
    AUD,
    ALLOWED
  );
  assert.equal(result.ok, false);
});

test('rejects an email not in the allowlist', () => {
  const result = verifyIdTokenClaims(
    { aud: AUD, email: 'stranger@example.com', email_verified: 'true' },
    AUD,
    ALLOWED
  );
  assert.equal(result.ok, false);
});

test('rejects a missing claims object', () => {
  const result = verifyIdTokenClaims(null, AUD, ALLOWED);
  assert.equal(result.ok, false);
});
