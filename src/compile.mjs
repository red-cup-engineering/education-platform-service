/**
 * `compile` — a vault made a world. CAIRN reads the vault's rooms and doors through the adapter
 * for its dialect (`readVaultRooms`); this module makes the world of them: FCA halls, hall
 * stability, and cards, assembled as one canonical World. Reading only; nothing is written.
 */
import { ADAPTERS, readVaultRooms } from '@red-cup-engineering/markdown-engineering-services-section/vault-dialect/vault-rooms';
import { enumerateFormalConcepts } from '@red-cup-engineering/metrologic/closure/formal-concepts';
import { withStability } from './stability.mjs';
import { generateCardsForRoom } from './cards.mjs';
import { asList } from '@red-cup-engineering/markdown-engineering-services-section/vault-dialect/frontmatter';
import { assembleWorld } from './canonical.mjs';
import { attachChoices } from './choices.mjs';

export { ADAPTERS };

/** House's own defaults, unchanged — a house wing compiled through this package with no
 * `attributeFields` override draws from exactly these three fields, same as before. */
export const DEFAULT_ATTRIBUTE_FIELDS = ['cites', 'type', 'tags'];

/** Per-dialect attribute-field defaults, used only when `WingConfig.attributeFields` is not
 * given. House keeps its original three-field default; Obsidian and org draw from what those
 * dialects actually populate (`tags`, plus `type` when an Obsidian note happens to set one) —
 * an honest default, not a house field name applied where it would silently match nothing. */
const DEFAULT_ATTRIBUTE_FIELDS_BY_DIALECT = {
  house: DEFAULT_ATTRIBUTE_FIELDS,
  obsidian: ['tags', 'type'],
  org: ['tags'],
};

function roomAttributes(room, attributeFields) {
  const attrs = new Set();
  for (const field of attributeFields) {
    for (const v of asList(room.frontmatter[field])) attrs.add(`${field}:${v}`);
  }
  return attrs;
}

function buildHalls(rooms, config, doors, attributeFields) {
  const objects = rooms.map((r) => ({ id: r.id, attrs: roomAttributes(r, attributeFields) }));
  const result = enumerateFormalConcepts(objects, (id) => id);
  const { concepts } = result;

  const derived = concepts.map((c, i) => ({ id: `hall:${i}`, intent: c.intent, rooms: c.extent }));

  const curatorHalls = (config.groups ?? []).map((g, i) => {
    const matchedRooms = objects.filter((o) => g.match(o.attrs)).map((o) => o.id);
    return { id: `curator:${i}:${g.name}`, intent: [`curator:${g.name}`], rooms: matchedRooms.sort() };
  });

  return { halls: withStability([...derived, ...curatorHalls], doors), fallbackReason: result.fallbackReason };
}

/**
 * Indexes the sorted room sequence once for card dependency labels. Keep the
 * first title for a duplicate ID, exactly as the former `find` lookup did.
 * @param {{id: string, title: string}[]} rooms
 * @returns {(id: string) => string}
 */
export function roomTitleLookup(rooms) {
  const titles = new Map();
  for (const room of rooms) if (!titles.has(room.id)) titles.set(room.id, room.title);
  return (id) => titles.get(id) ?? id;
}

/**
 * @param {string} root
 * @param {WingConfig} wingConfig
 * @param {CompileOptions} [options]
 * @returns {{ world: World, dialect: DialectId, dialectReason: string }}
 */
/**
 * The world a vault's rooms make: FCA halls over the rooms' attribute fields (and curator
 * groups), each hall's stability, a card set per room from its prerequisite doors, assembled and
 * validated as one canonical World.
 * @param {{wingId: string, rooms: object[], doors: object[], warnings: string[], dialect?: string}} read what readVaultRooms read
 * @param {object} wingConfig
 */
export function worldFromRooms({ rooms, doors, warnings: readWarnings = [], dialect }, wingConfig) {
  const config = wingConfig;
  const warnings = [...readWarnings];
  const attributeFields = config.attributeFields ?? DEFAULT_ATTRIBUTE_FIELDS_BY_DIALECT[dialect] ?? DEFAULT_ATTRIBUTE_FIELDS;
  const hallProjection = buildHalls(rooms, config, doors, attributeFields);
  const halls = hallProjection.halls;
  if (hallProjection.fallbackReason !== null) warnings.push(`FCA halls use deterministic greedy fallback (${hallProjection.fallbackReason}); exact concept closure exceeded its bounded computation limit`);

  const roomTitleOf = roomTitleLookup(rooms);
  const hardDoorsTo = new Map();
  for (const door of doors) if (door.weight === 'hard') hardDoorsTo.set(door.to, [...(hardDoorsTo.get(door.to) ?? []), door]);
  const generatedCards = [];
  for (const room of rooms) generatedCards.push(...generateCardsForRoom(room, hardDoorsTo.get(room.id) ?? [], roomTitleOf));
  const { cards, indistinct } = attachChoices({ rooms, halls, doors, cards: generatedCards });
  for (const pair of indistinct) warnings.push(`indistinct rooms: ${pair.rooms[0]} ~ ${pair.rooms[1]} (${pair.reason})`);
  return assembleWorld({ wingId: config.id, rooms, doors, halls, cards, warnings });
}

/** Read a vault (CAIRN) and make its world. */
export function compileVault(root, wingConfig, options = {}) {
  const read = readVaultRooms(root, wingConfig, options);
  return { world: worldFromRooms(read, wingConfig), dialect: read.dialect, dialectReason: read.dialectReason };
}
