import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileVault } from './compile.mjs';
import { parseRoom as parseHouseRoom } from '@red-cup-engineering/markdown-engineering-services-section/vault-dialect/adapters/house-md';
import { parseRoom as parseObsidianRoom } from '@red-cup-engineering/markdown-engineering-services-section/vault-dialect/adapters/obsidian-md';

function vault(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'vault-markdown-body-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

test('house graph uses parsed links, retaining bullet rationale and ignoring code examples', (t) => {
  const body = [
    'See [Target](target.md#section) first.',
    '- [Target](target.md#section) — the prerequisite explanation',
    '[](Second Brain.md)',
    '`[Inline example](inline.md)`',
    String.raw`\[Escaped example](escaped.md)`,
    '~~~~markdown', '[Fenced example](fenced.md)', '~~~~~',
    '```markdown', '[Open fence example](open.md)',
  ].join('\r\n');
  const root = vault(t, { 'source.md': body, 'target.md': '# Target', 'Second Brain.md': '# Other' });
  const parsed = parseHouseRoom(root, join(root, 'source.md'), 'test', {});
  assert.deepEqual(parsed.softCandidates, [
    { url: 'target.md#section', reason: 'the prerequisite explanation' },
    { url: 'Second Brain.md', reason: '[](Second Brain.md)' },
  ]);
  const { world } = compileVault(root, { id: 'test' }, { dialect: 'house' });
  assert.deepEqual(world.warnings, []);
  assert.deepEqual(world.doors.map((door) => [door.from, door.to]).sort(), [
    ['Second Brain.md', 'source.md'], ['target.md', 'source.md'],
  ]);
});

test('Obsidian graph keeps anchors, labels, embeds and tags while excluding code examples', (t) => {
  const body = [
    'See [[Target#Heading|Label]] and [[target#Other]] again. #topic',
    '![[Other]] (#nested/tag)',
    '`[[Inline]] #inline`',
    String.raw`\[[Escaped]]`,
    '~~~~markdown', '[[Fenced]] #fenced', '~~~~~',
    '```markdown', '[[Open]] #open',
  ].join('\r\n');
  const root = vault(t, { 'source.md': body, 'Target.md': '# Target', 'Other.md': '# Other' });
  const parsed = parseObsidianRoom(root, join(root, 'source.md'), 'test', {});
  assert.deepEqual(parsed.softCandidates, [
    { url: 'Target#Heading|Label', reason: 'See [[Target#Heading|Label]] and [[target#Other]] again. #topic' },
    { url: 'Other', reason: '![[Other]] (#nested/tag)' },
  ]);
  assert.deepEqual(parsed.room.frontmatter.tags, ['topic', 'nested/tag']);
  const { world } = compileVault(root, { id: 'test' }, { dialect: 'obsidian' });
  assert.deepEqual(world.warnings, []);
  assert.deepEqual(world.doors.map((door) => [door.from, door.to]).sort(), [
    ['Other.md', 'source.md'], ['Target.md', 'source.md'],
  ]);
});
