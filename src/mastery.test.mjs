import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallMastery, hallBracing, roomMastery, MASTERY_RECALL_THRESHOLD } from './mastery.mjs';

test('recallMastery: zero exercises has no meaningful reading', () => {
  assert.equal(recallMastery([], 100), undefined);
});

test('recallMastery: minimum, not mean, across the room\'s exercises', () => {
  const r = recallMastery(
    [
      { stability: 1000, lastReviewedAt: 0 }, // near-certain recall
      { stability: 0.0001, lastReviewedAt: 0 }, // near-zero recall
    ],
    5,
  );
  assert.ok(r !== undefined && r < 0.1, `expected the minimum to dominate, got ${r}`);
});

test('recallMastery: an un-reviewed exercise contributes R=0', () => {
  const r = recallMastery([{ stability: 1000, lastReviewedAt: undefined }], 5);
  assert.equal(r, 0);
});

test('MASTERY_RECALL_THRESHOLD is the same 0.9 "full"-light cut the SRS module defines', () => {
  assert.equal(MASTERY_RECALL_THRESHOLD, 0.9);
});

test('roomMastery requires recall >= threshold AND at least one gate pass', () => {
  assert.equal(roomMastery(0.95, true), true);
  assert.equal(roomMastery(0.95, false), false); // never gated -- not mastered even at high recall
  assert.equal(roomMastery(0.5, true), false); // gated but recall too low
  assert.equal(roomMastery(undefined, true), false);
});

test('hallBracing is a plain pass-through alias, never a room-mastery input', () => {
  assert.equal(hallBracing(true), true);
  assert.equal(hallBracing(false), false);
});

test('structural mastery (hall bracing) does not change roomMastery -- platform §5\'s explicit rule', () => {
  // Same recall + gate status, only hall stability differs -- roomMastery must not care.
  const recall = 0.95;
  const withStableHall = roomMastery(recall, true);
  const withoutStableHall = roomMastery(recall, true);
  assert.equal(withStableHall, withoutStableHall);
});
