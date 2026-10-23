import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedPracticeGrades, lastPracticeEvidence } from './practice-evidence.mjs';

test('first-attempt success and correct-after-feedback do not offer identical SRS grades', () => {
  assert.deepEqual(allowedPracticeGrades().map(([grade]) => grade), [2, 3, 4]);
  assert.deepEqual(allowedPracticeGrades({ failedBeforeSuccess: true }).map(([grade]) => grade), [2]);
});

test('identical final grade can have different witnessed first-attempt histories', () => {
  const base = { mode: 'gate', grade: 2, nowDay: 20800 };
  const firstTry = lastPracticeEvidence({ ...base, hadIncorrectAttempt: false });
  const retried = lastPracticeEvidence({ ...base, hadIncorrectAttempt: true });
  assert.equal(firstTry.correctBeforeFeedback, true);
  assert.equal(retried.correctBeforeFeedback, false);
  assert.equal(retried.credentialIssued, false);
  assert.equal(firstTry.independentAssessment, false);
  assert.equal(retried.daysSincePriorReview, null);
  assert.deepEqual([firstTry.grade, retried.grade], [2, 2], 'equal scalar grade does not determine the histories');
});

test('a delayed review is distinguished from an immediate retry but not declared competence', () => {
  const nowDay = 20807;
  const sameDay = lastPracticeEvidence({ mode: 'review', grade: 3, nowDay, previousReviewDay: nowDay });
  const delayed = lastPracticeEvidence({ mode: 'review', grade: 3, nowDay, previousReviewDay: nowDay - 7 });
  assert.equal(sameDay.daysSincePriorReview, 0);
  assert.equal(delayed.daysSincePriorReview, 7);
  assert.equal(delayed.correctBeforeFeedback, true);
  assert.equal(delayed.independentAssessment, false);
  const failedReview = lastPracticeEvidence({ mode: 'review', grade: 1, nowDay, previousReviewDay: nowDay - 7, hadIncorrectAttempt: true });
  assert.equal(failedReview.correctBeforeFeedback, false);
  assert.equal(failedReview.grade, 1);
});

test('a device clock moving backwards does not fabricate elapsed-time evidence', () => {
  const reading = lastPracticeEvidence({ mode: 'review', grade: 2, nowDay: 4, previousReviewDay: 10 });
  assert.equal(reading.daysSincePriorReview, null);
  assert.equal(reading.clockDisordered, true);
});

test('bad or inflated practice observations are refused', () => {
  assert.throws(() => lastPracticeEvidence({ mode: 'gate', grade: 4, nowDay: 10, hadIncorrectAttempt: true }), /cannot be called Good or Easy/);
  assert.throws(() => lastPracticeEvidence({ mode: 'unknown', grade: 3, nowDay: 10 }), /mode/);
  assert.throws(() => lastPracticeEvidence({ mode: 'gate', grade: 5, nowDay: 10 }), /grade/);
  assert.throws(() => lastPracticeEvidence({ mode: 'review', grade: 2, nowDay: 0.5 }), /integer/);
});
