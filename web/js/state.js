/**
 * `state` -- the browser face's thin binding of the vendored, storage-backend-agnostic
 * `persistence.mts` (self-education-platform-design.md §7) to the real `window.localStorage`
 * global. `persistence.mts`'s own header anticipates a "hand-written vanilla-JS port... the same
 * relationship Lantern's own web/js/state.js already has to its engine modules" -- but unlike
 * `lightcone.js`/`srs.js` in Lantern's original face (written for a pre-`stripTypeScriptTypes`
 * Node, per that file's own header), `persistence.mts` is ALREADY mechanically vendored byte-
 * faithfully to `vendor/src/persistence.js` by `sync-vendor.mjs`, and it already takes its
 * storage boundary as a parameter (`StorageAdapter`, two methods: `getItem`/`setItem`) --
 * exactly `window.localStorage`'s own shape. Hand-porting the logic a second time here would
 * reintroduce the drift risk `sync-vendor.mjs`'s own header explains mechanical stripping
 * avoids, for zero benefit. This file is therefore a binding, not a port: it supplies the one
 * thing `persistence.mts` deliberately does not hard-code (which storage global to use, and
 * which `themeId` this face plays), and re-exports everything else untouched.
 */
import * as persistence from '../../src/persistence.mjs';

/** Bind the shared state policy to an adapter-selected theme id. */
export function createStateStore(themeId, storage = browserStorage()) {
  if (!themeId) throw new TypeError('themeId is required');
  let playerHandle;
  return {
    load() { playerHandle = persistence.openPlayerState(storage, themeId); return playerHandle.state; },
    save(state) { return playerHandle.save(state); },
    replace(state) { return playerHandle.replace(state); },
    get mode() { return playerHandle?.mode ?? 'session'; },
  };
}

export const today = persistence.today;
export const effectiveExerciseState = persistence.effectiveExerciseState;
export const recordExerciseReview = persistence.recordExerciseReview;
export const touchStreak = persistence.touchStreak;
export const streakAtRisk = persistence.streakAtRisk;
export const exportStateJson = persistence.exportStateJson;
export const importStateJson = persistence.importStateJson;

/** `window.localStorage` satisfies `StorageAdapter` directly -- no wrapping needed beyond
 * catching the "storage unavailable" case, which `persistence.mts` already does internally. */
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
