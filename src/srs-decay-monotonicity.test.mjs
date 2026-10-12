/**
 * New tests (not in the Equivo original): the two monotonicity properties the power-law
 * forgetting curve `R(t,S) = (1 + FACTOR*t/S)^DECAY` must have for it to behave as a forgetting
 * curve at all — recall falling as time since review grows, and recall rising as stability
 * grows for a fixed elapsed time. These are consequences of `DECAY < 0`, not separately tuned
 * constants, so the tests sweep a spread of values rather than checking one pair.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallProbability, daysUntilRetention, DEFAULT_TARGET_RETENTION } from './srs.mjs';

test('recallProbability is strictly decreasing in t for fixed S (decay, not growth)', () => {
  const S = 10;
  const ts = [0, 1, 2, 5, 10, 20, 50, 100, 365];
  let prevR = Infinity;
  for (const t of ts) {
    const R = recallProbability(t, S);
    assert.ok(R < prevR, `R(t=${t}, S=${S}) = ${R} should be < previous ${prevR}`);
    prevR = R;
  }
});

test('recallProbability is strictly increasing in S for fixed t (more stable = better recalled)', () => {
  const t = 10;
  const Ss = [0.4, 1, 2.5, 4.5, 10, 30, 90, 365];
  let prevR = -Infinity;
  for (const S of Ss) {
    const R = recallProbability(t, S);
    assert.ok(R > prevR, `R(t=${t}, S=${S}) = ${R} should be > previous ${prevR}`);
    prevR = R;
  }
});

test('recallProbability stays within [0, 1] across a wide sweep -- never negative, never above certain', () => {
  for (const S of [0.1, 1, 10, 100, 1000]) {
    for (const t of [0, 0.5, 1, 10, 100, 1000, 10000]) {
      const R = recallProbability(t, S);
      assert.ok(R >= 0 && R <= 1, `R(t=${t}, S=${S}) = ${R} out of [0,1]`);
    }
  }
});

test('recallProbability approaches 0 as t grows arbitrarily large relative to S (real decay, not an asymptote above 0)', () => {
  // A power-law tail decays far slower than an exponential one -- this is a real property of
  // FSRS's own curve, not a looseness in the test: R ~ (FACTOR*t/S)^DECAY for large t, so R
  // only reaches very small values at very large t. The assertion checks the shape (decaying
  // toward 0, not toward some floor above it) across increasing t, rather than picking one
  // threshold that happens to look tight.
  const S = 5;
  const R1 = recallProbability(1_000, S);
  const R2 = recallProbability(1_000_000, S);
  const R3 = recallProbability(1_000_000_000, S);
  assert.ok(R2 < R1, `R should keep falling: R(1e3)=${R1}, R(1e6)=${R2}`);
  assert.ok(R3 < R2, `R should keep falling: R(1e6)=${R2}, R(1e9)=${R3}`);
  assert.ok(R3 < 1e-3, `expected R to have decayed to well under 1e-3 by t=1e9, got ${R3}`);
});

test('daysUntilRetention is monotonic with recallProbability: a lower target retention always yields a longer interval', () => {
  const S = 20;
  const targets = [0.99, 0.95, 0.9, 0.8, 0.7];
  let prevT = -Infinity;
  for (const target of targets) {
    const t = daysUntilRetention(S, target);
    assert.ok(t > prevT, `t(target=${target}) = ${t} should be > previous ${prevT}`);
    prevT = t;
  }
  // Sanity: the default target (0.9) sits between the tighter and looser targets swept above.
  const tDefault = daysUntilRetention(S, DEFAULT_TARGET_RETENTION);
  assert.ok(tDefault > daysUntilRetention(S, 0.95) && tDefault < daysUntilRetention(S, 0.8));
});
