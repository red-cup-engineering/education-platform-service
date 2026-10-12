/**
 * Gate card generation. Vendored verbatim (logic unchanged, ported .mts -> .mjs) from
 * lantern-service's src/cards.mts, confirmed dialect-neutral by the seam digest: reads only
 * `title`/`aliases`/`description`/body-markdown shape, plus the room's own `frontmatter.teaches`
 * field for the lowest-priority padding rule (present on every dialect this package's adapters
 * ever populate; absent gracefully degrades to using the room's own title). Five rules in
 * priority order, all rule-based (no LLM generation): verbatim exercise extraction, dependency
 * cards from a door's own rationale text, definition cloze, reversed cloze, and a `teaches`
 * fallback used only to pad a room that produced fewer than two cards.
 */
import { asList } from '@red-cup-engineering/markdown-engineering-services-section/vault-dialect/frontmatter';

const NEW_CARD_STABILITY = 0; // seeded properly by srs review on the gate-pass; placeholder pre-first-review
const NEW_CARD_DIFFICULTY = 5; // neutral placeholder, overwritten on first review

function blankCard(roomId, kind, index, front, back) {
  return {
    id: `${roomId}#${kind}#${index}`,
    roomId,
    kind,
    front,
    back,
    stability: NEW_CARD_STABILITY,
    difficulty: NEW_CARD_DIFFICULTY,
  };
}

// ---- Rule 1: verbatim exercise extraction ------------------------------------------------

/** Find every `1. question text` immediately followed (allowing blank lines) by
 * `<details><summary>Answer</summary>...</details>`, and extract both verbatim.
 * @param {string} body */
export function extractExercises(body) {
  const lines = body.split('\n');
  const out = [];
  const questionRe = /^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const qm = questionRe.exec(line);
    if (!qm) continue;
    const question = (qm[1] ?? '').trim();
    if (question.length === 0) continue;

    let j = i + 1;
    while (j < lines.length && (lines[j] ?? '').trim() === '') j++;
    if (j >= lines.length || (lines[j] ?? '').trim() !== '<details>') continue;
    j++;
    while (j < lines.length && (lines[j] ?? '').trim() === '') j++;
    if (j >= lines.length || !/^<summary>\s*Answer\s*<\/summary>$/i.test((lines[j] ?? '').trim())) continue;
    j++;

    const answerLines = [];
    while (j < lines.length && (lines[j] ?? '').trim() !== '</details>') {
      answerLines.push(lines[j] ?? '');
      j++;
    }
    const answer = answerLines.join('\n').trim();
    if (answer.length === 0) continue;
    out.push({ question, answer });
  }
  return out;
}

// ---- Rule 3/4: definition cloze + reversed cloze -----------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Longest-match, case-insensitive, word-boundary search for any of `aliases` inside `text`.
 * @param {string} text @param {readonly string[]} aliases */
export function findAliasSpan(text, aliases) {
  const candidates = [...aliases].filter((a) => a.length > 0).sort((a, b) => b.length - a.length);
  for (const alias of candidates) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');
    const m = re.exec(text);
    if (m) return { start: m.index, end: m.index + m[0].length, matched: m[0] };
  }
  return null;
}

function firstParagraph(body) {
  const trimmed = body.trim();
  const idx = trimmed.indexOf('\n\n');
  return (idx === -1 ? trimmed : trimmed.slice(0, idx)).trim();
}

/** The verbatim prose a room uses as its definition for both cards and distractor selection.
 * @param {{description?: string, body: string}} room */
export function definitionSourceOf(room) {
  return room.description ?? firstParagraph(room.body);
}

function blankAliases(text, aliases) {
  let blanked = text;
  const longestFirst = [...new Set(aliases.filter((alias) => alias.length > 0))]
    .sort((left, right) => right.length - left.length);
  for (const alias of longestFirst) {
    blanked = blanked.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'gi'), '—');
  }
  return blanked;
}

// ---- Orchestration -------------------------------------------------------------------------

/** Generate every gate card for one room. `dependencyDoors` are the hard (incl. promoted-hard)
 * doors where `to === room.id`, in the order they should be presented.
 * @param {Room} room
 * @param {readonly Door[]} dependencyDoors
 * @param {(id: string) => string} roomTitleOf */
export function generateCardsForRoom(room, dependencyDoors, roomTitleOf) {
  const cards = [];
  let idx = 0;

  // Rule 1: exercises (highest priority, verbatim, zero synthesis).
  for (const ex of extractExercises(room.body)) {
    cards.push(blankCard(room.id, 'exercise', idx++, ex.question, ex.answer));
  }

  // Rule 2: dependency cards from each retained door rationale.
  for (const door of dependencyDoors) {
    const targetTitle = roomTitleOf(door.from);
    const front = `Why does ${room.title} depend on ${targetTitle}?`;
    cards.push(blankCard(room.id, 'dependency', idx++, front, door.reason));
  }

  // Rule 3/4: definition cloze + reversed cloze, from `description` or the body's first
  // paragraph, blanking the room's own longest alias/title match.
  const definitionSource = definitionSourceOf(room);
  const aliasCandidates = [room.title, ...room.aliases];
  const span = definitionSource.length > 0 ? findAliasSpan(definitionSource, aliasCandidates) : null;
  if (span) {
    const blanked = definitionSource.slice(0, span.start) + '___' + definitionSource.slice(span.end);
    cards.push(blankCard(room.id, 'cloze', idx++, blanked, room.title));
    const anonymousDefinition = blankAliases(definitionSource, aliasCandidates);
    cards.push(blankCard(room.id, 'term-from-def', idx++, `${anonymousDefinition} Which term is this?`, room.title));
  }

  // Rule 5: `teaches` recognition, lowest priority, only pads rooms under 2 cards. Degrades
  // gracefully when a dialect never populates `teaches` (only house's compiler does): falls
  // back to the room's own title, so every dialect still gets a floor of >=1 card per room.
  if (cards.length < 2) {
    const teaches = asList(room.frontmatter['teaches']);
    const taught = teaches[0] ?? room.title;
    cards.push(blankCard(room.id, 'teaches', idx++, `Name one thing taught by ${room.title}.`, taught));
  }

  return cards;
}
