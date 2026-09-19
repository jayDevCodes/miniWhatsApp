import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, createSessionToken, hashSessionToken } from '../src/security.js';

test('password hashes are verifiable', async () => {
  const stored = await hashPassword('StrongPass123!');
  assert.equal(await verifyPassword('StrongPass123!', stored), true);
  assert.equal(await verifyPassword('WrongPass123!', stored), false);
});

test('session tokens hash deterministically', () => {
  const token = createSessionToken();
  assert.notEqual(token, createSessionToken());
  assert.equal(hashSessionToken(token), hashSessionToken(token));
});