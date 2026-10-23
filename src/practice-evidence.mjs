/**
 * Provenance of the *last local practice attempt*, not a credential or a
 * statistically demonstrated learning outcome. The SRS state is a scheduling
 * estimate; a repeat after revealing feedback is not an independent recall.
 *
 * Source theory: backward design distinguishes immediate recognition from
 * delayed or situated independent performance. Preserve that distinction in
 * the original browser controller without replacing the education engine.
 */
const FIRST_TRY_GRADES = Object.freeze([
  Object.freeze([2, 'grade-hard', 'Hard']),
  Object.freeze([3, 'grade-good', 'Good']),
  Object.freeze([4, 'grade-easy', 'Easy']),
]);
const RETRIED_GRADES = Object.freeze([
  Object.freeze([2, 'grade-hard', 'Continue — retry needs earlier review']),
]);

export function allowedPracticeGrades({ failedBeforeSuccess = false } = {}) {
  return failedBeforeSuccess ? RETRIED_GRADES : FIRST_TRY_GRADES;
}

export function lastPracticeEvidence({
  mode, grade, hadIncorrectAttempt = false, nowDay, previousReviewDay,
} = {}) {
  if (!['gate', 'review'].includes(mode)) throw new TypeError('unknown practice mode');
  if (![1, 2, 3, 4].includes(grade)) throw new TypeError('unknown practice grade');
  if (typeof hadIncorrectAttempt !== 'boolean') throw new TypeError('incorrect-attempt flag must be boolean');
  if (!Number.isInteger(nowDay)) throw new TypeError('an observed epoch day is required');
  if (previousReviewDay !== undefined && !Number.isInteger(previousReviewDay)) throw new TypeError('previous review must be an integer day');
  if (hadIncorrectAttempt && grade > 2) throw new TypeError('a retried success cannot be called Good or Easy');
  const clockDisordered = previousReviewDay !== undefined && nowDay < previousReviewDay;
  return Object.freeze({
    kind: 'education.local-practice/v1',
    mode,
    observedAtDay: nowDay,
    daysSincePriorReview: previousReviewDay === undefined || clockDisordered ? null : nowDay - previousReviewDay,
    clockDisordered,
    correctBeforeFeedback: grade >= 2 && !hadIncorrectAttempt,
    grade,
    independentAssessment: false,
    credentialIssued: false,
  });
}


/** Admit a locally exported last-practice note as non-authoritative evidence only. */
export function validStoredPracticeEvidence(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    value.kind === 'education.local-practice/v1' &&
    ['gate', 'review'].includes(value.mode) &&
    Number.isInteger(value.observedAtDay) &&
    (value.daysSincePriorReview === null || (Number.isInteger(value.daysSincePriorReview) && value.daysSincePriorReview >= 0)) &&
    typeof value.clockDisordered === 'boolean' &&
    typeof value.correctBeforeFeedback === 'boolean' &&
    [1, 2, 3, 4].includes(value.grade) &&
    value.independentAssessment === false &&
    value.credentialIssued === false &&
    !(value.correctBeforeFeedback === true && value.grade === 1);
}
