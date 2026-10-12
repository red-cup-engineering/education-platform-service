import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compileVault } from './compile.mjs';
import { detectDialect } from '@red-cup-engineering/markdown-engineering-services-section/vault-dialect/dialect';

const FIXTURE = fileURLToPath(new URL('./fixtures/vault-dialect/', import.meta.resolve('@red-cup-engineering/markdown-engineering-services-section/package.json'))) + 'malformed-frontmatter/';

test('a file whose frontmatter cannot be decoded is a warning against that file, never an abort of the vault', () => {
  const { world } = compileVault(FIXTURE, { id: 'malformed' }, { dialect: 'house' });
  assert.deepEqual(world.rooms.map((room) => room.id), ['good.md']);
  const skipped = world.warnings.filter((warning) => warning.startsWith('broken.md: skipped: '));
  assert.equal(skipped.length, 1, JSON.stringify(world.warnings));
  assert.match(skipped[0], /unique/u, 'the warning carries the decoder\'s reason');
});

test('dialect detection is not derailed by an undecodable sample file', () => {
  const detection = detectDialect(FIXTURE);
  assert.equal(detection.dialect, 'house');
});
