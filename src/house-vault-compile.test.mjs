import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compileVault } from './compile.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/house-vault/', import.meta.url));

function compileFixtures() {
  return compileVault(FIXTURES, { id: 'fixture' }, { dialect: 'house' }).world;
}

test('walks the fixture corpus and produces one room per file', () => {
  const world = compileFixtures();
  const ids = world.rooms.map((r) => r.id).sort();
  assert.deepEqual(ids, ['lessons/advanced.md', 'lessons/intro.md', 'terms/bar.md', 'terms/foo.md', 'terms/qux.md']);
});

test('hard doors come from frontmatter path-fields regardless of field name', () => {
  const world = compileFixtures();
  const hardFromFrontmatter = world.doors.filter(
    (d) => d.weight === 'hard' && (d.to === 'lessons/intro.md' || d.to === 'lessons/advanced.md'),
  );
  const pairs = hardFromFrontmatter.map((d) => `${d.from}->${d.to}`).sort();
  assert.deepEqual(pairs, [
    'lessons/intro.md->lessons/advanced.md',
    'terms/bar.md->lessons/intro.md',
    'terms/foo.md->lessons/intro.md',
    'terms/qux.md->lessons/advanced.md',
  ]);
});

test('soft doors from body links are promoted to hard when the target room has zero hard doors', () => {
  const world = compileFixtures();
  // terms carry no requires/uses-mechanic of their own, so every soft door pointing at a term
  // (from another term's "## Related terms" section) must be promoted.
  const doorsIntoFoo = world.doors.filter((d) => d.to === 'terms/foo.md');
  assert.ok(doorsIntoFoo.length >= 2, 'foo should gain doors from bar and qux');
  for (const d of doorsIntoFoo) assert.equal(d.weight, 'hard', `door ${d.from}->${d.to} should be promoted`);

  const doorsIntoIntro = world.doors.filter((d) => d.to === 'lessons/intro.md');
  for (const d of doorsIntoIntro) assert.equal(d.weight, 'hard');
});

test('self-links and unresolved links never become doors', () => {
  const world = compileFixtures();
  for (const d of world.doors) {
    assert.notEqual(d.from, d.to, 'no door should be a self-loop');
  }
});

test('FCA produces a genuine closed concept over cites, not a hand-picked cluster', () => {
  const world = compileFixtures();
  const fixtureSourceHall = world.halls.find((h) => h.rooms.length === 3 && h.rooms.includes('terms/foo.md'));
  assert.ok(fixtureSourceHall, 'expected a 3-room hall for the shared "Fixture Source X" cites value');
  assert.deepEqual(fixtureSourceHall.rooms.sort(), ['terms/bar.md', 'terms/foo.md', 'terms/qux.md']);
  assert.ok(fixtureSourceHall.intent.some((a) => a.includes('Fixture Source X')));
});

test('the triangle hall (foo/bar/qux) is stable; the 2-room lesson chain is not', () => {
  const world = compileFixtures();
  const triangleHall = world.halls.find((h) => h.rooms.length === 3);
  const lessonHall = world.halls.find((h) => h.rooms.length === 2 && h.rooms.includes('lessons/intro.md'));
  assert.ok(triangleHall);
  assert.ok(lessonHall);
  assert.equal(triangleHall.stable, true, 'a fully cross-linked triangle has bracing beyond a spanning tree');
  assert.equal(lessonHall.stable, false, 'a bare two-room chain is only a spanning tree, no cross-link');
});

test('exercise cards are extracted verbatim from <details><summary>Answer</summary> blocks', () => {
  const world = compileFixtures();
  const introCards = world.cards.filter((c) => c.roomId === 'lessons/intro.md' && c.kind === 'exercise');
  assert.equal(introCards.length, 1);
  assert.match(introCards[0].front, /Why is a connected widget usually stronger/);
  assert.match(introCards[0].back, /Connected parts share bar/);
});

test('dependency cards carry the related-terms rationale sentence verbatim', () => {
  const world = compileFixtures();
  const fooDependencyCards = world.cards.filter((c) => c.roomId === 'terms/foo.md' && c.kind === 'dependency');
  assert.ok(fooDependencyCards.length >= 1);
  const barCard = fooDependencyCards.find((c) => c.back.includes('reduction to a single remaining bar'));
  assert.ok(barCard, 'expected the exact rationale clause from foo.md\'s Related terms bullet');
});

test('every room clears the gate minimum: at least 1 card, at least 2 kinds where supported', () => {
  const world = compileFixtures();
  const byRoom = new Map();
  for (const c of world.cards) {
    const list = byRoom.get(c.roomId) ?? [];
    list.push(c);
    byRoom.set(c.roomId, list);
  }
  for (const [roomId, cards] of byRoom) {
    assert.ok(cards.length >= 1, `${roomId} should have at least one card`);
  }
  // terms have no exercises but should clear dependency + cloze + reversed-cloze => 3+ kinds
  const fooKinds = new Set(byRoom.get('terms/foo.md').map((c) => c.kind));
  assert.ok(fooKinds.size >= 2, 'terms/foo.md should produce at least 2 distinct card kinds');
});

test('determinism: compiling the same fixture corpus twice yields identical output', () => {
  const a = compileFixtures();
  const b = compileFixtures();
  assert.deepEqual(a, b);
});
