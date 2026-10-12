/**
 * New tests (not in the Equivo original): the grade-ordering properties `reviewCard`'s constant
 * tables (`S0`, `D0`, `GROWTH`) must preserve for grades to mean "Again < Hard < Good < Easy" in
 * both the new-card seed and the existing-card transition, plus the Again-is-a-lapse special
 * case being categorically different from every other grade's growth path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewCard } from './srs.mjs';

const GRADES = [1, 2, 3, 4];

test('new-card seeding: initial stability strictly increases with grade (Again < Hard < Good < Easy)', () => {
  const fresh = { stability: 0, difficulty: 5 };
  const stabilities = GRADES.map((g) => reviewCard(fresh, g, 0).stability);
  for (let i = 1; i < stabilities.length; i++) {
    assert.ok(
      stabilities[i] > stabilities[i - 1],
      `S0 not increasing at grade ${GRADES[i]}: ${stabilities.join(', ')}`,
    );
  }
});

test('new-card seeding: initial difficulty strictly decreases with grade (Again hardest, Easy easiest)', () => {
  const fresh = { stability: 0, difficulty: 5 };
  const difficulties = GRADES.map((g) => reviewCard(fresh, g, 0).difficulty);
  for (let i = 1; i < difficulties.length; i++) {
    assert.ok(
      difficulties[i] < difficulties[i - 1],
      `D0 not decreasing at grade ${GRADES[i]}: ${difficulties.join(', ')}`,
    );
  }
});

test('existing-card transition: a higher grade never yields a smaller next stability than a lower grade, same prior state', () => {
  const prior = { stability: 6, difficulty: 5, lastReviewedAt: 0 };
  const now = 6; // one stability-period elapsed, so R(t=S) = 0.9 for every grade's comparison
  const nextStabilities = GRADES.map((g) => reviewCard(prior, g, now).stability);
  for (let i = 1; i < nextStabilities.length; i++) {
    assert.ok(
      nextStabilities[i] > nextStabilities[i - 1],
      `stability not increasing at grade ${GRADES[i]}: ${nextStabilities.join(', ')}`,
    );
  }
});

test('existing-card transition: difficulty moves in the opposite direction of grade quality (Again worsens, Easy improves)', () => {
  const prior = { stability: 6, difficulty: 5, lastReviewedAt: 0 };
  const now = 6;
  const nextDifficulties = GRADES.map((g) => reviewCard(prior, g, now).difficulty);
  // grade order is [Again, Hard, Good, Easy]; difficulty should strictly decrease across it
  for (let i = 1; i < nextDifficulties.length; i++) {
    assert.ok(
      nextDifficulties[i] < nextDifficulties[i - 1],
      `difficulty not decreasing at grade ${GRADES[i]}: ${nextDifficulties.join(', ')}`,
    );
  }
  assert.equal(nextDifficulties[2], 5); // Good (grade 3) leaves difficulty unchanged, by construction
});

test('Again (grade 1) is categorically a lapse, not just the weakest growth step: it can reduce stability below every successful grade\'s prior value', () => {
  const prior = { stability: 50, difficulty: 5, lastReviewedAt: 0 };
  const now = 1; // barely any time elapsed -- a "successful" review would barely grow S from 50
  const again = reviewCard(prior, 1, now);
  const hard = reviewCard(prior, 2, now);
  assert.ok(again.stability < prior.stability, 'lapse should shrink stability');
  assert.ok(hard.stability >= prior.stability, 'a successful grade should never shrink stability');
  assert.ok(again.stability < hard.stability, 'lapse stability should land below the weakest successful grade');
});

test('repeated Good (grade 3) reviews monotonically grow stability across successive reviews', () => {
  let state = { stability: 0, difficulty: 5 };
  state = reviewCard(state, 3, 0); // seed
  let day = 0;
  let prevStability = state.stability;
  for (let i = 0; i < 5; i++) {
    day += Math.round(state.stability); // review right around the current predicted interval
    state = reviewCard(state, 3, day);
    assert.ok(state.stability > prevStability, `review ${i}: stability should keep growing`);
    prevStability = state.stability;
  }
});

test('reviewCard never returns a negative or zero stability for any grade, fresh or existing card', () => {
  const fresh = { stability: 0, difficulty: 5 };
  const existing = { stability: 2, difficulty: 5, lastReviewedAt: 0 };
  for (const g of GRADES) {
    assert.ok(reviewCard(fresh, g, 0).stability > 0);
    assert.ok(reviewCard(existing, g, 100).stability > 0);
  }
});
