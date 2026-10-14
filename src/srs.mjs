/**
 * `srs` -- FSRS-lite, self-education-platform-design.md §3. Deterministic: every function that
 * needs "now" takes it as a parameter (an epoch day -- an integer day count, caller's choice of
 * epoch). Nothing in this module ever calls `Date.now()`.
 *
 * This education-platform-service module is the owning implementation of
 * theme-neutral SRS scheduling. Browser consumers project this exact source;
 * the upstream `src/srs*.test.mjs` files test the mathematics and transitions,
 * and the consuming app tests its projected artifact instead of re-porting
 * the mathematical test suite.
 *
 * The forgetting curve is real and cited, not invented for this project: `R(t,S) = (1 +
 * FACTOR*t/S)^DECAY` is FSRS's own published power-law forgetting curve (Su et al. /
 * open-spaced-repetition project), `DECAY=-0.5` and `FACTOR=19/81` are its own published
 * defaults. `FACTOR` is derived from `DECAY` so that `R = 0.9` exactly when `t = S` -- a
 * structural identity of the formula (verified in srs.test.mjs), not a coincidence.
 *
 * What IS a disclosed simplification: real FSRS fits ~19 weights per user from review history.
 * This module hand-sets one small fixed constant set below ("FSRS-lite") and never claims to be
 * the full optimizer.
 */

export const DECAY = -0.5;
/** = 0.9^(1/DECAY) − 1, FSRS's own published constant, not chosen for this project. */
export const FACTOR = 19 / 81;

/** New-card initial stability S0 (days), by grade. */
const S0 = { 1: 0.4, 2: 1.0, 3: 2.5, 4: 4.5 };
/** New-card initial difficulty D0 (1..10, lower = easier), by grade. */
const D0 = { 1: 8, 2: 6.5, 3: 5, 4: 3 };
/** Growth multiplier G for an existing card's successful review, by grade. Grade 1 (Again) uses
 * the separate lapse rule below and has no entry here. */
const GROWTH = { 2: 0.5, 3: 1.0, 4: 1.6 };

const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;

function clip(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Probability of correct recall right now: `t` days since last review, `S` current stability
 * (days). `t <= 0` is defined as certain recall (1); `S <= 0` is defined as certain forgetting
 * (0) -- both guards for degenerate inputs, not part of the published curve itself.
 */
export function recallProbability(t, S) {
  if (S <= 0) return 0;
  if (t <= 0) return 1;
  return Math.pow(1 + (FACTOR * t) / S, DECAY);
}

/** Inverse of `recallProbability` for `t`, solving the curve for `t` at a target retention `R`:
 * `t(R) = S * ((R^(1/DECAY) - 1) / FACTOR)`. At `R = 0.9` this equals `S` exactly. */
export function daysUntilRetention(S, targetR) {
  if (S <= 0) return 0;
  return S * ((Math.pow(targetR, 1 / DECAY) - 1) / FACTOR);
}


/**
 * Apply one FSRS-lite review to a card's state, platform §3. `now` is an epoch day supplied by
 * the caller. A card with no `lastReviewedAt` is brand-new -- this is also how the gate-pass
 * (platform §4) seeds an exercise straight into FSRS-lite: the gate-pass *is* the first SRS
 * review, so it goes through this exact path with the grade the practice pass earned.
 */
export function reviewCard(state, grade, now) {
  if (state.lastReviewedAt === undefined) {
    return { stability: S0[grade], difficulty: D0[grade], lastReviewedAt: now };
  }

  const t = Math.max(0, now - state.lastReviewedAt);
  const R = recallProbability(t, state.stability);

  let nextStability;
  if (grade === 1) {
    // Lapse: fixed 20%-retention-of-prior-stability rule, standing in for FSRS's fuller
    // stability-after-forgetting formula.
    nextStability = Math.max(S0[1], state.stability * 0.2);
  } else {
    const G = GROWTH[grade];
    nextStability = state.stability * (1 + 1.2 * (1 - R) * G);
  }

  const nextDifficulty = clip(state.difficulty - 1.0 * (grade - 3), MIN_DIFFICULTY, MAX_DIFFICULTY);

  return { stability: nextStability, difficulty: nextDifficulty, lastReviewedAt: now };
}

/** Default target retention used for "next due" scheduling. */
export const DEFAULT_TARGET_RETENTION = 0.9;

/** Light-stage cut points -- design constants (flavor); the day-multiples they imply are a
 * mechanical consequence of the real curve (load-bearing), not separately tuned -- see
 * `lightcone.mts`, which classifies directly from `R` rather than duplicating derived
 * multiples, so there is nothing here to drift out of sync with the curve. */
export const STAGE_CUTS = { full: 0.9, embers: 0.7, dim: 0.5 }         ;

const MS_PER_DAY = 86_400_000;

/** Integer epoch day (Unix day 0 = 1970-01-01) of a caller-supplied epoch-millisecond timestamp. */
export function epochDayOf(epochMillis) {
  return Math.floor(epochMillis / MS_PER_DAY);
}
