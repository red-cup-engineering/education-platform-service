import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSetOfDueEvents } from '@red-cup-engineering/icalendar-services-section/derive-set-of-due-events';
import { mulberry32, seededShuffle, buildGateSession, buildReviewSession, dueReviewCandidates, nextDueEvent } from './session.mjs';
import { reviewCard } from './srs.mjs';

function ex(roomId, index) {
  return {
    id: `${roomId}#echo#${index}`,
    roomId,
    kind: 'echo',
    spec: index,
    prompt: `p${index}`,
    checker: (s, a) => ({ pass: s === a, diagnosis: '' }),
  };
}

test('mulberry32 is deterministic: same seed produces the same sequence every time', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('mulberry32 produces values in [0, 1)', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 50; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('different seeds produce different sequences (not a constant generator)', () => {
  const a = mulberry32(1)();
  const b = mulberry32(2)();
  assert.notEqual(a, b);
});

test('seededShuffle does not mutate its input', () => {
  const items = [1, 2, 3, 4, 5];
  const copy = items.slice();
  seededShuffle(items, 7);
  assert.deepEqual(items, copy);
});

test('seededShuffle is a permutation: same elements, same length', () => {
  const items = [1, 2, 3, 4, 5];
  const shuffled = seededShuffle(items, 7);
  assert.equal(shuffled.length, items.length);
  assert.deepEqual([...shuffled].sort(), [...items].sort());
});

test('buildGateSession is deterministic given the same seed', () => {
  const exercises = [ex('r', 0), ex('r', 1), ex('r', 2), ex('other', 0)];
  const s1 = buildGateSession('r', exercises, 99);
  const s2 = buildGateSession('r', exercises, 99);
  assert.deepEqual(s1.map((e) => e.id), s2.map((e) => e.id));
  assert.equal(s1.length, 3); // filters to the requested room only
});

test('buildGateSession with different seeds can (and generally does) produce different orders', () => {
  const exercises = [ex('r', 0), ex('r', 1), ex('r', 2), ex('r', 3), ex('r', 4)];
  const s1 = buildGateSession('r', exercises, 1).map((e) => e.id);
  const s2 = buildGateSession('r', exercises, 2).map((e) => e.id);
  assert.notDeepEqual(s1, s2);
});

test('buildReviewSession orders weakest-recall-first and excludes never-reviewed exercises', () => {
  const strong = { exercise: ex('a', 0), stability: 1000, lastReviewedAt: 0 };
  const weak = { exercise: ex('b', 0), stability: 0.001, lastReviewedAt: 0 };
  const neverReviewed = { exercise: ex('c', 0), stability: 5 }; // lastReviewedAt absent
  const session = buildReviewSession([strong, weak, neverReviewed], 100, 1);
  assert.equal(session.length, 2);
  assert.equal(session[0]?.exercise.roomId, 'b'); // weakest first
  assert.equal(session[1]?.exercise.roomId, 'a');
});

test('buildReviewSession respects an explicit limit deterministically', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({ exercise: ex('r', i), stability: 5, lastReviewedAt: 0 }));
  const s1 = buildReviewSession(candidates, 10, 3, 4);
  const s2 = buildReviewSession(candidates, 10, 3, 4);
  assert.equal(s1.length, 4);
  assert.deepEqual(s1.map((c) => c.exercise.id), s2.map((c) => c.exercise.id));
});

test('dueReviewCandidates, and buildReviewSession\'s dueOnly option, select exactly what derive-set-of-due-events-service selects over each candidate\'s FSRS-lite next-due VEVENT -- not a second, hand-rolled due comparison', () => {
  // reviewCard's own math (untouched by this cutover): a grade-1 (Again) review is due again at
  // S0[1]=0.4 days out, a grade-4 (Easy) review at S0[4]=4.5 days out -- the t(R=0.9)=S identity
  // srs.test.mts already proves for daysUntilRetention.
  const early = reviewCard({ stability: 0, difficulty: 5 }, 1, 0);
  const late = reviewCard({ stability: 0, difficulty: 5 }, 4, 0);
  const candidates = [
    { exercise: ex('a', 0), stability: early.stability, lastReviewedAt: early.lastReviewedAt },
    { exercise: ex('b', 0), stability: late.stability, lastReviewedAt: late.lastReviewedAt },
  ];
  const now = 1; // epoch day 1: past 'a's due day (0.4), before 'b's (4.5)

  // The iCalendar section's own answer, derived independently of session.mts's call site.
  const events = candidates
    .map((c, i) => nextDueEvent(String(i), c))
    .filter((e) => e !== null);
  const nowIso = new Date(Math.round(now * 86_400_000)).toISOString();
  const expected = deriveSetOfDueEvents({ events, now: nowIso });
  assert.deepEqual(new Set(expected.due.map((d) => d.id)), new Set(['0']));

  const due = dueReviewCandidates(candidates, now);
  assert.deepEqual(due.map((c) => c.exercise.roomId), ['a']);

  const session = buildReviewSession(candidates, now, 1, undefined, { dueOnly: true });
  assert.deepEqual(session.map((c) => c.exercise.roomId), ['a']);

  // dueOnly is additive: the default call keeps every prior test's contract (every reviewed
  // candidate is eligible, regardless of retention decay).
  const allEligible = buildReviewSession(candidates, now, 1);
  assert.equal(allEligible.length, 2);
});
