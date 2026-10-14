import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallProbability, daysUntilRetention, reviewCard, epochDayOf, FACTOR, DECAY, DEFAULT_TARGET_RETENTION, STAGE_CUTS } from './srs.mjs';

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

test('retention identities hold over representative SRS stabilities, not a single example', () => {
  for (const stability of [0.4, 1, 2.5, 4.5, 10, 30, 90, 365]) {
    assert.ok(Math.abs(recallProbability(stability, stability) - 0.9) < 1e-12,
      `stability=${stability}: R(S,S) must be 0.9`);
    const elapsed = daysUntilRetention(stability, DEFAULT_TARGET_RETENTION);
    assert.ok(Math.abs(elapsed - stability) < 1e-9,
      `stability=${stability}: the retention inverse must recover S`);
  }
});

test('epochDayOf uses UTC floor boundaries, including before the Unix epoch', () => {
  assert.equal(epochDayOf(0), 0);
  assert.equal(epochDayOf(86_400_000 - 1), 0);
  assert.equal(epochDayOf(86_400_000), 1);
  assert.equal(epochDayOf(2 * 86_400_000 + 3_600_000), 2);
  assert.equal(epochDayOf(-1), -1, 'the final millisecond before epoch 0 is day -1');
  assert.equal(epochDayOf(-86_400_000), -1);
  assert.equal(epochDayOf(-86_400_001), -2);
});

test('retention declines with elapsed days and increases with stability, within physical bounds', () => {
  for (const stability of [0.4, 1, 5, 90]) {
    let previous = recallProbability(0, stability);
    for (let day = 1; day <= 50; day++) {
      const value = recallProbability(day, stability);
      assert.ok(value > 0 && value <= previous && value <= 1, `S=${stability} day=${day}`);
      previous = value;
    }
  }
  assert.ok(recallProbability(3, 100) > recallProbability(3, 1));
});

test('long sequences of Good reviews grow or preserve stability and difficulty remains bounded', () => {
  let card = { stability: 0, difficulty: 0 };
  card = reviewCard(card, 3, 0);
  let lastStability = card.stability;
  let now = 0;
  for (let i = 0; i < 10; i++) {
    now += Math.max(1, Math.round(card.stability));
    card = reviewCard(card, 3, now);
    assert.ok(card.stability >= lastStability, `good review ${i} cannot shrink stability`);
    assert.ok(card.difficulty >= 1 && card.difficulty <= 10);
    lastStability = card.stability;
  }
  for (const grade of [1, 4]) {
    let boundary = { stability: 1, difficulty: grade === 1 ? 10 : 1, lastReviewedAt: 0 };
    for (let i = 0; i < 30; i++) {
      boundary = reviewCard(boundary, grade, i + 1);
      assert.ok(boundary.difficulty >= 1 && boundary.difficulty <= 10);
    }
  }
});

test('published stage cuts retain the upstream light/embers/dim interpretation', () => {
  assert.deepEqual(STAGE_CUTS, { full: 0.9, embers: 0.7, dim: 0.5 });
});
