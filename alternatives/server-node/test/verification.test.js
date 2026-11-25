import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatchingSlot, computeRoomStatus } from '../src/services/verification.js';
import { normTime, validDate } from '../src/services/validators.js';

const H = 3600;
const slots = [{ id: 1, start_sec: 9 * H, end_sec: 11 * H }];

test('TC1: swipe inside the slot is authorized', () => {
  assert.equal(findMatchingSlot(slots, 9 * H + 600, 15 * 60)?.id, 1);
});
test('early arrival within grace is authorized', () => {
  assert.equal(findMatchingSlot(slots, 9 * H - 10 * 60, 15 * 60)?.id, 1);
});
test('TC2: swipe too early (beyond grace) is unauthorized', () => {
  assert.equal(findMatchingSlot(slots, 9 * H - 20 * 60, 15 * 60), null);
});
test('TC2: swipe after the slot ended is unauthorized', () => {
  assert.equal(findMatchingSlot(slots, 11 * H + 1, 15 * 60), null);
});
test('no slots today is unauthorized', () => {
  assert.equal(findMatchingSlot([], 10 * H, 900), null);
});
test('back-to-back slots prefer the one in progress', () => {
  const two = [{ id: 1, start_sec: 9 * H, end_sec: 10 * H }, { id: 2, start_sec: 10 * H, end_sec: 11 * H }];
  assert.equal(findMatchingSlot(two, 10 * H - 60, 900)?.id, 2);
});

const now = new Date('2026-10-28T10:00:00Z');
test('TC7: silent terminal shows UNVERIFIED, never a false Available', () => {
  const old = new Date(now - 5 * 60 * 1000);
  assert.equal(computeRoomStatus({ lastHeartbeat: old, now, timeoutSec: 90, session: null }), 'UNVERIFIED');
  assert.equal(computeRoomStatus({ lastHeartbeat: null, now, timeoutSec: 90, session: null }), 'UNVERIFIED');
});
test('live terminal: no session = AVAILABLE, session maps to occupied states', () => {
  const live = new Date(now - 10 * 1000);
  assert.equal(computeRoomStatus({ lastHeartbeat: live, now, timeoutSec: 90, session: null }), 'AVAILABLE');
  assert.equal(computeRoomStatus({ lastHeartbeat: live, now, timeoutSec: 90, session: { auth_status: 'AUTHORIZED' } }), 'OCCUPIED_AUTHORIZED');
  assert.equal(computeRoomStatus({ lastHeartbeat: live, now, timeoutSec: 90, session: { auth_status: 'UNAUTHORIZED' } }), 'OCCUPIED_UNAUTHORIZED');
});

test('TC10: time and date validation', () => {
  assert.equal(normTime('9:05'), '09:05:00');
  assert.equal(normTime('25:00'), null);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2026-10-28'), true);
});
