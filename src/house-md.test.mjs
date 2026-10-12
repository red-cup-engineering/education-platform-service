import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compileVault } from './compile.mjs';

const ROOT = fileURLToPath(new URL('./fixtures/vault-dialect/', import.meta.resolve('@red-cup-engineering/markdown-engineering-services-section/package.json'))) + 'house-corpus/';

function compileFixture() {
  return compileVault(ROOT, { id: 'house-fixture' }, { dialect: 'house' }).world;
}

test('walks the fixture corpus and produces one room per non-archival file', () => {
  const world = compileFixture();
  assert.deepEqual(
    world.rooms.map((r) => r.id).sort(),
    ['lessons/advanced.md', 'lessons/basics.md', 'terms/atari.md', 'terms/ko.md'],
  );
});

test('a file carrying a non-empty provenance field is skipped entirely, not compiled as a room', () => {
  const world = compileFixture();
  assert.ok(!world.rooms.some((r) => r.id === 'archive/old-basics.md'));
});

test('hard doors come from frontmatter path-fields regardless of field name', () => {
  const world = compileFixture();
  const requiresDoors = world.doors.filter((d) => d.weight === 'hard' && d.reason.includes('frontmatter field "requires"'));
  const pairs = requiresDoors.map((d) => `${d.from}->${d.to}`).sort();
  assert.deepEqual(pairs, ['lessons/basics.md->lessons/advanced.md', 'terms/atari.md->lessons/basics.md', 'terms/atari.md->terms/ko.md']);
});

test('a room with zero of its own hard doors gets its soft/body-link doors promoted to hard', () => {
  const world = compileFixture();
  // terms/atari.md has no `requires:` field of its own, so the soft door from terms/ko.md's
  // "## Related terms" link must be promoted to hard.
  const doorsIntoAtari = world.doors.filter((d) => d.to === 'terms/atari.md');
  assert.ok(doorsIntoAtari.length >= 1);
  for (const d of doorsIntoAtari) assert.equal(d.weight, 'hard');
});

test('a room with a hard door of its own is NOT promoted for its remaining soft doors', () => {
  const world = compileFixture();
  // terms/ko.md HAS a hard door (requires: terms/atari.md), so its soft door (from atari.md's
  // body link back) must stay soft.
  const softIntoKo = world.doors.filter((d) => d.to === 'terms/ko.md' && d.weight === 'soft');
  assert.equal(softIntoKo.length, 1);
});

test('halls group rooms by shared `type` attribute (FCA over house defaults)', () => {
  const world = compileFixture();
  const lessonHall = world.halls.find((h) => h.intent.includes('type:lesson'));
  const termHall = world.halls.find((h) => h.intent.includes('type:term'));
  assert.ok(lessonHall);
  assert.ok(termHall);
  assert.deepEqual(lessonHall.rooms.sort(), ['lessons/advanced.md', 'lessons/basics.md']);
  assert.deepEqual(termHall.rooms.sort(), ['terms/atari.md', 'terms/ko.md']);
});

test('every room produces at least one gate card', () => {
  const world = compileFixture();
  const byRoom = new Map();
  for (const c of world.cards) byRoom.set(c.roomId, (byRoom.get(c.roomId) ?? 0) + 1);
  for (const r of world.rooms) assert.ok((byRoom.get(r.id) ?? 0) >= 1, `${r.id} produced no cards`);
});

test('no warnings on a fully-resolving fixture corpus', () => {
  const world = compileFixture();
  assert.deepEqual(world.warnings, []);
});
