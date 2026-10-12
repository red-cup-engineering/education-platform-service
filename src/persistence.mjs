/**
 * `persistence` -- local-first player-state storage, self-education-platform-design.md §7. Two
 * kinds of state, kept strictly separate: the World SNAPSHOT (compile.mts's output --
 * deterministic, re-buildable, never hand-edited, never stored here) and PLAYER state (per-
 * exercise SRS state, streak counters -- the only state that must survive a corpus recompile
 * untouched, keyed by exercise id, which is itself `roomId#kind#index` so recompiling an
 * unchanged room reproduces the same ids and player state re-attaches cleanly).
 *
 * v1 persistence is `localStorage`-shaped, exactly as Lantern already ships it
 * (`lantern-service/web/js/state.js`) -- this module generalizes that file's LOGIC into a pure,
 * testable, storage-backend-agnostic form (the fleet's "storage pattern"), following the exact
 * same versioned-schema-plus-migration-chain shape, keyed by `themeId` instead of Lantern's
 * `wingId` so multiple themes on one origin never collide. The browser face (web/js/state.js)
 * is a hand-written vanilla-JS port of this same logic against the real `localStorage` global,
 * the same relationship Lantern's own web/js/state.js already has to its engine modules -- see
 * that file's header for why the browser copy is hand-written rather than compiled.
 */
import { exportBrowserLocalState, importBrowserLocalState, openBrowserLocalState } from './browser-local-state.mjs';

/** The storage boundary: `localStorage`'s own shape (two synchronous methods), so the browser
 * face can pass `window.localStorage` directly, and tests/servers can pass `memoryAdapter()`. */

/** An in-memory `StorageAdapter` -- what every test in this module (and any server-side session
 * that doesn't want a browser) uses. Never persists across process restarts; that is the point. */
export function memoryAdapter() {
  const map = new Map                ();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

export const SCHEMA_VERSION = 1;
export const DAY_MS = 86_400_000;

/** Epoch day used everywhere `now` is needed -- an integer day count, matching srs.mts's own
 * "caller's choice of epoch" contract. Never called from inside pure engine logic itself, only
 * from the app's read/write boundary (mirrors Lantern's `today()` in web/js/state.js). */
export function today(clockMs = Date.now()) {
  return Math.floor(clockMs / DAY_MS);
}



function storageKey(themeId) {
  return `education-platform:${themeId}`;
}

function emptyState(themeId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    themeId,
    exercises: {},
    streak: { current: 0, longest: 0, lastActiveDay: null, freezeTokens: 0, freezesUsed: 0 },
  };
}

/** Migration chain: each step takes the previous version's shape and returns the next. Add a new
 * `case N` here (never mutate an existing one) whenever `SCHEMA_VERSION` increments. */
function migrate(raw) {
  const state = raw;
  if (typeof state.schemaVersion !== 'number') {
    // Pre-versioned or corrupt: cannot trust shape, start clean rather than guess.
    return null;
  }
  // No migrations needed yet (schema v1 is the only version). Future:
  // if (state.schemaVersion === 1) { state = { ...state, schemaVersion: 2, ... }; }
  if (state.schemaVersion !== SCHEMA_VERSION || typeof state.themeId !== 'string' || !state.exercises || typeof state.exercises !== 'object' || Array.isArray(state.exercises) || !state.streak || typeof state.streak !== 'object') return null;
  const streak = state.streak;
  if (![streak.current, streak.longest, streak.freezeTokens, streak.freezesUsed].every(Number.isFinite) || !(streak.lastActiveDay === null || Number.isInteger(streak.lastActiveDay))) return null;
  if (!Object.values(state.exercises).every((card) => card && typeof card === 'object' && Number.isFinite((card).stability) && Number.isFinite((card).difficulty) && ((card).lastReviewedAt === undefined || Number.isInteger((card).lastReviewedAt)))) return null;
  return state;
}

export function openPlayerState(adapter, themeId) {
  return openBrowserLocalState({ key: storageKey(themeId), create: () => emptyState(themeId), validate: (raw) => { const state = migrate(raw); return state?.themeId === themeId ? state : null; }, getStorage: () => adapter });
}

export function loadPlayerState(adapter, themeId) {
  return openPlayerState(adapter, themeId).state;
}

/** Compatibility entry point; callers that perform repeated writes should retain openPlayerState's handle. */
export function savePlayerState(adapter, state) {
  return openPlayerState(adapter, state.themeId).save(state);
}

/** An exercise's SRS state as the engine wants it: the local override if reviewed at least once,
 * else a brand-new-exercise default (`lastReviewedAt` absent). `seedDifficulty`/`seedStability`
 * let a theme supply its own pre-first-review placeholder (Lantern's `cards.mts` uses
 * `stability: 0, difficulty: 5`); this module does not hard-code one. */
export function effectiveExerciseState(
  state,
  exerciseId,
  seedDefaults,
) {
  return state.exercises[exerciseId] ?? { stability: seedDefaults.stability, difficulty: seedDefaults.difficulty, lastReviewedAt: undefined };
}

export function recordExerciseReview(state, exerciseId, next) {
  return { ...state, exercises: { ...state.exercises, [exerciseId]: next } };
}

// --- streak + freeze tokens (cosmetic only -- equivo-design.md §7 disclosure: "nothing about a
// streak affects mastery or which exercises are due") ---------------------------------------

const FREEZE_MILESTONE_DAYS = 7;
const MAX_FREEZE_TOKENS = 3;

/** Call once per completed review action for the day. Idempotent within a day. Auto-consumes a
 * banked freeze token on exactly one missed day; two or more missed days break the streak even
 * with tokens banked (a freeze covers a single skipped day, not an extended absence). */
export function touchStreak(streak, day) {
  if (streak.lastActiveDay === day) return streak; // already recorded today
  if (streak.lastActiveDay === null) {
    return { ...streak, current: 1, longest: Math.max(streak.longest, 1), lastActiveDay: day };
  }
  const gap = day - streak.lastActiveDay;
  let current;
  let freezeTokens = streak.freezeTokens;
  let freezesUsed = streak.freezesUsed;
  if (gap === 1) {
    current = streak.current + 1;
  } else if (gap === 2 && freezeTokens > 0) {
    current = streak.current + 1;
    freezeTokens -= 1;
    freezesUsed += 1;
  } else {
    current = 1; // streak broken, restart
  }
  if (current > 0 && current % FREEZE_MILESTONE_DAYS === 0) {
    freezeTokens = Math.min(MAX_FREEZE_TOKENS, freezeTokens + 1);
  }
  return { ...streak, current, longest: Math.max(streak.longest, current), lastActiveDay: day, freezeTokens, freezesUsed };
}

/** Whether today's streak has already lapsed (no freeze available) as of `day`, purely for
 * display -- does not mutate anything. */
export function streakAtRisk(streak, day) {
  if (streak.lastActiveDay === null) return false;
  return day - streak.lastActiveDay >= 1;
}

// --- export / import (platform §7's documented seam for a future accounts layer) -----------

export function exportStateJson(state) {
  return exportBrowserLocalState(state, migrate);
}

export function importStateJson(text) {
  return importBrowserLocalState(text, migrate);
}
