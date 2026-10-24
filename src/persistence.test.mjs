import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryAdapter,
  loadPlayerState,
  savePlayerState,
  effectiveExerciseState,
  recordExerciseReview,
  rememberCourseRoom,
  touchStreak,
  streakAtRisk,
  exportStateJson,
  importStateJson,
  today,
  SCHEMA_VERSION,
} from './persistence.mjs';
import { lastPracticeEvidence } from './practice-evidence.mjs';

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


test('optional local attempt provenance survives save, reload and export without changing old saved states', () => {
  const storage = memoryAdapter();
  const original = loadPlayerState(storage, 'academy-course');
  const practice = lastPracticeEvidence({ mode: 'gate', grade: 2, nowDay: 21000, hadIncorrectAttempt: true });
  const updated = recordExerciseReview(original, 'unit#choice#1', {
    stability: 1, difficulty: 6.5, lastReviewedAt: 21000, lastPractice: practice,
  });
  savePlayerState(storage, updated);
  const reloaded = loadPlayerState(storage, 'academy-course');
  assert.equal(reloaded.exercises['unit#choice#1'].lastPractice.correctBeforeFeedback, false);
  assert.equal(reloaded.exercises['unit#choice#1'].lastPractice.credentialIssued, false);
  assert.deepEqual(importStateJson(exportStateJson(updated)), updated);
  const legacy = recordExerciseReview(original, 'unit#choice#1', {
    stability: 1, difficulty: 6.5, lastReviewedAt: 21000,
  });
  assert.deepEqual(importStateJson(exportStateJson(legacy)), legacy);
});

test('import cannot upgrade last local-practice evidence into an independently received credential', () => {
  const original = loadPlayerState(memoryAdapter(), 'academy-course');
  const practice = lastPracticeEvidence({ mode: 'review', grade: 2, nowDay: 21007, previousReviewDay: 21000 });
  const populated = recordExerciseReview(original, 'unit#choice#1', {
    stability: 1, difficulty: 6.5, lastReviewedAt: 21007,
    lastPractice: { ...practice, credentialIssued: true },
  });
  assert.throws(() => exportStateJson(populated), /local-state schema/);
  assert.equal(importStateJson(JSON.stringify(populated)), null);
});


test('local study resume is preserved across save/reload but cannot bypass course identity', () => {
  const adapter = memoryAdapter();
  const original = loadPlayerState(adapter, 'course-one');
  const remembered = rememberCourseRoom(original, 'lesson-two');
  assert.equal(remembered.lastVisitedRoomId, 'lesson-two');
  assert.equal(original.lastVisitedRoomId, undefined);
  savePlayerState(adapter, remembered);
  assert.equal(loadPlayerState(adapter, 'course-one').lastVisitedRoomId, 'lesson-two');
  assert.equal(loadPlayerState(adapter, 'course-two').lastVisitedRoomId, undefined);
  assert.deepEqual(importStateJson(exportStateJson(remembered)), remembered);
  assert.throws(() => rememberCourseRoom(original, ''), /real room/);
  assert.throws(() => rememberCourseRoom(original, 42), /real room/);
  assert.equal(importStateJson(JSON.stringify({ ...remembered, lastVisitedRoomId: 42 })), null);
});

test('local practice note and saved SRS event must refer to the identical observed review day', () => {
  const initial = loadPlayerState(memoryAdapter(), 'academy');
  const evidence = lastPracticeEvidence({ mode: 'review', grade: 3, nowDay: 500, previousReviewDay: 490 });
  const valid = recordExerciseReview(initial, 'room#choice#0', {
    stability: 1.5, difficulty: 5, lastReviewedAt: 500, lastPractice: evidence,
  });
  assert.deepEqual(importStateJson(exportStateJson(valid)), valid);
  for (const changedReview of [499, 501, undefined]) {
    const stale = recordExerciseReview(initial, 'room#choice#0', {
      stability: 1.5, difficulty: 5, lastReviewedAt: changedReview, lastPractice: evidence,
    });
    assert.throws(() => exportStateJson(stale), /local-state schema/);
    assert.equal(importStateJson(JSON.stringify(stale)), null);
  }
  const alteredPractice = recordExerciseReview(initial, 'room#choice#0', {
    stability: 1.5, difficulty: 5, lastReviewedAt: 500,
    lastPractice: { ...evidence, observedAtDay: 499 },
  });
  assert.equal(importStateJson(JSON.stringify(alteredPractice)), null);
});

test('legacy v1 evidence-free progress persists while invalid local evidence cannot overwrite it', () => {
  const store = memoryAdapter();
  const initial = loadPlayerState(store, 'learning');
  const legacy = recordExerciseReview(initial, 'lesson#match#0', { stability: 4.5, difficulty: 5, lastReviewedAt: 60 });
  savePlayerState(store, legacy);
  assert.deepEqual(loadPlayerState(store, 'learning'), legacy);
  const candidate = recordExerciseReview(legacy, 'lesson#match#0', {
    stability: 6, difficulty: 4, lastReviewedAt: 65,
    lastPractice: { ...lastPracticeEvidence({ mode: 'review', grade: 4, nowDay: 65, previousReviewDay: 60 }), correctBeforeFeedback: false },
  });
  assert.equal(importStateJson(JSON.stringify(candidate)), null);
  assert.deepEqual(loadPlayerState(store, 'learning'), legacy);
});

test('seven-course seeded transfer of import guard refuses 300 mismatched-card dates', () => {
  // Same deterministic corpus as practice-evidence.test: this checks a different
  // consumer (versioned save import), not a second copy of the practice reader.
  let seed = 0x561c0de;
  function next() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  }
  let rejected = 0;
  for (let i = 0; i < 300; i++) {
    const nowDay = 8000 + next() % 22000;
    const grade = [2, 3, 4][next() % 3];
    const mode = next() % 2 ? 'review' : 'gate';
    const previousReviewDay = nowDay - (1 + next() % 1000);
    const prior = loadPlayerState(memoryAdapter(), 'course-' + i % 7);
    const evidence = lastPracticeEvidence({ mode, grade, nowDay, previousReviewDay });
    const card = { stability: 2, difficulty: 5, lastReviewedAt: nowDay, lastPractice: evidence };
    const valid = recordExerciseReview(prior, 'sample-' + i, card);
    assert.deepEqual(importStateJson(exportStateJson(valid)), valid);
    const forged = recordExerciseReview(prior, 'sample-' + i, { ...card, lastReviewedAt: nowDay + 1 });
    assert.equal(importStateJson(JSON.stringify(forged)), null);
    rejected++;
  }
  assert.equal(rejected, 300);
});
