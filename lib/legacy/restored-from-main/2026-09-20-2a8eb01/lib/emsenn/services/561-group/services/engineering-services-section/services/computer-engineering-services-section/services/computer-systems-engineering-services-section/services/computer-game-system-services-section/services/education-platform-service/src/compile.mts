/** Compile Markdown into an education world of rooms, prerequisite doors and halls.
 * Themes supply exercise extraction; the compiler preserves authored room content and
 * resolves observed Markdown links without treating fenced examples as prerequisites.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMarkdownFrontmatter } from '@red-cup-engineering/markdown-engineering-services-section/read-markdown-frontmatter';
import { readMarkdownSource } from '@red-cup-engineering/markdown-engineering-services-section/read-markdown-structure';
import { projectMarkdownFeatures } from '@red-cup-engineering/markdown-engineering-services-section/read-markdown-features';
import { asList } from './frontmatter-values.mts';
import { computeHalls, type FcaObject } from './fca.mts';
import { withStability } from './stability.mts';
import {
  DEFAULT_ATTRIBUTE_FIELDS,
  DEFAULT_EXCLUDE_FIELDS,
  type CompiledExercise,
  type Door,
  type FrontmatterData,
  type Hall,
  type Room,
  type RoomId,
  type WingConfig,
  type World,
} from './types.mts';

/** A theme's exercise-extraction rule: given a compiled room, produce zero or more compiled
 * exercises for it. Pure, synchronous, same discipline as a `Checker` (checker.mts). */
export type ExerciseExtractor = (room: Room) => CompiledExercise[];

// ---------------------------------------------------------------------------------------
// Directory walk
// ---------------------------------------------------------------------------------------

function walkMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
  }
  return out;
}

function toRoomId(root: string, absPath: string): RoomId {
  const rel = absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
  return rel.split(sep).filter((p) => p.length > 0).join('/');
}

function basenameOf(roomId: RoomId): string {
  const parts = roomId.split('/');
  return (parts[parts.length - 1] ?? roomId).toLowerCase();
}

// ---------------------------------------------------------------------------------------
// Room construction
// ---------------------------------------------------------------------------------------

function buildRoom(wingId: string, root: string, absPath: string): Room {
  const raw = readFileSync(absPath, 'utf8');
  const parsed = readMarkdownFrontmatter(raw, {
    frontmatterFormats: ['yaml'],
    absentFrontmatter: 'empty',
    yamlProjection: 'flat-string-lists',
  });
  const data = parsed.frontmatter as FrontmatterData;
  const body = parsed.body;

  const id = toRoomId(root, absPath);
  const titleRaw = data['title'];
  const title = typeof titleRaw === 'string' && titleRaw.length > 0 ? titleRaw : basenameOf(id).replace(/\.md$/i, '');
  const aliases = [...new Set([...asList(data['aliases']), ...asList(data['defines']), ...asList(data['teaches'])])];
  const kind = typeof data['type'] === 'string' && data['type'].length > 0 ? (data['type'] as string) : 'unknown';
  const description = typeof data['description'] === 'string' && data['description'].length > 0 ? (data['description'] as string) : undefined;
  const dateCreated = typeof data['date-created'] === 'string' ? (data['date-created'] as string) : undefined;

  return { id, wingId, title, aliases, kind, description, body, frontmatter: data, dateCreated };
}

// ---------------------------------------------------------------------------------------
// Link resolution
// ---------------------------------------------------------------------------------------

type ResolveResult =
  | { kind: 'resolved'; roomId: RoomId }
  | { kind: 'self' }
  | { kind: 'not-a-doc-link' }
  | { kind: 'external' }
  | { kind: 'unresolved'; raw: string }
  | { kind: 'ambiguous'; raw: string; candidates: RoomId[] };

