import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallProbability, daysUntilRetention, reviewCard, DECAY, FACTOR, DEFAULT_TARGET_RETENTION } from './srs.mjs';

test('R(t=S) = 0.9 exactly — the structural identity FACTOR is derived to produce', () => {
  for (const S of [0.4, 1, 2.5, 10, 100]) {
    const R = recallProbability(S, S);
    assert.ok(Math.abs(R - 0.9) < 1e-9, `expected R(S,S)=0.9, got ${R} for S=${S}`);
  }
});

test('daysUntilRetention(S, 0.9) === S exactly, the inverse identity', () => {
  for (const S of [0.4, 1, 2.5, 10, 100]) {
    const t = daysUntilRetention(S, DEFAULT_TARGET_RETENTION);
    assert.ok(Math.abs(t - S) < 1e-9, `expected t(0.9)=S=${S}, got ${t}`);
  }
});

test('recallProbability is monotonically decreasing in t and increasing in S', () => {
  const S = 5;
  let prev = recallProbability(0, S);
  for (let t = 1; t <= 50; t++) {
    const R = recallProbability(t, S);
    assert.ok(R <= prev, `R should not increase with t: R(${t})=${R} > R(${t - 1})=${prev}`);
    prev = R;
  }
  const R_lowS = recallProbability(3, 1);
  const R_highS = recallProbability(3, 100);
  assert.ok(R_highS > R_lowS);
});

test('recallProbability is bounded in (0, 1] and handles t=0 / degenerate S', () => {
  assert.equal(recallProbability(0, 5), 1);
  assert.equal(recallProbability(10, 0), 0);
  const R = recallProbability(1000, 1);
  assert.ok(R > 0 && R <= 1);
});

test('new-card review seeds stability/difficulty from the grade table and sets lastReviewedAt', () => {
  const now = 100;
  const easy = reviewCard({ stability: 0, difficulty: 0 }, 4, now);
  assert.equal(easy.stability, 4.5);
  assert.equal(easy.difficulty, 3);
  assert.equal(easy.lastReviewedAt, now);

  const again = reviewCard({ stability: 0, difficulty: 0 }, 1, now);
  assert.equal(again.stability, 0.4);
  assert.equal(again.difficulty, 8);
});

test('lapse rule: Again drops stability to max(S0(Again), 20% of prior)', () => {
  const now = 50;
  const highStability = reviewCard({ stability: 100, difficulty: 5, lastReviewedAt: 40 }, 1, now);
  assert.ok(Math.abs(highStability.stability - 20) < 1e-9); // 100 * 0.2 = 20, dominates S0(1)=0.4

  const lowStability = reviewCard({ stability: 1, difficulty: 5, lastReviewedAt: 40 }, 1, now);
  assert.equal(lowStability.stability, 0.4); // S0(1) dominates 1*0.2=0.2
});

test('stability is monotonically non-decreasing across successive Good/Easy reviews at fixed cadence', () => {
  let card = { stability: 0, difficulty: 0 };
  let now = 0;
  card = reviewCard(card, 3, now);
  let prevStability = card.stability;
  for (let i = 0; i < 10; i++) {
    now += Math.round(card.stability); // review right around the due date each time
    card = reviewCard(card, 3, now);
    assert.ok(card.stability >= prevStability, `stability should grow: ${card.stability} < ${prevStability}`);
    prevStability = card.stability;
  }
});

test('difficulty stays clipped to [1, 10] under repeated Again/Easy extremes', () => {
  let card = { stability: 1, difficulty: 5 };
  let now = 0;
  for (let i = 0; i < 30; i++) {
    now += 1;
    card = reviewCard(card, 1, now);
    assert.ok(card.difficulty <= 10 && card.difficulty >= 1);
  }
  card = { stability: 1, difficulty: 5, lastReviewedAt: 0 };
  now = 0;
  for (let i = 0; i < 30; i++) {
    now += 1;
    card = reviewCard(card, 4, now);
    assert.ok(card.difficulty <= 10 && card.difficulty >= 1);
  }
});

test('determinism: same state + grade + now always produces the same next state', () => {
  const state = { stability: 3.2, difficulty: 6, lastReviewedAt: 10 };
  const a = reviewCard(state, 3, 15);
  const b = reviewCard(state, 3, 15);
  assert.deepEqual(a, b);
});

test('DECAY and FACTOR are FSRS\'s published defaults, not arbitrary values', () => {
  assert.equal(DECAY, -0.5);
  assert.ok(Math.abs(FACTOR - 19 / 81) < 1e-12);
  assert.ok(Math.abs(FACTOR - (Math.pow(0.9, 1 / DECAY) - 1)) < 1e-9);
});
