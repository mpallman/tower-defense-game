// save.js — serialise / deserialise / migrate. Single slot in localStorage.
//
// Every stored save carries a schemaVersion. Loading an older save runs the
// migrations in order; it never silently resets progress.

export const SCHEMA_VERSION = 4;
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
  // buildings and stock to live. No depot is added here; the 3 -> 4 step below
  // hands the run a free one to place, which is the same answer for a save
  // that never had buildings and one that lost its way.
  2: (data) => ({
    ...data,
    buildings: Array.isArray(data.buildings) ? data.buildings : [],
    resources: { ore: 0, power: 0, ammo: 140, shells: 0, ...(data.resources || {}) },
  }),

  // v3 -> v4: the opening stopped being placed for the player. There is no
  // seeded depot any more; instead a run holds one free depot and one free
  // turret to put wherever it likes.
  //
  // An existing save keeps everything it has — nothing is moved or deleted.
  // It is granted a free build only for what it does not already own, which
  // both leaves a going run alone and rescues one that got stuck with no
  // depot and too little to buy one. Anything already standing that cost
  // nothing (the old seeded depot, an older migration's depot) is marked free,
  // so it stops inflating the price of the first depot actually bought.
  3: (data) => {
    const towers = Array.isArray(data.towers) ? data.towers : [];
    const buildings = Array.isArray(data.buildings) ? data.buildings : [];
    const has = (list, type) => list.some((it) => it.type === type);
    return {
      ...data,
      towers: towers.map((t) => (t.spent ? t : { ...t, free: true })),
      buildings: buildings.map((b) => (b.spent ? b : { ...b, free: true })),
      freeBuilds: {
        depot: has(buildings, 'depot') ? 0 : 1,
        turret: has(towers, 'turret') ? 0 : 1,
      },
    };
  },

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
