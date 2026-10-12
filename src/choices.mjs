/** Rule-based answer modes and concept-lattice distractors for generated review cards. */
import { definitionSourceOf } from './cards.mjs';
import { seededShuffle } from './session.mjs';

/** 32-bit FNV-1a over a JavaScript string's UTF-16 code units. */
export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizedName(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim().replace(/\s+/gu, ' ');
}

function wordSet(value) {
  return new Set(value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ').split(/\s+/u).filter((word) => word.length >= 3));
}

function jaccard(left, right) {
  // Two definitions with no words to compare are unknown, not identical.
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namePattern(room) {
  const names = [room.title, ...room.aliases].filter(Boolean).map(escapeRegExp);
  return names.length === 0 ? null : new RegExp(`\\b(?:${names.join('|')})\\b`, 'iu');
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Attach objective answer modes without mutating the generated cards.
 * Candidate discovery is bounded to small halls, direct doors, and a pre-indexed 50-room
 * same-kind sample; it never compares every room pair.
 * @param {{rooms: object[], halls: object[], doors: object[], cards: object[]}} worldParts
 */
export function attachChoices({ rooms, halls, doors, cards }) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const definitionById = new Map(rooms.map((room) => [room.id, definitionSourceOf(room)]));
  const wordsById = new Map(rooms.map((room) => [room.id, wordSet(definitionById.get(room.id))]));
  const normalizedTitleById = new Map(rooms.map((room) => [room.id, normalizedName(room.title)]));
  const namePatternById = new Map(rooms.map((room) => [room.id, namePattern(room)]));
  const hallsByRoom = new Map(rooms.map((room) => [room.id, []]));
  for (const hall of halls) {
    for (const roomId of hall.rooms) hallsByRoom.get(roomId)?.push(hall);
  }
  const doorNeighbors = new Map(rooms.map((room) => [room.id, new Set()]));
  for (const door of doors) {
    doorNeighbors.get(door.from)?.add(door.to);
    doorNeighbors.get(door.to)?.add(door.from);
  }
  const roomsByKind = new Map();
  for (const room of rooms) {
    const sameKind = roomsByKind.get(room.kind) ?? [];
    sameKind.push(room);
    roomsByKind.set(room.kind, sameKind);
  }
  for (const sameKind of roomsByKind.values()) {
    sameKind.sort((left, right) => fnv1a(left.id) - fnv1a(right.id) || left.id.localeCompare(right.id));
  }

  const indistinctByPair = new Map();
  const attached = cards.map((card) => {
    const answer = roomById.get(card.roomId);
    if (!answer) return card;
    if (card.kind === 'cloze') return { ...card, accepts: uniqueStrings([answer.title, ...answer.aliases]) };
    if (card.kind !== 'term-from-def') return card;

    const pool = new Set(doorNeighbors.get(answer.id));
    for (const hall of hallsByRoom.get(answer.id) ?? []) {
      if (hall.rooms.length <= 200) for (const roomId of hall.rooms) pool.add(roomId);
    }
    pool.delete(answer.id);

    const answerHalls = new Map((hallsByRoom.get(answer.id) ?? []).map((hall) => [hall.id, hall.rooms.length]));
    const answerNames = new Set([answer.title, ...answer.aliases].map(normalizedName).filter(Boolean));
    const answerDefinition = definitionById.get(answer.id);
    let validNearby = 0;
    for (const candidateId of pool) {
      const candidate = roomById.get(candidateId);
      if (!candidate || definitionById.get(candidateId).length === 0) continue;
      const sameTitle = normalizedTitleById.get(candidate.id) === normalizedTitleById.get(answer.id);
      const similarity = jaccard(wordsById.get(answer.id), wordsById.get(candidate.id));
      if (sameTitle || similarity >= 0.8) continue;
      if (answerNames.has(normalizedTitleById.get(candidate.id)) || namePatternById.get(candidate.id)?.test(answerDefinition)) continue;
      validNearby += 1;
    }
    if (validNearby < 3) {
      let sampled = 0;
      for (const room of roomsByKind.get(answer.kind) ?? []) {
        if (room.id === answer.id) continue;
        pool.add(room.id);
        sampled += 1;
        if (sampled === 50) break;
      }
    }
    const ranked = [];
    for (const candidateId of pool) {
      const candidate = roomById.get(candidateId);
      const candidateDefinition = definitionById.get(candidateId);
      if (!candidate || candidateDefinition.length === 0) continue;
      let score = doorNeighbors.get(answer.id)?.has(candidate.id) ? 0.5 : 0;
      if (candidate.kind === answer.kind) score += 0.1;
      for (const hall of hallsByRoom.get(candidate.id) ?? []) {
        const extent = answerHalls.get(hall.id);
        if (extent !== undefined && extent > 0) score += 1 / extent;
      }
      ranked.push({ candidate, score, tie: fnv1a(`${card.id}|${candidate.id}`) });
    }
    ranked.sort((left, right) => right.score - left.score || left.tie - right.tie);

    const distractors = [];
    for (const { candidate } of ranked) {
      const sameTitle = normalizedTitleById.get(candidate.id) === normalizedTitleById.get(answer.id);
      const similarity = jaccard(wordsById.get(answer.id), wordsById.get(candidate.id));
      if (sameTitle || similarity >= 0.8) {
        const pair = [answer.id, candidate.id].sort();
        const key = pair.join('\u0000');
        if (!indistinctByPair.has(key)) indistinctByPair.set(key, {
          rooms: pair,
          reason: sameTitle ? 'same-title' : 'same-definition',
          similarity,
        });
        continue;
      }
      if (answerNames.has(normalizedTitleById.get(candidate.id)) || namePatternById.get(candidate.id)?.test(answerDefinition)) continue;
      if (distractors.length < 3) distractors.push(candidate);
    }
    if (distractors.length === 0) return card;
    const choices = [{ label: answer.title, roomId: answer.id }, ...distractors.map((room) => ({ label: room.title, roomId: room.id }))];
    return { ...card, choices: seededShuffle(choices, fnv1a(card.id)) };
  });

  return { cards: attached, indistinct: [...indistinctByPair.values()] };
}
