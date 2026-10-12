import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compileVault } from './compile.mjs';
import { validateWorld, assembleWorld } from './canonical.mjs';
import { canonicalJson } from '@red-cup-engineering/json-services-section/canonical-json';

const FIXTURES = fileURLToPath(new URL('./fixtures/vault-dialect/', import.meta.resolve('@red-cup-engineering/markdown-engineering-services-section/package.json')));

test('a real compiled World conforms to the platform World JSON schema', () => {
  const { world } = compileVault(`${FIXTURES}obsidian-vault`, { id: 'obsidian-fixture' });
  const { valid, errors } = validateWorld(world);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});

test('every dialect (house, obsidian, org) produces a schema-conformant World', () => {
  for (const [dir, id] of [
    ['house-corpus', 'house-fixture'],
    ['obsidian-vault', 'obsidian-fixture'],
    ['org-roam', 'org-fixture'],
  ]) {
    const { world } = compileVault(`${FIXTURES}${dir}`, { id });
    const { valid, errors } = validateWorld(world);
    assert.deepEqual(errors, [], `${dir}: ${errors.join('; ')}`);
    assert.equal(valid, true, dir);
  }
});

test('validateWorld rejects a value missing a required field, with a useful path in the error', () => {
  const { valid, errors } = validateWorld({ wingId: 'x', rooms: [], doors: [], halls: [], cards: [] });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('world.warnings')), errors.join('; '));
});

test('validateWorld rejects a Room with a wrong-typed field, collecting every error, not just the first', () => {
  const badWorld = {
    wingId: 'x',
    rooms: [{ id: 1, wingId: 'x', title: 'T', aliases: 'not-an-array', kind: 'k', body: 'b', frontmatter: {} }],
    doors: [],
    halls: [],
    cards: [],
    warnings: [],
  };
  const { valid, errors } = validateWorld(badWorld);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('rooms[0].id')), errors.join('; '));
  assert.ok(errors.some((e) => e.includes('rooms[0].aliases')), errors.join('; '));
});

test('validateWorld rejects a Door with an invalid weight enum value', () => {
  const badWorld = {
    wingId: 'x',
    rooms: [],
    doors: [{ from: 'a', to: 'b', weight: 'medium', reason: 'r' }],
    halls: [],
    cards: [],
    warnings: [],
  };
  const { valid, errors } = validateWorld(badWorld);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('doors[0].weight')), errors.join('; '));
});

test('assembleWorld throws (rather than silently returning) on a non-conformant candidate', () => {
  assert.throws(() => assembleWorld({ wingId: 'x' }), /does not conform/);
});

test('assembleWorld returns a conforming world unchanged, as plain JSON', () => {
  const { world } = compileVault(`${FIXTURES}house-corpus`, { id: 'house-fixture' });
  const assembled = assembleWorld(world);
  assert.deepEqual(assembled, world);
  assert.equal(canonicalJson(assembled), canonicalJson(JSON.parse(JSON.stringify(world))));
  assert.ok(assembled.rooms.every((room) => Object.values(room).every((value) => value !== undefined)));
});

test('canonicalJson is insensitive to object key insertion order', () => {
  const a = { z: 1, a: { y: 2, x: 3 } };
  const b = { a: { x: 3, y: 2 }, z: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
});
