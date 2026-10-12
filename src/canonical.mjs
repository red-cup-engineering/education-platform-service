/**
 * `canonical` — the platform World JSON contract, made checkable rather than just documented.
 * `WORLD_JSON_SCHEMA` is a hand-derived structural description of lantern-service's `src/types.mts`
 * (`Room`/`Door`/`Hall`/`ReviewCard`/`World`), `validateWorld` checks a value against it (zero
 * dependencies — no ajv, per house constraints), `assembleWorld` is the one place every adapter's
 * output is required to pass through before becoming a returned `World`, and `canonicalStringify`
 * produces a stable-key-order JSON string so two compiles of the same input are byte-identical
 * (the determinism test's own tool, not just documentation of the property).
 */

export const WORLD_JSON_SCHEMA = Object.freeze({
  type: 'World',
  fields: {
    wingId: 'string',
    rooms: { array: 'Room' },
    doors: { array: 'Door' },
    halls: { array: 'Hall' },
    cards: { array: 'ReviewCard' },
    warnings: { array: 'string' },
  },
  shapes: {
    Room: {
      id: 'string',
      wingId: 'string',
      title: 'string',
      aliases: { array: 'string' },
      kind: 'string',
      description: 'string?',
      body: 'string',
      frontmatter: 'record',
      dateCreated: 'string?',
    },
    Door: {
      from: 'string',
      to: 'string',
      weight: { enum: ['hard', 'soft'] },
      reason: 'string',
    },
    Hall: {
      id: 'string',
      intent: { array: 'string' },
      rooms: { array: 'string' },
      stable: 'boolean',
    },
    ReviewCard: {
      id: 'string',
      roomId: 'string',
      kind: { enum: ['cloze', 'term-from-def', 'dependency', 'exercise', 'teaches'] },
      front: 'string',
      back: 'string',
      stability: 'number',
      difficulty: 'number',
      lastReviewedAt: 'number?',
      choices: { optional: { array: 'ReviewChoice' } },
      accepts: { optional: { array: 'string' } },
    },
    ReviewChoice: {
      label: 'string',
      roomId: 'string',
    },
  },
});

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function checkField(path, value, spec, schema, errors) {
  if (typeof spec === 'object' && spec !== null && 'optional' in spec) {
    if (value === undefined) return;
    checkField(path, value, spec.optional, schema, errors);
    return;
  }
  if (typeof spec === 'string' && spec.endsWith('?')) {
    if (value === undefined) return;
    checkField(path, value, spec.slice(0, -1), schema, errors);
    return;
  }
  if (spec === 'string') {
    if (typeOf(value) !== 'string') errors.push(`${path}: expected string, got ${typeOf(value)}`);
    return;
  }
  if (spec === 'number') {
    if (typeOf(value) !== 'number') errors.push(`${path}: expected number, got ${typeOf(value)}`);
    return;
  }
  if (spec === 'boolean') {
    if (typeOf(value) !== 'boolean') errors.push(`${path}: expected boolean, got ${typeOf(value)}`);
    return;
  }
  if (spec === 'record') {
    if (typeOf(value) !== 'object') errors.push(`${path}: expected an object (frontmatter record), got ${typeOf(value)}`);
    return;
  }
  if (typeof spec === 'object' && spec !== null) {
    if ('enum' in spec) {
      if (!spec.enum.includes(value)) errors.push(`${path}: expected one of [${spec.enum.join(', ')}], got ${JSON.stringify(value)}`);
      return;
    }
    if ('array' in spec) {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected an array, got ${typeOf(value)}`);
        return;
      }
      value.forEach((item, i) => {
        if (schema.shapes[spec.array]) {
          checkShape(`${path}[${i}]`, item, spec.array, schema, errors);
        } else {
          checkField(`${path}[${i}]`, item, spec.array, schema, errors);
        }
      });
      return;
    }
  }
  errors.push(`${path}: unrecognized schema spec ${JSON.stringify(spec)}`);
}

function checkShape(path, value, shapeName, schema, errors) {
  const shape = schema.shapes[shapeName];
  if (!shape) {
    errors.push(`${path}: unknown shape "${shapeName}"`);
    return;
  }
  if (typeOf(value) !== 'object') {
    errors.push(`${path}: expected a ${shapeName} object, got ${typeOf(value)}`);
    return;
  }
  for (const [key, spec] of Object.entries(shape)) {
    checkField(`${path}.${key}`, value[key], spec, schema, errors);
  }
}

/**
 * Validate a value against `WORLD_JSON_SCHEMA`. Returns `{ valid, errors }` rather than
 * throwing — callers (tests, `assembleWorld`) decide what to do with a failure.
 * @param {unknown} world
 */
export function validateWorld(world) {
  const errors = [];
  if (typeOf(world) !== 'object') {
    return { valid: false, errors: [`world: expected an object, got ${typeOf(world)}`] };
  }
  for (const [key, spec] of Object.entries(WORLD_JSON_SCHEMA.fields)) {
    checkField(`world.${key}`, world[key], spec, WORLD_JSON_SCHEMA, errors);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * The one place every compile path's output becomes a returned `World`. Throws with every
 * validation error collected (never just the first) if the assembled shape does not conform —
 * "emit EXACTLY the platform World JSON shape" is enforced here, not just documented.
 */
export function assembleWorld(candidate) {
  const { valid, errors } = validateWorld(candidate);
  if (!valid) {
    throw new Error(`education-platform-service: assembled World does not conform to the platform World JSON contract:\n  ${errors.join('\n  ')}`);
  }
  // A World is JSON: an absent optional field is absent, not an undefined one (readers leave
  // `description: undefined` on rooms that declare none, which canonical JSON refuses).
  const plain = (records) => records.map((record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)));
  return { ...candidate, rooms: plain(candidate.rooms), doors: plain(candidate.doors), halls: plain(candidate.halls), cards: plain(candidate.cards) };
}

/** Recursively stringify with object keys sorted, so structurally-identical values always
 * produce byte-identical JSON regardless of key insertion order — used by the determinism test
 * and available to any caller writing a `World` to disk who wants that guarantee. */
