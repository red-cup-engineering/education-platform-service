import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedPracticeGrades, lastPracticeEvidence, validStoredPracticeEvidence } from './practice-evidence.mjs';

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

test('producer/reader agreement across 64 mode-grade-attempt-time cases', () => {
  let valid = 0;
  let rejected = 0;
  for (const mode of ['gate', 'review'])
    for (const grade of [1, 2, 3, 4])
      for (const hadIncorrectAttempt of [false, true])
        for (const previousReviewDay of [undefined, 9, 10, 11]) {
          const input = { mode, grade, hadIncorrectAttempt, nowDay: 10, previousReviewDay };
          if (hadIncorrectAttempt && grade > 2) {
            assert.throws(() => lastPracticeEvidence(input), /cannot be called/);
            rejected++;
          } else {
            const record = lastPracticeEvidence(input);
            assert.equal(validStoredPracticeEvidence(JSON.parse(JSON.stringify(record))), true);
            assert.equal(record.clockDisordered, previousReviewDay === 11);
            assert.equal(record.daysSincePriorReview, previousReviewDay === undefined || previousReviewDay === 11 ? null : 10 - previousReviewDay);
            valid++;
          }
        }
  assert.deepEqual({ valid, rejected }, { valid: 48, rejected: 16 });
});

test('import reader rejects contradictory last-practice ratings, including nonfirst-try Good or Easy', () => {
  const base = lastPracticeEvidence({ mode: 'review', grade: 2, nowDay: 100, previousReviewDay: 99 });
  for (const grade of [3, 4]) {
    assert.equal(validStoredPracticeEvidence({ ...base, grade, correctBeforeFeedback: false }), false);
  }
  assert.equal(validStoredPracticeEvidence({ ...base, grade: 1, correctBeforeFeedback: true }), false);
  assert.equal(validStoredPracticeEvidence({ ...base, grade: 1, correctBeforeFeedback: false }), true);
  assert.equal(validStoredPracticeEvidence({ ...base, grade: 4, correctBeforeFeedback: true }), true);
  // Grade 2 alone cannot distinguish first try from a retry; both remain admissible.
  assert.equal(validStoredPracticeEvidence({ ...base, correctBeforeFeedback: false }), true);
});

test('calendar anomalies cannot supply a fabricated elapsed review interval', () => {
  const base = lastPracticeEvidence({ mode: 'review', grade: 2, nowDay: 10, previousReviewDay: 11 });
  assert.equal(base.clockDisordered, true);
  assert.equal(base.daysSincePriorReview, null);
  for (const forged of [0, 1, 7, 365]) {
    assert.equal(validStoredPracticeEvidence({ ...base, daysSincePriorReview: forged }), false);
  }
  // Missing previous review is unknown, rather than a made-up zero-day interval.
  const noPrior = lastPracticeEvidence({ mode: 'gate', grade: 2, nowDay: 10 });
  assert.equal(validStoredPracticeEvidence(noPrior), true);
  assert.equal(noPrior.daysSincePriorReview, null);
  assert.equal(noPrior.clockDisordered, false);
});

test('unsafe epoch dates and elapsed durations are rejected without rounding a witness', () => {
  const base = lastPracticeEvidence({ mode: 'review', grade: 3, nowDay: 10, previousReviewDay: 9 });
  for (const badDate of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), 0.25, Infinity, NaN]) {
    assert.throws(() => lastPracticeEvidence({ mode: 'review', grade: 3, nowDay: badDate }), /integer/);
    assert.equal(validStoredPracticeEvidence({ ...base, observedAtDay: badDate }), false);
  }
  for (const badPrior of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), 0.5, Infinity]) {
    assert.throws(() => lastPracticeEvidence({ mode: 'review', grade: 3, nowDay: 10, previousReviewDay: badPrior }), /integer/);
  }
  assert.throws(() => lastPracticeEvidence({ mode: 'review', grade: 3, nowDay: Number.MAX_SAFE_INTEGER, previousReviewDay: -Number.MAX_SAFE_INTEGER }), /safe integer/);
  for (const badDuration of [Number.MAX_SAFE_INTEGER + 1, -1, 0.5, Infinity, NaN]) {
    assert.equal(validStoredPracticeEvidence({ ...base, daysSincePriorReview: badDuration }), false);
  }
  assert.equal(validStoredPracticeEvidence({ ...base, observedAtDay: -Number.MAX_SAFE_INTEGER, daysSincePriorReview: Number.MAX_SAFE_INTEGER }), false);
});

test('stored evidence rejects privilege-forgery and schema-downgrade mutations', () => {
  const base = lastPracticeEvidence({ mode: 'review', grade: 3, nowDay: 15, previousReviewDay: 8 });
  const mutants = [
    { kind: 'education.local-practice' }, { mode: 'field-assessment' },
    { independentAssessment: true }, { credentialIssued: true },
    { grade: 5 }, { correctBeforeFeedback: 'true' },
    { clockDisordered: 'false' }, { observedAtDay: '15' },
    { daysSincePriorReview: '7' }, { daysSincePriorReview: -1 },
  ];
  for (const mutation of mutants) {
    assert.equal(validStoredPracticeEvidence({ ...base, ...mutation }), false, JSON.stringify(mutation));
  }
});

test('last practice is not proof of transfer even when the grade and interval match', () => {
  const a = lastPracticeEvidence({ mode: 'gate', grade: 2, nowDay: 100, hadIncorrectAttempt: false });
  const b = lastPracticeEvidence({ mode: 'gate', grade: 2, nowDay: 100, hadIncorrectAttempt: true });
  assert.equal(a.grade, b.grade);
  assert.notEqual(a.correctBeforeFeedback, b.correctBeforeFeedback);
  for (const observation of [a, b]) {
    assert.equal(observation.independentAssessment, false);
    assert.equal(observation.credentialIssued, false);
    assert.equal(validStoredPracticeEvidence(observation), true);
  }
});