function resolveLink(raw: string, sourceRoomId: RoomId, basenameIndex: Map<string, RoomId[]>): ResolveResult {
  const cleaned = raw.split('#')[0]?.split('?')[0]?.trim() ?? '';
  if (!/\.md$/i.test(cleaned)) return { kind: 'not-a-doc-link' };
  if (/^[a-z]+:\/\//i.test(cleaned)) return { kind: 'external' };
  const segments = cleaned.split('/').filter((s) => s.length > 0 && s !== '.' && s !== '..');
  const base = (segments[segments.length - 1] ?? cleaned).toLowerCase();
  const matches = basenameIndex.get(base) ?? [];
  if (matches.length === 0) return { kind: 'unresolved', raw: cleaned };
  if (matches.length > 1) return { kind: 'ambiguous', raw: cleaned, candidates: matches };
  const target = matches[0] as RoomId;
  if (target === sourceRoomId) return { kind: 'self' };
  return { kind: 'resolved', roomId: target };
}

// ---------------------------------------------------------------------------------------
// Hard doors (frontmatter path-fields)
// ---------------------------------------------------------------------------------------

function looksLikeMdPath(value: string): boolean {
  return /\.md(#.*)?$/i.test(value.trim());
}

function extractHardDoors(
  room: Room,
  basenameIndex: Map<string, RoomId[]>,
  excludeFields: readonly string[],
  warnings: string[],
): Door[] {
  const doors: Door[] = [];
  for (const [key, value] of Object.entries(room.frontmatter)) {
    if (excludeFields.includes(key)) continue;
    const values = asList(value);
    for (const v of values) {
      if (!looksLikeMdPath(v)) continue;
      const res = resolveLink(v, room.id, basenameIndex);
      if (res.kind === 'resolved') {
        doors.push({
          from: res.roomId,
          to: room.id,
          weight: 'hard',
          reason: `declared as a prerequisite of "${room.title}" via frontmatter field "${key}"`,
        });
      } else if (res.kind === 'unresolved') {
        warnings.push(`${room.id}: frontmatter field "${key}" links to "${v}" which does not resolve to any room in this wing`);
      } else if (res.kind === 'ambiguous') {
        warnings.push(`${room.id}: frontmatter field "${key}" link "${v}" matches multiple rooms by basename: ${res.candidates.join(', ')}`);
      }
      // 'self' and 'external' and 'not-a-doc-link' are silently not-doors.
    }
  }
  return doors;
}

// ---------------------------------------------------------------------------------------
// Soft doors (body links)
// ---------------------------------------------------------------------------------------

interface BodyLinkCandidate {
  url: string;
  reason: string;
}

/** One candidate per unique link target in the body, preferring a `## Related`-style bullet's
 * own rationale clause (if any) over a bare mention elsewhere in the prose. */
function extractBodyLinkCandidates(body: string): BodyLinkCandidate[] {
  const source = readMarkdownSource(body, { frontmatter: false });
  const seen = new Map<string, BodyLinkCandidate>();
  const candidates = projectMarkdownFeatures(source).filter((feature) => feature.type === 'markdown-link').map((link) => {
    const start = source.text.lastIndexOf('\n', link.span.start - 1) + 1;
    const next = source.text.indexOf('\n', link.span.end);
    const end = next < 0 ? source.text.length : next;
    const prefix = source.text.slice(start, link.span.start);
    const suffix = source.text.slice(link.span.end, end);
    const bullet = /^\s*[-*]\s+$/u.test(prefix) && /^\s*(?:[-–—]\s*.+)?$/u.test(suffix);
    const rationale = bullet ? suffix.replace(/^\s*[-–—]\s*/u, '').trim() : '';
    return { url: link.target, reason: rationale || source.text.slice(start, end).trim(), bullet };
  });
  for (const { url, reason } of [...candidates.filter((candidate) => candidate.bullet), ...candidates]) {
    const key = url.toLowerCase();
    if (!seen.has(key)) seen.set(key, { url, reason });
  }

  return [...seen.values()];
}

function extractSoftDoors(room: Room, basenameIndex: Map<string, RoomId[]>, warnings: string[]): Door[] {
  const doors: Door[] = [];
  for (const cand of extractBodyLinkCandidates(room.body)) {
    const res = resolveLink(cand.url, room.id, basenameIndex);
    if (res.kind === 'resolved') {
      doors.push({ from: res.roomId, to: room.id, weight: 'soft', reason: cand.reason });
    } else if (res.kind === 'unresolved') {
      warnings.push(`${room.id}: body link to "${cand.url}" does not resolve to any room in this wing`);
    } else if (res.kind === 'ambiguous') {
      warnings.push(`${room.id}: body link "${cand.url}" matches multiple rooms by basename: ${res.candidates.join(', ')}`);
    }
  }
  return doors;
}

// ---------------------------------------------------------------------------------------
// Promotion rule
// ---------------------------------------------------------------------------------------

/** If a room has zero hard doors (evaluated against the ORIGINAL hard-door set only, before any
 * promotion -- order-independent, per-room), every soft door targeting it is promoted to hard. */
function applyPromotion(hardDoors: Door[], softDoors: Door[]): Door[] {
  const hardInCount = new Map<RoomId, number>();
  for (const d of hardDoors) hardInCount.set(d.to, (hardInCount.get(d.to) ?? 0) + 1);

  const promotedSoft: Door[] = softDoors.map((d) =>
    (hardInCount.get(d.to) ?? 0) === 0 ? { ...d, weight: 'hard' as const } : d,
  );

  return [...hardDoors, ...promotedSoft];
}

// ---------------------------------------------------------------------------------------
// FCA halls
// ---------------------------------------------------------------------------------------

function roomAttributes(room: Room, attributeFields: readonly string[]): Set<string> {
  const attrs = new Set<string>();
  for (const field of attributeFields) {
    for (const v of asList(room.frontmatter[field])) attrs.add(`${field}:${v}`);
  }
  return attrs;
}

function buildHalls(rooms: Room[], config: WingConfig, doors: Door[]): Hall[] {
  const attributeFields = config.attributeFields ?? DEFAULT_ATTRIBUTE_FIELDS;
  const objects: FcaObject<RoomId>[] = rooms.map((r) => ({ id: r.id, attrs: roomAttributes(r, attributeFields) }));
  const { concepts } = computeHalls(objects, (id) => id);

  const derived: Omit<Hall, 'stable'>[] = concepts.map((c, i) => ({
    id: `hall:${i}`,
    intent: c.intent,
    rooms: c.extent,
  }));

  const curatorHalls: Omit<Hall, 'stable'>[] = (config.groups ?? []).map((g, i) => {
    const matchedRooms = objects.filter((o) => g.match(o.attrs)).map((o) => o.id);
    return { id: `curator:${i}:${g.name}`, intent: [`curator:${g.name}`], rooms: matchedRooms.sort() };
  });

  return withStability([...derived, ...curatorHalls], doors);
}

// ---------------------------------------------------------------------------------------
// Top-level compile
// ---------------------------------------------------------------------------------------

export function compileWing(root: string, config: WingConfig, extractExercises?: ExerciseExtractor): World {
  const normalizedRoot = root.endsWith(sep) ? root : root + sep;
  const files = walkMarkdownFiles(root);
  const warnings: string[] = [];

  const rooms: Room[] = files.map((f) => buildRoom(config.id, normalizedRoot, f));
  rooms.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const basenameIndex = new Map<string, RoomId[]>();
  for (const r of rooms) {
    const b = basenameOf(r.id);
    const list = basenameIndex.get(b) ?? [];
    list.push(r.id);
    basenameIndex.set(b, list);
  }

  const excludeFields = config.excludeFields ?? DEFAULT_EXCLUDE_FIELDS;
  const hardDoors: Door[] = [];
  const softDoors: Door[] = [];
  for (const room of rooms) {
    hardDoors.push(...extractHardDoors(room, basenameIndex, excludeFields, warnings));
    softDoors.push(...extractSoftDoors(room, basenameIndex, warnings));
  }
  const doors = applyPromotion(hardDoors, softDoors);

  const halls = buildHalls(rooms, config, doors);

  const exercises: CompiledExercise[] = extractExercises ? rooms.flatMap((room) => extractExercises(room)) : [];

  return { wingId: config.id, rooms, doors, halls, exercises, warnings };
}

// ---------------------------------------------------------------------------------------
// CLI entry point: node src/compile.mts <rootDir> <wingId> <outFile>  (no theme extractor --
// use a theme's own build script, e.g. themes/equivo/build-world.mts, for real exercise content)
// ---------------------------------------------------------------------------------------

function isMain(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return fileURLToPath(import.meta.url) === invoked || fileURLToPath(import.meta.url).endsWith(invoked);
  } catch {
    return false;
  }
}

if (isMain()) {
  const [root, wingId, outFile] = process.argv.slice(2);
  if (!root || !wingId || !outFile) {
    console.error('usage: node src/compile.mts <rootDir> <wingId> <outFile>');
    process.exit(1);
  }
  const world = compileWing(root, { id: wingId });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(world, null, 2) + '\n', 'utf8');
  console.log(
    `compiled wing "${wingId}": ${world.rooms.length} rooms, ${world.doors.length} doors ` +
      `(${world.doors.filter((d) => d.weight === 'hard').length} hard / ${world.doors.filter((d) => d.weight === 'soft').length} soft), ` +
      `${world.halls.length} halls (${world.halls.filter((h) => h.stable).length} stable), ${world.exercises.length} exercises, ` +
      `${world.warnings.length} warnings -> ${outFile}`,
  );
}
