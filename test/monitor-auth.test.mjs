import test from 'node:test';
import assert from 'node:assert/strict';
import { MONITOR_AUDIENCE, validateMonitorClaims } from '../lib/monitor-auth.js';

const now = 1_800_000_000;
const valid = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: MONITOR_AUDIENCE,
  repository: 'nam9615-hub/Stockdesk',
  ref: 'refs/heads/main',
  event_name: 'schedule',
  iat: now - 10,
  nbf: now - 10,
  exp: now + 300,
};

test('accepts a scheduled main-branch token for this repository', () => {
  assert.equal(validateMonitorClaims(valid, now), true);
});

test('accepts manual workflow dispatch for verification', () => {
  assert.equal(validateMonitorClaims({ ...valid, event_name: 'workflow_dispatch' }, now), true);
});

test('rejects expired, foreign-repository and pull-request claims', () => {
  assert.equal(validateMonitorClaims({ ...valid, exp: now }, now), false);
  assert.equal(validateMonitorClaims({ ...valid, repository: 'someone/else' }, now), false);
  assert.equal(validateMonitorClaims({ ...valid, event_name: 'pull_request' }, now), false);
});

