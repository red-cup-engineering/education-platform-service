import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { attachChoices } from './choices.mjs';

function room(id, title, description, kind = 'term', aliases = []) {
  return { id, wingId: 'w', title, aliases, kind, description, body: '', frontmatter: {} };
}

function card(roomId, index = 0) {
  return { id: `${roomId}#term-from-def#${index}`, roomId, kind: 'term-from-def', front: 'Which term?', back: roomId, stability: 0, difficulty: 5 };
}

test('choices are deterministic, contain the answer, and prefer a smaller shared hall', () => {
  const rooms = [
    room('answer', 'Answer', 'Answer is the focal concept.'),
    room('small', 'Small neighbour', 'Small neighbour is nearby.'),
    room('large', 'Large neighbour', 'Large neighbour is broad.'),
    room('other-1', 'Other one', 'Other one is unrelated.'),
    room('other-2', 'Other two', 'Other two is unrelated.'),
  ];
  const halls = [
    { id: 'small-hall', rooms: ['answer', 'small'], intent: [], stable: true },
    { id: 'large-hall', rooms: ['answer', 'large', 'other-1', 'other-2'], intent: [], stable: true },
  ];
  const input = { rooms, halls, doors: [], cards: [card('answer')] };
  const first = attachChoices(input).cards[0].choices;
  const second = attachChoices(input).cards[0].choices;
  assert.deepEqual(first, second);
  assert.ok(first.some((choice) => choice.roomId === 'answer'));
  const distractors = first.filter((choice) => choice.roomId !== 'answer');
  assert.ok(distractors.some((choice) => choice.roomId === 'small'));
  assert.ok(distractors.some((choice) => choice.roomId === 'large'));
  assert.equal(distractors.length, 3);
  assert.ok(['large', 'other-1', 'other-2'].some((id) => !distractors.some((choice) => choice.roomId === id)),
    'the small-hall peer survives while one of three large-hall-only peers is excluded');
});

test('near-identical rooms are reported once and excluded from each other\'s choices', () => {
  const rooms = [
    room('a', 'Alpha', 'Alpha describes a concept with exactly these several shared defining words today.'),
    room('b', 'Beta', 'Beta describes a concept with exactly these several shared defining words today.'),
    room('c', 'Gamma', 'Gamma supplies a substantially different definition.'),
  ];
  const halls = [{ id: 'h', rooms: ['a', 'b', 'c'], intent: [], stable: true }];
  const result = attachChoices({ rooms, halls, doors: [], cards: [card('a'), card('b')] });
  assert.deepEqual(result.indistinct.map(({ rooms: pair, reason }) => ({ rooms: pair, reason })),
    [{ rooms: ['a', 'b'], reason: 'same-definition' }]);
  assert.ok(result.indistinct[0].similarity >= 0.8);
  assert.ok(!result.cards[0].choices?.some((choice) => choice.roomId === 'b'));
  assert.ok(!result.cards[1].choices?.some((choice) => choice.roomId === 'a'));
});

test('attachChoices stays bounded on 5,000 rooms', () => {
  const rooms = Array.from({ length: 5_000 }, (_, index) => room(`r-${index}`, `Term ${index}`, `Term ${index} is definition number ${index}.`));
  const cards = rooms.map((entry, index) => card(entry.id, index));
  const started = performance.now();
  const result = attachChoices({ rooms, halls: [], doors: [], cards });
  const elapsed = performance.now() - started;
  assert.equal(result.cards.length, 5_000);
  assert.ok(elapsed < 2_000, `attachChoices took ${elapsed.toFixed(1)}ms`);
});
