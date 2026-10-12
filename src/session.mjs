/**
 * `session` -- the exercise session engine: deterministic seeded ordering of a play session,
 * over either an ungated room's gate exercises or a player's globally-due review queue. Neither
 * design doc names this module directly, but both require it by construction: platform §3 states
 * "every function that needs 'now' takes it as a parameter... nothing ever calls `Date.now()`"
 * as a house rule binding "every checker and every scheduler in every theme" (§8 point 4), and
 * the same section demands "deterministic seeded RNG, never bare `Math.random()`" for anything
 * that orders or samples. A session is exactly that: it orders exercises, and ties (equal due-
 * ness) must break the same way every time a session is rebuilt from the same state, not
 * differently per page load -- otherwise two players (or one player replaying a saved seed for a
 * bug report) would legitimately see different sessions from identical inputs.
 *
 * The RNG itself (`mulberry32`) is a small, public-domain, single-multiply generator -- no
 * dependency, seeded by a plain 32-bit integer, exactly the "zero runtime dependencies" and
 * "deterministic seeded RNG" constraints both ask for.
 */
import { deriveSetOfDueEvents } from '@red-cup-engineering/icalendar-services-section/derive-set-of-due-events';
import { recallProbability, daysUntilRetention, DEFAULT_TARGET_RETENTION } from './srs.mjs';
import { DAY_MS } from './persistence.mjs';

/** mulberry32: a fast, small, deterministic 32-bit PRNG. Same seed -> same infinite output
 * sequence, always -- this is the entire determinism contract a session needs. Not
 * cryptographically secure, and never claimed to be; sessions need reproducibility, not secrecy. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle, driven by a seeded generator (never `Math.random()`). Does
 * not mutate `items`. */
export function seededShuffle   (items, seed) {
  const rng = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * A room's gate session: every exercise for that room, deterministically ordered by `seed`. Two
 * calls with the same `roomId`/`exercises`/`seed` always produce the same order -- this is what
 * lets a session be replayed exactly (a bug report, a "retry this exact gate" feature, or a test)
 * without depending on wall-clock or engine-internal iteration order.
 */
export function buildGateSession(roomId, exercises, seed) {
  const forRoom = exercises.filter((e) => e.roomId === roomId);
  return seededShuffle(forRoom, seed);
}



/** Converts an epoch day (persistence.mts's `DAY_MS`-scaled "days since Unix epoch" convention,
 * the same epoch `today()` already anchors) to an ISO 8601 UTC instant. A pure function of the
 * day number, never `Date.now()`. */
function epochDayToIso(day) {
  return new Date(Math.round(day * DAY_MS)).toISOString();
}

/** Formats an ISO 8601 UTC instant as an RFC 5545 basic UTC date-time ("YYYYMMDDTHHMMSSZ"), the
 * DTSTART form expand-recurrence-rule-service and derive-set-of-due-events-service require. */
function isoToBasicUtc(iso) {
  return iso.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

/**
 * A reviewed candidate's FSRS-lite next-due instant, as an RFC 5545 VEVENT-shaped bare-DTSTART
 * record (RFC 5545 §3.8.5.2: occurs exactly once, no RRULE) -- the same shape every other house
 * scheduling call site expresses "due at a time" in. `daysUntilRetention` (srs.mts's own FSRS-lite
 * math, untouched here) supplies the day offset; this only re-expresses that day as a calendar
 * instant. Returns `null` for a never-reviewed candidate (it has no next-due instant yet).
 */
export function nextDueEvent(id, candidate, targetR = DEFAULT_TARGET_RETENTION) {
  if (candidate.lastReviewedAt === undefined) return null;
  const dueDay = candidate.lastReviewedAt + daysUntilRetention(candidate.stability, targetR);
  return { id, dtstart: isoToBasicUtc(epochDayToIso(dueDay)) };
}

/**
 * The subset of `candidates` genuinely due at `now` (an epoch day), decided by composing
 * `@red-cup-engineering/derive-set-of-due-events-service` over each reviewed candidate's FSRS-lite
 * next-due VEVENT (`nextDueEvent`) -- never a second, hand-rolled due/not-due comparison. Order is
 * candidates' own array order; `buildReviewSession`'s weakest-recall-first ordering runs
 * separately, over whatever this returns.
 */
export function dueReviewCandidates(candidates, now) {
  const indexed = candidates.map((candidate, index) => ({ candidate, event: nextDueEvent(String(index), candidate) }));
  const events = indexed.flatMap((entry) => (entry.event === null ? [] : [entry.event]));
  const { due } = deriveSetOfDueEvents({ events, now: epochDayToIso(now) });
  const dueIds = new Set(due.map((d) => d.id));
  return indexed.filter((entry) => entry.event !== null && dueIds.has(entry.event.id)).map((entry) => entry.candidate);
}

/**
 * The due-review queue at `now`, sorted weakest-recall-first (the FSRS convention -- the exercise
 * most at risk of being forgotten is reviewed first), with ties broken by a seeded shuffle so the
 * order is reproducible rather than an accident of array position. `limit`, if given, caps the
 * session length (still deterministic: the same seed always keeps the same prefix).
 *
 * By default every candidate with `lastReviewedAt !== undefined` is eligible, exactly as before.
 * `options.dueOnly` narrows eligibility first to `dueReviewCandidates` -- candidates whose
 * FSRS-lite next-due VEVENT has actually arrived by `now`, per
 * `derive-set-of-due-events-service` -- before this function's own ordering runs.
 */
export function buildReviewSession(
  candidates,
  now,
  seed,
  limit,
  options,
) {
  const pool = options?.dueOnly ? dueReviewCandidates(candidates, now) : candidates;
  const due = [];
  for (const c of pool) {
    if (c.lastReviewedAt === undefined) continue;
    const t = Math.max(0, now - c.lastReviewedAt);
    due.push({ ...c, R: recallProbability(t, c.stability) });
  }
  // Seeded shuffle first (breaks ties reproducibly), THEN a stable sort by R -- so exercises with
  // equal R keep the shuffle's order rather than falling back to array/insertion order.
  const shuffled = seededShuffle(due, seed);
  const sorted = shuffled
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.R - b.c.R || a.i - b.i)
    .map(({ c }) => c);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}
