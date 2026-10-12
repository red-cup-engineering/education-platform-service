import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoKataPath, makeAutoKata, scoreCard, kataRatio, beltForRatio, awardedBelt, ratioToGrade, BELT_THRESHOLDS } from './kata.mjs';

function room(id, dateCreated) {
  return { id, wingId: 'w', title: id, aliases: [], kind: 'term', body: '', frontmatter: {}, dateCreated };
}

test('autoKataPath produces a valid topological order on an acyclic hall subgraph', () => {
  const rooms = [room('a', '2026-01-01'), room('b', '2026-01-02'), room('c', '2026-01-03')];
  const hall = { id: 'h', intent: [], rooms: ['a', 'b', 'c'], stable: false };
  const doors = [
    { from: 'a', to: 'b', weight: 'hard', reason: 'r' },
    { from: 'b', to: 'c', weight: 'hard', reason: 'r' },
  ];
  const path = autoKataPath(hall, doors, rooms);
  assert.deepEqual(path, ['a', 'b', 'c']);
});

test('autoKataPath visits every room in the hall exactly once, even with cycles', () => {
  const rooms = [room('a', '2026-01-01'), room('b', '2026-01-02'), room('c', '2026-01-03')];
  const hall = { id: 'h', intent: [], rooms: ['a', 'b', 'c'], stable: true };
  const doors = [
    { from: 'a', to: 'b', weight: 'hard', reason: 'r' },
    { from: 'b', to: 'c', weight: 'hard', reason: 'r' },
    { from: 'c', to: 'a', weight: 'hard', reason: 'r' },
  ];
  const path = autoKataPath(hall, doors, rooms);
  assert.deepEqual([...path].sort(), ['a', 'b', 'c']);
  assert.equal(path.length, 3);
});

test('autoKataPath is deterministic', () => {
  const rooms = [room('a', '2026-01-01'), room('b', '2026-01-02'), room('c', '2026-01-03')];
  const hall = { id: 'h', intent: [], rooms: ['a', 'b', 'c'], stable: false };
  const doors = [
    { from: 'b', to: 'a', weight: 'hard', reason: 'r' },
    { from: 'c', to: 'a', weight: 'hard', reason: 'r' },
  ];
  const p1 = autoKataPath(hall, doors, rooms);
  const p2 = autoKataPath(hall, doors, rooms);
  assert.deepEqual(p1, p2);
});

test('makeAutoKata seeds a Kata with the same (stability, difficulty) state shape as a card', () => {
  const rooms = [room('a', '2026-01-01')];
  const hall = { id: 'h', intent: [], rooms: ['a'], stable: false };
  const kata = makeAutoKata(hall, [], rooms);
  assert.equal(kata.origin, 'auto-hall');
  assert.equal(typeof kata.stability, 'number');
  assert.equal(typeof kata.difficulty, 'number');
});

test('scoreCard: Good/Easy within Tfast = 2, slower = 1, Hard = 0.5, Again = 0', () => {
  assert.equal(scoreCard({ outcome: 'good', responseTimeMs: 5000, tFastMs: 8000 }), 2);
  assert.equal(scoreCard({ outcome: 'easy', responseTimeMs: 3000, tFastMs: 8000 }), 2);
  assert.equal(scoreCard({ outcome: 'good', responseTimeMs: 9000, tFastMs: 8000 }), 1);
  assert.equal(scoreCard({ outcome: 'hard', responseTimeMs: 1000, tFastMs: 8000 }), 0.5);
  assert.equal(scoreCard({ outcome: 'again', responseTimeMs: 1000, tFastMs: 8000 }), 0);
});

test('kataRatio is total score over max possible (2 per card)', () => {
  const results = [
    { outcome: 'good', responseTimeMs: 1000, tFastMs: 8000 }, // 2
    { outcome: 'hard', responseTimeMs: 1000, tFastMs: 8000 }, // 0.5
  ];
  assert.equal(kataRatio(results), (2 + 0.5) / 4);
});

test('belt thresholds are monotonically ordered and cover the full [0,1] ratio range', () => {
  const sorted = [...BELT_THRESHOLDS].sort((a, b) => b.min - a.min);
  assert.deepEqual(BELT_THRESHOLDS.map((b) => b.belt), sorted.map((b) => b.belt));
  assert.equal(beltForRatio(0), 'white');
  assert.equal(beltForRatio(1), 'black');
  assert.equal(beltForRatio(0.97), 'black');
  assert.equal(beltForRatio(0.96), 'brown');
  assert.equal(beltForRatio(0.5), 'yellow');
  assert.equal(beltForRatio(0.49), 'white');
});

test('awardedBelt requires 3 consecutive clears and uses their minimum', () => {
  assert.equal(awardedBelt([0.97, 0.98]), 'white', 'fewer than 3 clears on record');
  assert.equal(awardedBelt([0.97, 0.98, 0.6]), 'yellow', 'one bad run in the last 3 caps the award');
  assert.equal(awardedBelt([0.97, 0.98, 0.99]), 'black');
});

test('ratioToGrade maps kata ratio to a synthetic SRS grade per DESIGN.md §5', () => {
  assert.equal(ratioToGrade(0.3), 1);
  assert.equal(ratioToGrade(0.6), 2);
  assert.equal(ratioToGrade(0.8), 3);
  assert.equal(ratioToGrade(0.95), 4);
});
