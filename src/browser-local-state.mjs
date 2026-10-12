/** Browser-safe, schema-agnostic local state. Consumers supply all domain policy. */

function safelyGetStorage(getStorage) {
  try {
    const storage = getStorage();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}

function parseValid(text, validate) {
  try { return validate(JSON.parse(text)); } catch { return null; }
}

function assertValid(state, validate) {
  const valid = validate(state);
  if (valid === null || valid === undefined) throw new TypeError('State does not satisfy this local-state schema.');
  return valid;
}

/**
 * Opens state once. A corrupt persisted value enters session mode so ordinary
 * saves cannot overwrite it; only an explicit import or reset may replace it.
 */
export function openBrowserLocalState({ key, create, validate, getStorage = () => globalThis.localStorage }) {
  if (typeof key !== 'string' || !key || typeof create !== 'function' || typeof validate !== 'function') throw new TypeError('key, create, and validate are required.');
  const storage = safelyGetStorage(getStorage);
  const fresh = () => assertValid(create(), validate);
  if (!storage) return makeHandle({ key, validate, storage: null, state: fresh(), mode: 'session' });
  let raw;
  try { raw = storage.getItem(key); } catch { return makeHandle({ key, validate, storage: null, state: fresh(), mode: 'session' }); }
  if (raw === null) return makeHandle({ key, validate, storage, state: fresh(), mode: 'persistent' });
  const state = parseValid(raw, validate);
  if (state === null || state === undefined) return makeHandle({ key, validate, storage, state: fresh(), mode: 'session' });
  return makeHandle({ key, validate, storage, state, mode: 'persistent' });
}

function makeHandle({ key, validate, storage, state, mode }) {
  let current = state;
  let currentMode = mode;
  const write = (next) => {
    current = assertValid(next, validate);
    if (currentMode !== 'persistent' || !storage) return false;
    try { storage.setItem(key, JSON.stringify(current)); return true; } catch { currentMode = 'session'; return false; }
  };
  return Object.freeze({
    get state() { return current; },
    get mode() { return currentMode; },
    save: write,
    /** A user-directed import may intentionally replace corrupt persisted bytes. */
    replace(next) {
      current = assertValid(next, validate);
      if (!storage) { currentMode = 'session'; return false; }
      try { storage.setItem(key, JSON.stringify(current)); currentMode = 'persistent'; return true; } catch { currentMode = 'session'; return false; }
    },
    /** A user-directed reset is the only operation that removes persisted bytes. */
    clear(create) {
      if (typeof create !== 'function') throw new TypeError('A create function is required to reset state.');
      current = assertValid(create(), validate);
      if (!storage || typeof storage.removeItem !== 'function') { currentMode = 'session'; return false; }
      try { storage.removeItem(key); currentMode = 'persistent'; return true; } catch { currentMode = 'session'; return false; }
    },
  });
}

export function exportBrowserLocalState(state, validate) {
  return JSON.stringify(assertValid(state, validate), null, 2);
}

export function importBrowserLocalState(text, validate) {
  if (typeof text !== 'string') return null;
  return parseValid(text, validate);
}
