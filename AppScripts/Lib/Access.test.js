const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedEmail } = require('./Access.js');

test('allows an email in the list, case-insensitively', () => {
  assert.equal(isAllowedEmail('Owner@Example.com', ['owner@example.com']), true);
});

test('rejects an email not in the list', () => {
  assert.equal(isAllowedEmail('stranger@example.com', ['owner@example.com']), false);
});

test('rejects empty or missing email', () => {
  assert.equal(isAllowedEmail('', ['owner@example.com']), false);
  assert.equal(isAllowedEmail(undefined, ['owner@example.com']), false);
  assert.equal(isAllowedEmail(null, ['owner@example.com']), false);
});

test('trims surrounding whitespace before comparing', () => {
  assert.equal(isAllowedEmail('  owner@example.com  ', ['owner@example.com']), true);
});
