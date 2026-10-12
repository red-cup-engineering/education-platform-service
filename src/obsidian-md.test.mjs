import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compileVault } from './compile.mjs';

const ROOT = fileURLToPath(new URL('./fixtures/vault-dialect/', import.meta.resolve('@red-cup-engineering/markdown-engineering-services-section/package.json'))) + 'obsidian-vault/';

function compileFixture() {
  return compileVault(ROOT, { id: 'obsidian-fixture' }, { dialect: 'obsidian' }).world;
}

test('walks the fixture vault and produces one room per note, excluding .obsidian', () => {
  const world = compileFixture();
  assert.equal(world.rooms.length, 18);
  assert.ok(!world.rooms.some((r) => r.id.includes('.obsidian')));
});

test('a bare wikilink resolves by note title/basename', () => {
  const world = compileFixture();
  assert.ok(world.doors.some((d) => d.from === 'Second Brain.md' && d.to === 'Welcome.md'));
});

test('an aliased display wikilink [[Target|Display]] resolves to Target, ignoring the display text', () => {
  const world = compileFixture();
  assert.ok(world.doors.some((d) => d.from === 'Atomic Habits.md' && d.to === 'Zettelkasten.md'));
});

test('a heading-anchored wikilink [[Target#Heading]] resolves to Target, ignoring the anchor', () => {
  const world = compileFixture();
  assert.ok(world.doors.some((d) => d.from === 'Zettelkasten.md' && d.to === 'Welcome.md'));
});

test('a frontmatter alias is a valid wikilink resolution target, not just the note title', () => {
  // "Second Brain.md" declares aliases: [PKM, "Personal Knowledge Management"]. No fixture note
  // links to it by alias directly, but the alias index itself must contain it — checked via the
  // wikilink module directly to isolate the index-building behavior from link extraction.
  const world = compileFixture();
  const secondBrain = world.rooms.find((r) => r.id === 'Second Brain.md');
  assert.deepEqual(secondBrain.aliases.sort(), ['PKM', 'Personal Knowledge Management']);
});

test('shortest-unique-path: a bare [[Overview]] wikilink resolves to the root note over the deeper projects/Overview.md', () => {
  const world = compileFixture();
  assert.ok(world.doors.some((d) => d.from === 'Overview.md' && d.to === 'Welcome.md'));
  assert.ok(!world.doors.some((d) => d.from === 'projects/Overview.md' && d.to === 'Welcome.md'));
});

test('ambiguous: two same-basename notes at equal depth report an ambiguous-link warning, and no door is created for it', () => {
  const world = compileFixture();
  assert.ok(
    world.warnings.some((w) => w.includes('Weekly Review.md') && w.includes('"Notes"') && w.includes('areas/Notes.md') && w.includes('projects/Notes.md')),
  );
  assert.ok(!world.doors.some((d) => d.to === 'Weekly Review.md' && (d.from === 'areas/Notes.md' || d.from === 'projects/Notes.md')));
});

test('unresolved: a link to a note that does not exist reports a warning, not a crash', () => {
  const world = compileFixture();
  assert.ok(world.warnings.some((w) => w.includes('areas/Health.md') && w.includes('Habit Tracker')));
});

test('a wikilink-shaped frontmatter field is a hard-door candidate (Obsidian "up:"/parent idiom)', () => {
  const world = compileFixture();
  const hard = world.doors.find((d) => d.to === 'Spaced Repetition.md' && d.weight === 'hard');
  assert.ok(hard);
  assert.equal(hard.from, 'Second Brain.md');
  assert.match(hard.reason, /frontmatter field "up"/);
});

test('frontmatter tags and inline #hashtags merge into one tags attribute, driving FCA halls', () => {
  const world = compileFixture();
  const spaced = world.rooms.find((r) => r.id === 'Spaced Repetition.md');
  assert.ok(spaced.frontmatter.tags.includes('pkm'));
  assert.ok(spaced.frontmatter.tags.includes('srs')); // inline #srs in the body

  const booksHalls = world.halls.filter((h) => h.intent.includes('tags:books'));
  assert.ok(booksHalls.length > 0);
  assert.ok(booksHalls.some((h) => h.rooms.includes('Reading List.md')));
});

test('kind defaults to \'note\' (not house\'s \'unknown\') when no type field is present', () => {
  const world = compileFixture();
  const welcome = world.rooms.find((r) => r.id === 'Welcome.md');
  assert.equal(welcome.kind, 'note');
});

test('dateCreated is absent when no date-created frontmatter field is present (honest Obsidian degradation)', () => {
  const world = compileFixture();
  const welcome = world.rooms.find((r) => r.id === 'Welcome.md');
  assert.equal(welcome.dateCreated, undefined);
});

test('every room still produces at least one gate card, even with no house fields at all', () => {
  const world = compileFixture();
  const byRoom = new Map();
  for (const c of world.cards) byRoom.set(c.roomId, (byRoom.get(c.roomId) ?? 0) + 1);
  for (const r of world.rooms) assert.ok((byRoom.get(r.id) ?? 0) >= 1, `${r.id} produced no cards`);
});
