import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileWing } from './compile.mts';

function writeCorpus(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'compile-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

test('compiles rooms, sorted by id, with frontmatter title/description', () => {
  const root = writeCorpus({
    'b.md': '---\ntitle: B Room\n---\nbody b\n',
    'a.md': '---\ntitle: A Room\ndescription: "desc a"\n---\nbody a\n',
  });
  try {
    const world = compileWing(root, { id: 'test-wing' });
    assert.equal(world.rooms.length, 2);
    assert.equal(world.rooms[0]?.id, 'a.md');
    assert.equal(world.rooms[0]?.title, 'A Room');
    assert.equal(world.rooms[0]?.description, 'desc a');
    assert.equal(world.rooms[1]?.id, 'b.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hard doors: a frontmatter field shaped like a .md path becomes a prerequisite edge', () => {
  const root = writeCorpus({
    'basics.md': '---\ntitle: Basics\n---\nintro\n',
    'advanced.md': '---\ntitle: Advanced\nrequires:\n  - basics.md\n---\nadvanced content\n',
  });
  try {
    const world = compileWing(root, { id: 'w' });
    const doors = world.doors.filter((d) => d.weight === 'hard');
    assert.equal(doors.length, 1);
    assert.equal(doors[0]?.from, 'basics.md');
    assert.equal(doors[0]?.to, 'advanced.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('soft doors promote to hard when the target room has zero hard doors', () => {
  // A body link in room X pointing at room Y is read as "Y is prerequisite background for X" --
  // door {from: Y, to: X}. So the link belongs in advanced.md (pointing at basics.md) to make
  // basics.md a soft (then promoted) prerequisite OF advanced.md, per the compiler's own rule.
  const root = writeCorpus({
    'basics.md': '---\ntitle: Basics\n---\nintro, no links\n',
    'advanced.md': '---\ntitle: Advanced\n---\nSee also [basics](basics.md), no requires field.\n',
  });
  try {
    const world = compileWing(root, { id: 'w' });
    const doors = world.doors.filter((d) => d.to === 'advanced.md');
    assert.equal(doors.length, 1);
    assert.equal(doors[0]?.weight, 'hard'); // promoted: advanced.md had zero hard doors
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unresolved link is warned, never crashes the compile', () => {
  const root = writeCorpus({
    'a.md': '---\ntitle: A\n---\nSee [ghost](does-not-exist.md).\n',
  });
  try {
    const world = compileWing(root, { id: 'w' });
    assert.ok(world.warnings.some((w) => w.includes('does-not-exist.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('halls: rooms sharing a tag attribute form a real FCA concept', () => {
  const root = writeCorpus({
    'a.md': '---\ntitle: A\ntags: [foo]\n---\na\n',
    'b.md': '---\ntitle: B\ntags: [foo]\n---\nb\n',
    'c.md': '---\ntitle: C\ntags: [bar]\n---\nc\n',
  });
  try {
    const world = compileWing(root, { id: 'w' });
    const matching = world.halls.filter((h) => h.intent.includes('tags:foo'));
    assert.equal(matching.length, 1);
    assert.deepEqual(matching[0]?.rooms.sort(), ['a.md', 'b.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an extractExercises callback populates world.exercises; without one, exercises is empty', () => {
  const root = writeCorpus({ 'a.md': '---\ntitle: A\n---\nbody\n' });
  try {
    const withoutExtractor = compileWing(root, { id: 'w' });
    assert.deepEqual(withoutExtractor.exercises, []);

    const withExtractor = compileWing(root, { id: 'w' }, (room) => [
      { id: `${room.id}#probe#0`, roomId: room.id, kind: 'probe', spec: {}, prompt: 'p' },
    ]);
    assert.equal(withExtractor.exercises.length, 1);
    assert.equal(withExtractor.exercises[0]?.kind, 'probe');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compileWing is a pure function of directory contents: same corpus, same result twice', () => {
  const root = writeCorpus({
    'a.md': '---\ntitle: A\ntags: [x]\n---\na body\n',
    'b.md': '---\ntitle: B\ntags: [x]\nrequires:\n  - a.md\n---\nb body\n',
  });
  try {
    const w1 = compileWing(root, { id: 'w' });
    const w2 = compileWing(root, { id: 'w' });
    assert.deepEqual(w1, w2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('soft doors use prose links and prefer a related bullet rationale over prose', () => {
  const root = writeCorpus({
    'basics.md': '# Basics\n',
    'advanced.md': ['# Advanced', 'See [basics](basics.md).', '', '~~~md', '[fake](missing.md)', '~~~', 'Inline `[example](missing-too.md)`.', '', '- [Basics](basics.md "title") — background reason'].join('\n'),
  });
  try {
    const world = compileWing(root, { id: 'observed-links' });
    assert.deepEqual(world.doors.map(({ from, to, reason }) => ({ from, to, reason })), [{ from: 'basics.md', to: 'advanced.md', reason: 'background reason' }]);
    assert.deepEqual(world.warnings, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
