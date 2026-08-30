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

// One simulation step, in two passes so that nothing depends on the order
// buildings happen to sit in the array.
//
// Pass one runs the sources — miners and plants, which need no input. Pass two
// runs the converters against what is actually in the pool, sharing each
// resource *proportionally* when there is not enough to go round. Serving them
// first-come-first-served instead would leave two identical factories running
// at completely different rates with nothing on screen to explain why; a
// shared brownout slows the whole base together, which is legible at a glance
// from the flow readout.
export function stepEconomy(state, dt) {
  const speed = outputMult(state);

  for (const building of state.buildings) {
    const def = BALANCE.buildings[building.type];
    building.short = null;
    building.rate = 1;
    if (!def.produces || def.consumes) continue;
    for (const [key, rate] of Object.entries(def.produces)) {
      state.resources[key] = Math.min(capOf(key), state.resources[key] + rate * speed * dt);
    }
  }

  // What every converter would like, added up per resource.
  const demand = {};
  const converters = [];
  for (const building of state.buildings) {
    const def = BALANCE.buildings[building.type];
    if (!def.produces || !def.consumes) continue;
    converters.push(building);
    for (const [key, rate] of Object.entries(def.consumes)) {
      demand[key] = (demand[key] || 0) + rate * speed * dt;
    }
  }
  if (!converters.length) return;

  // The share of each resource everyone gets, and which one is scarcest.
  const share = {};
  for (const [key, want] of Object.entries(demand)) {
    share[key] = want <= 0 ? 1 : Math.min(1, state.resources[key] / want);
  }

  for (const building of converters) {
    const def = BALANCE.buildings[building.type];
    let ratio = 1;
    let short = null;
    for (const key of Object.keys(def.consumes)) {
      if (share[key] < ratio) { ratio = share[key]; short = key; }
    }
    building.rate = ratio;
    building.short = short;
    if (ratio <= 0) continue;
    for (const [key, rate] of Object.entries(def.consumes)) {
      state.resources[key] = Math.max(0, state.resources[key] - rate * speed * dt * ratio);
    }
    for (const [key, rate] of Object.entries(def.produces)) {
      state.resources[key] = Math.min(capOf(key), state.resources[key] + rate * speed * dt * ratio);
    }
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

// What a building is waiting on, or null if it is running at full rate. Named
// by input, because "no power" and "no ore" want different answers from you.
export function buildingProblem(state, building) {
  const def = BALANCE.buildings[building.type];
  if (!def.produces) return null;
  const rate = building.rate == null ? 1 : building.rate;
  if (rate > 0.999 || !building.short) return null;
  const name = BALANCE.resources[building.short].name.toLowerCase();
  return rate <= 0 ? `stalled — no ${name}` : `short of ${name}`;
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
