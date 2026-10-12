import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractExercises, findAliasSpan, generateCardsForRoom } from './cards.mjs';

test('extractExercises finds a numbered question followed by a details/summary Answer block', () => {
  const body = `
## Exercises

1. Why is a connected group usually stronger than the same stones scattered apart?

<details>
<summary>Answer</summary>

Connected stones share liberties, defend each other, and can build eyes as one unit.
</details>

2. Second question here?

<details>
<summary>Answer</summary>

Second answer.
</details>
`;
  const exercises = extractExercises(body);
  assert.equal(exercises.length, 2);
  assert.equal(exercises[0].question, 'Why is a connected group usually stronger than the same stones scattered apart?');
  assert.match(exercises[0].answer, /^Connected stones share liberties/);
  assert.equal(exercises[1].answer, 'Second answer.');
});

test('extractExercises ignores a bare question with no answer block', () => {
  const body = '1. A question with no details block at all.\n\nSome unrelated text.';
  assert.deepEqual(extractExercises(body), []);
});

test('findAliasSpan prefers the longest matching alias, case-insensitive, word-boundary', () => {
  const text = 'Life and death is the core skill; life alone is not enough.';
  const span = findAliasSpan(text, ['life', 'life and death']);
  assert.ok(span);
  assert.equal(text.slice(span.start, span.end).toLowerCase(), 'life and death');
});

test('findAliasSpan respects word boundaries (no partial-word match)', () => {
  const text = 'Atarism is not a real word, but atari is.';
  const span = findAliasSpan(text, ['atari']);
  assert.ok(span);
  // Must match the standalone "atari" near the end, not the "atari" inside "Atarism".
  assert.equal(text.slice(span.start, span.end), 'atari');
  assert.equal(span.start, text.lastIndexOf('atari'), 'must match the standalone word, not the "atari" inside "Atarism"');
});

test('findAliasSpan returns null when nothing matches', () => {
  assert.equal(findAliasSpan('nothing relevant here', ['xyz']), null);
});

function room(overrides) {
  return {
    id: 'terms/atari.md',
    wingId: 'w',
    title: 'atari',
    aliases: ['atari'],
    kind: 'term',
    body: '',
    frontmatter: {},
    ...overrides,
  };
}

test('generateCardsForRoom: exercise rule wins highest priority and needs no other rules to satisfy the gate minimum', () => {
  const r = room({
    id: 'lessons/intro.md',
    title: 'Intro',
    body: '1. Why does X matter?\n\n<details>\n<summary>Answer</summary>\n\nBecause of Y.\n</details>\n',
  });
  const cards = generateCardsForRoom(r, [], () => '');
  const exerciseCards = cards.filter((c) => c.kind === 'exercise');
  assert.equal(exerciseCards.length, 1);
  assert.equal(exerciseCards[0].back, 'Because of Y.');
});

test('generateCardsForRoom: dependency cards use the door reason verbatim', () => {
  const r = room({ body: 'Atari is a fixture term.' });
  const doors = [{ from: 'terms/liberty.md', to: r.id, weight: 'hard', reason: 'Atari is defined by the reduction to a single remaining liberty.' }];
  const roomTitleOf = (id) => (id === 'terms/liberty.md' ? 'liberty' : id);
  const cards = generateCardsForRoom(r, doors, roomTitleOf);
  const dep = cards.find((c) => c.kind === 'dependency');
  assert.ok(dep);
  assert.equal(dep.front, 'Why does atari depend on liberty?');
  assert.equal(dep.back, 'Atari is defined by the reduction to a single remaining liberty.');
});

test('generateCardsForRoom: cloze + reversed cloze blank the room\'s own title/alias in its description', () => {
  const r = room({
    aliases: ['captured soon'],
    description: 'Atari, or captured soon: ATARI in weiqi is the state called captured soon.',
  });
  const cards = generateCardsForRoom(r, [], () => '');
  const cloze = cards.find((c) => c.kind === 'cloze');
  const reversed = cards.find((c) => c.kind === 'term-from-def');
  assert.ok(cloze);
  assert.ok(reversed);
  assert.equal(cloze.front, 'Atari, or ___: ATARI in weiqi is the state called captured soon.');
  assert.equal(cloze.back, 'atari');
  assert.equal(reversed.front, '—, or —: — in weiqi is the state called —. Which term is this?');
  assert.doesNotMatch(reversed.front, /atari|captured soon/iu);
  assert.equal(reversed.back, 'atari');
});

test('generateCardsForRoom: teaches fallback only pads rooms under 2 cards', () => {
  const padded = room({ description: undefined, body: '', frontmatter: { teaches: ['Fixture Fact'] } });
  const paddedCards = generateCardsForRoom(padded, [], () => '');
  assert.ok(paddedCards.some((c) => c.kind === 'teaches'));

  const rich = room({
    description: 'Atari in weiqi is the state of having one liberty.',
    frontmatter: { teaches: ['Should not appear'] },
  });
  const richDoors = [{ from: 'x', to: rich.id, weight: 'hard', reason: 'because reasons' }];
  const richCards = generateCardsForRoom(rich, richDoors, () => 'x');
  assert.ok(!richCards.some((c) => c.kind === 'teaches'), 'should not pad a room that already has >=2 cards');
});

test('every generated card has a unique id within a room', () => {
  const r = room({
    description: 'Atari in weiqi is the state of having one liberty.',
    body: '1. Q?\n\n<details>\n<summary>Answer</summary>\n\nA.\n</details>\n',
  });
  const doors = [{ from: 'x', to: r.id, weight: 'hard', reason: 'r' }];
  const cards = generateCardsForRoom(r, doors, () => 'x');
  const ids = cards.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});
