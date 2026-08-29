// save.js — serialise / deserialise / migrate. Single slot in localStorage.
//
// Every stored save carries a schemaVersion. Loading an older save runs the
// migrations in order; it never silently resets progress.

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'towerdefense.save';

// migrations[n] upgrades a payload from version n to version n + 1.
const migrations = {
  // Saves written before versioning existed are treated as version 0.
  0: (data) => ({
    ...data,
    upgrades: { damage: 0, rate: 0, range: 0, ...(data.upgrades || {}) },
    cores: data.cores || 0,
  }),
};

function storage() {
  try {
    // Private mode can expose localStorage but throw on write.
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__td_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch (err) {
    return null;
  }
}

export function migrate(payload) {
  let version = Number.isFinite(payload.schemaVersion) ? payload.schemaVersion : 0;
  let data = payload.data || {};
  while (version < SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new Error('no migration from schema version ' + version);
    data = step(data);
    version += 1;
  }
  return { data, migratedFrom: payload.schemaVersion };
}

export function serialize(data, savedAtWallMs) {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    savedAt: savedAtWallMs,
    data,
  });
}

export function saveGame(data, savedAtWallMs) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, serialize(data, savedAtWallMs));
    return true;
  } catch (err) {
    console.warn('save failed', err);
    return false;
  }
}

// Returns { data, savedAt, migratedFrom } or null when there is nothing usable.
export function loadGame() {
  const store = storage();
  if (!store) return null;
  let raw;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch (err) {
    return null;
  }
  if (!raw) return null;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.warn('save is not valid JSON; keeping it and starting fresh', err);
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  try {
    const { data, migratedFrom } = migrate(payload);
    return { data, savedAt: payload.savedAt || null, migratedFrom };
  } catch (err) {
    // A save from a *newer* build, or an unknown version. Never wipe it.
    console.warn('could not migrate save; leaving it untouched', err);
    return null;
  }
}

export function clearSave() {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(STORAGE_KEY);
    return true;
  } catch (err) {
    return false;
  }
}
