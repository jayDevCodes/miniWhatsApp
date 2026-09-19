import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('application factory initializes without a database connection', () => {
  const app = createApp(null);
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.get, 'function');
});