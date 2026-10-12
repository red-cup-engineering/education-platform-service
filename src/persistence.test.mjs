import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryAdapter,
  loadPlayerState,
  savePlayerState,
  effectiveExerciseState,
  recordExerciseReview,
  touchStreak,
  streakAtRisk,
  exportStateJson,
  importStateJson,
  today,
  SCHEMA_VERSION,
} from './persistence.mjs';

test('loadPlayerState on an empty adapter returns a fresh, correctly-versioned state', () => {
  const state = loadPlayerState(memoryAdapter(), 'equivo');
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.themeId, 'equivo');
  assert.deepEqual(state.exercises, {});
});

test('save then load round-trips exactly', () => {
  const adapter = memoryAdapter();
  const state = loadPlayerState(adapter, 'equivo');
  const next = recordExerciseReview(state, 'r#measure#0', { stability: 2.5, difficulty: 5, lastReviewedAt: 3 });
  savePlayerState(adapter, next);
  const reloaded = loadPlayerState(adapter, 'equivo');
  assert.deepEqual(reloaded.exercises['r#measure#0'], { stability: 2.5, difficulty: 5, lastReviewedAt: 3 });
});

test('two themes on the same adapter never collide', () => {
  const adapter = memoryAdapter();
  const equivo = recordExerciseReview(loadPlayerState(adapter, 'equivo'), 'x', { stability: 1, difficulty: 5, lastReviewedAt: 1 });
  savePlayerState(adapter, equivo);
  const weiqi = loadPlayerState(adapter, 'weiqi-learn');
  assert.deepEqual(weiqi.exercises, {});
});

test('corrupt JSON in storage degrades to a fresh state, never throws', () => {
  const adapter = memoryAdapter();
  adapter.setItem('education-platform:equivo', '{not json');
  const state = loadPlayerState(adapter, 'equivo');
  assert.deepEqual(state.exercises, {});
});

test('pre-versioned (schemaVersion missing) data is treated as untrustworthy, not guessed at', () => {
  const adapter = memoryAdapter();
  adapter.setItem('education-platform:equivo', JSON.stringify({ exercises: { x: { stability: 99 } } }));
  const state = loadPlayerState(adapter, 'equivo');
  assert.deepEqual(state.exercises, {});
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
});

test('effectiveExerciseState: local override wins; else the theme-supplied seed default applies', () => {
  const adapter = memoryAdapter();
  const state = loadPlayerState(adapter, 'equivo');
  const fresh = effectiveExerciseState(state, 'never-reviewed', { stability: 0, difficulty: 5 });
  assert.deepEqual(fresh, { stability: 0, difficulty: 5, lastReviewedAt: undefined });

  const reviewed = recordExerciseReview(state, 'seen', { stability: 4, difficulty: 3, lastReviewedAt: 9 });
  const effective = effectiveExerciseState(reviewed, 'seen', { stability: 0, difficulty: 5 });
  assert.deepEqual(effective, { stability: 4, difficulty: 3, lastReviewedAt: 9 });
});

test('touchStreak: consecutive days increment; a gap of 2+ with no freeze resets to 1', () => {
  let streak = { current: 0, longest: 0, lastActiveDay: null, freezeTokens: 0, freezesUsed: 0 };
  streak = touchStreak(streak, 1);
  assert.equal(streak.current, 1);
  streak = touchStreak(streak, 2);
  assert.equal(streak.current, 2);
  streak = touchStreak(streak, 2); // same day again: idempotent
  assert.equal(streak.current, 2);
  streak = touchStreak(streak, 10); // big gap, no freeze available
  assert.equal(streak.current, 1);
});

test('touchStreak: a banked freeze token covers exactly one missed day', () => {
  let streak = { current: 6, longest: 6, lastActiveDay: 1, freezeTokens: 1, freezesUsed: 0 };
  streak = touchStreak(streak, 3); // gap of 2, one freeze available
  assert.equal(streak.current, 7);
  // The freeze spent to cover the gap is consumed (freezesUsed increments), but landing on day 7
  // of the streak also hits the milestone rule below, re-banking a token in the same call.
  assert.equal(streak.freezeTokens, 1);
  assert.equal(streak.freezesUsed, 1);
});

test('touchStreak: every 7th day of streak banks a new freeze token, capped at 3', () => {
  let streak = { current: 6, longest: 6, lastActiveDay: 6, freezeTokens: 3, freezesUsed: 0 };
  streak = touchStreak(streak, 7); // current becomes 7 -> milestone
  assert.equal(streak.current, 7);
  assert.equal(streak.freezeTokens, 3); // already capped
});

test('streakAtRisk is a pure read, never mutates', () => {
  const streak = { current: 3, longest: 3, lastActiveDay: 5, freezeTokens: 0, freezesUsed: 0 };
  assert.equal(streakAtRisk(streak, 5), false);
  assert.equal(streakAtRisk(streak, 6), true);
  assert.equal(streakAtRisk({ ...streak, lastActiveDay: null }, 6), false);
});

test('exportStateJson / importStateJson round-trip', () => {
  const adapter = memoryAdapter();
  const state = recordExerciseReview(loadPlayerState(adapter, 'equivo'), 'r#measure#0', { stability: 1, difficulty: 5, lastReviewedAt: 2 });
  const json = exportStateJson(state);
  const imported = importStateJson(json);
  assert.deepEqual(imported, state);
});

test('today() derives an integer epoch day from a clock, never calling Date.now() implicitly in domain logic', () => {
  const day0 = today(0);
  const oneDayLater = today(86_400_000);
  assert.equal(day0, 0);
  assert.equal(oneDayLater, 1);
});
