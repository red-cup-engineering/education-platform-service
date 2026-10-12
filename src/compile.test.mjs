import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compileVault, roomTitleLookup, worldFromRooms } from './compile.mjs';
import { canonicalJson } from '@red-cup-engineering/json-services-section/canonical-json';

const FIXTURES = fileURLToPath(new URL('./fixtures/vault-dialect/', import.meta.resolve('@red-cup-engineering/markdown-engineering-services-section/package.json')));

test('card title lookup preserves first duplicate IDs and replaces repeated scans with one index pass', () => {
  const rooms = Array.from({ length: 1_000 }, (_, index) => ({ id: `room-${index}`, title: `Title ${index}` }));
  rooms.splice(501, 0, { id: 'duplicate-room', title: 'First duplicate title' });
  rooms.splice(502, 0, { id: 'duplicate-room', title: 'Later duplicate title' });
  let legacyComparisons = 0;
  const legacyTitleOf = (id) => rooms.find((room) => { legacyComparisons += 1; return room.id === id; })?.title ?? id;
  const lookup = roomTitleLookup(rooms);
  for (const room of rooms) assert.equal(lookup(room.id), legacyTitleOf(room.id));
  assert.equal(lookup('duplicate-room'), 'First duplicate title');
  assert.equal(lookup('unknown-room'), 'unknown-room');
  assert.ok(legacyComparisons > rooms.length * 400, `legacy comparisons: ${legacyComparisons}`);
});

// --- determinism --------------------------------------------------------------------------

test('determinism: two independent compiles of the same fixture are byte-identical', () => {
  for (const [dir, id] of [
    ['house-corpus', 'house-fixture'],
    ['obsidian-vault', 'obsidian-fixture'],
    ['org-roam', 'org-fixture'],
  ]) {
    const first = compileVault(`${FIXTURES}${dir}`, { id }).world;
    const second = compileVault(`${FIXTURES}${dir}`, { id }).world;
    assert.equal(canonicalJson(first), canonicalJson(second), dir);
  }
});

// --- exclusion -----------------------------------------------------------------------------

test('exclusion: excludeGlobs additionally excludes matching path segments', () => {
  const withoutGlob = compileVault(`${FIXTURES}house-corpus`, { id: 'house-fixture' }).world;
  const withGlob = compileVault(`${FIXTURES}house-corpus`, { id: 'house-fixture' }, { excludeGlobs: ['terms'] }).world;
  assert.ok(withoutGlob.rooms.some((r) => r.id.startsWith('terms/')));
  assert.ok(!withGlob.rooms.some((r) => r.id.startsWith('terms/')));
});

// --- read-only -------------------------------------------------------------------------------

function snapshotTree(root) {
  const out = new Map();
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else {
        out.set(full, `${st.size}:${st.mtimeMs}`);
      }
    }
  }
  return out;
}

test('read-only: compiling a vault never modifies any file under its root (size/mtime snapshot)', () => {
  const root = `${FIXTURES}obsidian-vault`;
  const before = snapshotTree(root);
  compileVault(root, { id: 'obsidian-fixture' });
  const after = snapshotTree(root);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'no file was added or removed');
  for (const [file, sig] of before) {
    assert.equal(after.get(file), sig, `${file} was modified by compiling`);
  }
});

// --- house fixture contract ------------------------------------------------------------------

test('house fixture has the fixed expected room, prerequisite, and hall graph', () => {
  const { world } = compileVault(`${FIXTURES}house-corpus`, { id: 'house-fixture' }, { dialect: 'house' });
  assert.deepEqual(world.rooms.map(({ id }) => id), ['lessons/advanced.md', 'lessons/basics.md', 'terms/atari.md', 'terms/ko.md']);
  assert.deepEqual(
    world.doors.filter(({ weight }) => weight === 'hard').map(({ from, to }) => `${from}->${to}`).sort(),
    ['lessons/basics.md->lessons/advanced.md', 'terms/atari.md->lessons/basics.md', 'terms/atari.md->terms/ko.md', 'terms/ko.md->terms/atari.md'],
  );
  assert.ok(world.halls.some(({ intent, rooms }) => intent.includes('type:term') && rooms.length === 2));
});

test('worldFromRooms warns about indistinct definitions and keeps them out of each other\'s choices', () => {
  const makeRoom = (id, title) => ({
    id, wingId: 'w', title, aliases: [], kind: 'term',
    description: `${title} describes a concept with exactly these several shared defining words today.`,
    body: '', frontmatter: { tags: ['shared'] },
  });
  const world = worldFromRooms({
    rooms: [makeRoom('a', 'Alpha'), makeRoom('b', 'Beta'), makeRoom('c', 'Gamma contrast')],
    doors: [], warnings: [], dialect: 'house',
  }, { id: 'w' });
  assert.ok(world.warnings.includes('indistinct rooms: a ~ b (same-definition)'));
  const alpha = world.cards.find((entry) => entry.roomId === 'a' && entry.kind === 'term-from-def');
  const beta = world.cards.find((entry) => entry.roomId === 'b' && entry.kind === 'term-from-def');
  assert.ok(!alpha.choices?.some((choice) => choice.roomId === 'b'));
  assert.ok(!beta.choices?.some((choice) => choice.roomId === 'a'));
});
