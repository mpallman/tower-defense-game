// economy.js — resource stock, production, and who is allowed to draw on it.
//
// Two ideas, kept apart on purpose:
//
//   stock    is global. One number per resource. A miner on the far side of
//            the arena fills the same pool a factory next door draws from, so
//            there is no hauling to simulate and no logistics UI to explain.
//   supply   is local. A tower only fires if a building that *supplies* its
//            resource has it inside that building's radius. That is the part
//            the map decides, and it is why where you put a thing matters.
//
// Failure here is hard: a tower with no supply line, or an empty pool, does not
// fire. This is not an idle game — see CLAUDE.md.

import { BALANCE } from './balance.js';
import { outputMult } from './derive.js';

export const RESOURCE_KEYS = Object.keys(BALANCE.resources);

export function freshResources() {
  const stock = {};
  for (const key of RESOURCE_KEYS) {
    stock[key] = BALANCE.economy.startingStock[key] || 0;
  }
  return stock;
}

export function capOf(key) {
  return BALANCE.resources[key].cap;
}

// Is this building close enough to that point to serve it?
function reaches(building, x, y) {
  const def = BALANCE.buildings[building.type];
  return Math.hypot(building.x - x, building.y - y) <= def.radius;
}

// Which resources can be drawn at this spot, given what is built.
export function suppliedAt(state, x, y) {
  const found = new Set();
  for (const building of state.buildings) {
    const def = BALANCE.buildings[building.type];
    if (!def.supplies || !reaches(building, x, y)) continue;
    for (const key of def.supplies) found.add(key);
  }
  return found;
}

// The supply question a tower asks every time it wants to shoot.
export function towerIsSupplied(state, tower) {
  const need = BALANCE.towers[tower.type].ammoType;
  if (!need) return true;
  for (const building of state.buildings) {
    const def = BALANCE.buildings[building.type];
    if (!def.supplies || !def.supplies.includes(need)) continue;
    if (reaches(building, tower.x, tower.y)) return true;
  }
  return false;
}

// Spend on a shot. Returns false if the shot cannot be paid for, in which case
// nothing is deducted and the caller must not fire.
export function payForShot(state, tower) {
  const def = BALANCE.towers[tower.type];
  const key = def.ammoType;
  if (!key) return true;
  const cost = def.ammoPerShot || 0;
  if (state.resources[key] < cost) return false;
  state.resources[key] -= cost;
  return true;
}

// One building's output this step, limited by whatever it needs as input.
// Returns the fraction of full rate it actually managed, for the UI.
function runBuilding(state, building, dt, speed) {
  const def = BALANCE.buildings[building.type];
  if (!def.produces) return 1;

  let ratio = 1;
  if (def.consumes) {
    for (const [key, rate] of Object.entries(def.consumes)) {
      const want = rate * speed * dt;
      if (want <= 0) continue;
      ratio = Math.min(ratio, want <= state.resources[key] ? 1 : state.resources[key] / want);
    }
  }
  // A converter with no input at all does nothing rather than a little.
  if (ratio <= 0) return 0;

  if (def.consumes) {
    for (const [key, rate] of Object.entries(def.consumes)) {
      state.resources[key] = Math.max(0, state.resources[key] - rate * speed * dt * ratio);
    }
  }
  for (const [key, rate] of Object.entries(def.produces)) {
    state.resources[key] = Math.min(capOf(key), state.resources[key] + rate * speed * dt * ratio);
  }
  return ratio;
}

// Advance every building one simulation step.
export function stepEconomy(state, dt) {
  const speed = outputMult(state);
  for (const building of state.buildings) {
    building.rate = runBuilding(state, building, dt, speed);
  }
}

// Net flow per second per resource, as the panel reports it. Production is
// counted at the rate each building actually managed last step, so a starved
// factory reads as starved instead of as if it were running.
export function flowRates(state) {
  const flow = {};
  for (const key of RESOURCE_KEYS) flow[key] = 0;
  const speed = outputMult(state);
  for (const building of state.buildings) {
    const def = BALANCE.buildings[building.type];
    const ratio = (building.rate == null ? 1 : building.rate) * speed;
    if (def.produces) {
      for (const [key, rate] of Object.entries(def.produces)) flow[key] += rate * ratio;
    }
    if (def.consumes) {
      for (const [key, rate] of Object.entries(def.consumes)) flow[key] -= rate * ratio;
    }
  }
  return flow;
}

// What a tower is waiting on, or null if it is good to fire. The UI uses this
// to explain a silent tower rather than leaving the player guessing.
export function towerProblem(state, tower) {
  const key = BALANCE.towers[tower.type].ammoType;
  if (!key) return null;
  if (!towerIsSupplied(state, tower)) return 'no supply line';
  if (state.resources[key] < (BALANCE.towers[tower.type].ammoPerShot || 0)) return `out of ${BALANCE.resources[key].name.toLowerCase()}`;
  return null;
}

// Is a miner allowed here? It must be sitting on an unclaimed ore node.
export function oreNodeAt(nodes, x, y, buildings) {
  const snap = BALANCE.economy.oreSnap;
  for (let i = 0; i < nodes.length; i++) {
    const [nx, ny] = nodes[i];
    if (Math.hypot(nx - x, ny - y) > snap) continue;
    const taken = buildings.some((b) => b.type === 'miner' && Math.hypot(b.x - nx, b.y - ny) <= snap);
    return { index: i, x: nx, y: ny, taken };
  }
  return null;
}
