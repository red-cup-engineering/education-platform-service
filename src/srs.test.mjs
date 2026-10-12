import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallProbability, daysUntilRetention, reviewCard, FACTOR, DECAY, DEFAULT_TARGET_RETENTION } from './srs.mjs';

test('R(t=S) = 0.9 exactly -- the structural identity FACTOR is derived to guarantee', () => {
  const S = 5;
  const R = recallProbability(S, S);
  assert.ok(Math.abs(R - 0.9) < 1e-12, `expected 0.9, got ${R}`);
});

test('FACTOR is FSRS\'s published constant, not an arbitrary value', () => {
  assert.equal(DECAY, -0.5);
  assert.ok(Math.abs(FACTOR - 19 / 81) < 1e-15);
});

test('recallProbability degenerate guards: t<=0 certain, S<=0 forgotten', () => {
  assert.equal(recallProbability(0, 10), 1);
  assert.equal(recallProbability(-3, 10), 1);
  assert.equal(recallProbability(5, 0), 0);
  assert.equal(recallProbability(5, -1), 0);
});

test('daysUntilRetention inverts recallProbability at the default target', () => {
  const S = 8;
  const t = daysUntilRetention(S, DEFAULT_TARGET_RETENTION);
  assert.ok(Math.abs(t - S) < 1e-9, `expected t≈S=${S}, got ${t}`);
  const R = recallProbability(t, S);
  assert.ok(Math.abs(R - DEFAULT_TARGET_RETENTION) < 1e-9);
});

test('reviewCard: brand-new card seeds S0/D0 by grade, sets lastReviewedAt to now', () => {
  const state = reviewCard({ stability: 0, difficulty: 5 }, 3, 100);
  assert.equal(state.stability, 2.5);
  assert.equal(state.difficulty, 5);
  assert.equal(state.lastReviewedAt, 100);
});

test('reviewCard: grade 1 (Again) is a lapse -- stability falls to max(S0(1), S*0.2)', () => {
  const prior = { stability: 10, difficulty: 4, lastReviewedAt: 0 };
  const next = reviewCard(prior, 1, 5);
  assert.equal(next.stability, Math.max(0.4, 10 * 0.2));
  assert.ok(next.difficulty > prior.difficulty); // Again raises (worsens) difficulty
});

test('reviewCard: a successful review (grade >= 2) grows stability, never shrinks it', () => {
  const prior = { stability: 3, difficulty: 5, lastReviewedAt: 0 };
  const next = reviewCard(prior, 3, 3);
  assert.ok(next.stability > prior.stability);
});

test('reviewCard: difficulty is clipped to [1, 10]', () => {
  let state = { stability: 1, difficulty: 1, lastReviewedAt: 0 };
  state = reviewCard(state, 4, 1); // Easy repeatedly should never push difficulty below 1
  assert.ok(state.difficulty >= 1);
  state = { stability: 1, difficulty: 10, lastReviewedAt: 0 };
  state = reviewCard(state, 1, 1); // Again repeatedly should never push difficulty above 10
  assert.ok(state.difficulty <= 10);
});

test('reviewCard is deterministic: same inputs, same output, every time', () => {
  const a = reviewCard({ stability: 4, difficulty: 5, lastReviewedAt: 10 }, 3, 15);
  const b = reviewCard({ stability: 4, difficulty: 5, lastReviewedAt: 10 }, 3, 15);
  assert.deepEqual(a, b);
});
