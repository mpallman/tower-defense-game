// save.js — serialise / deserialise / migrate. Single slot in localStorage.
//
// Every stored save carries a schemaVersion. Loading an older save runs the
// migrations in order; it never silently resets progress.

export const SCHEMA_VERSION = 3;
export const STORAGE_KEY = 'towerdefense.save';

// The eleven fixed build slots that existed before free placement. Frozen on
// purpose: a migration must describe the old data, not follow the live level.
const LEGACY_SLOTS = [
  [30, 120], [150, 120], [240, 120],
  [20, 222], [150, 222], [240, 222],
  [30, 330], [110, 332], [245, 330],
  [95, 440], [268, 435],
];

// migrations[n] upgrades a payload from version n to version n + 1.
const migrations = {
  // Saves written before versioning existed are treated as version 0.
  0: (data) => ({
    ...data,
    // The three upgrades that existed at version 0. Later ones are filled in
    // by restore(), which reads the live table — a migration must describe the
    // old data, not follow whatever BALANCE says today.
    upgrades: { damage: 0, rate: 0, range: 0, ...(data.upgrades || {}) },
    cores: data.cores || 0,
  }),

  // v2 -> v3: towers gained a running cost, so a save needs somewhere for
  // buildings and stock to live. The opening depot is not added here — game.js
  // seeds it after every restore, so there is one place that decides where it
  // goes. The starting stock is added, or a migrated base would have a depot
  // and nothing in it.
  2: (data) => ({
    ...data,
    buildings: Array.isArray(data.buildings) ? data.buildings : [],
    resources: { ore: 0, power: 0, ammo: 140, shells: 0, ...(data.resources || {}) },
  }),

  // v1 -> v2: towers moved from a slot index to free x/y coordinates.
  1: (data) => ({
    ...data,
    towers: (Array.isArray(data.towers) ? data.towers : []).map((t) => {
      if (Number.isFinite(t.x) && Number.isFinite(t.y)) return t;
      const slot = LEGACY_SLOTS[t.slot];
      if (!slot) return null;
      const { slot: _dropped, ...rest } = t;
      return { ...rest, x: slot[0], y: slot[1] };
    }).filter(Boolean),
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
