// placement.js — where a thing may stand, and putting it there or taking it
// away again.
//
// Towers and buildings share one rule set and differ only in footprint and in
// the ore-node rule, so both go through `canPlace`. Kept out of game.js
// because it is a self-contained question — "is this spot legal?" — that the
// simulation loop never needs to know the inside of.

import { BALANCE } from './balance.js';
import { LEVEL, distanceToPath } from './game.js';
import { oreNodeAt } from './economy.js';

// Everything you can put on the ground goes through here. Towers and
// buildings differ only in footprint and in the ore-node rule.
export function canPlace(state, x, y, { radius, ignoreId = null, needsOre = false }) {
  const b = BALANCE.build;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'off the map' };
  const w = BALANCE.world;
  if (x < w.x + b.edgeMargin || x > w.x + w.width - b.edgeMargin
    || y < w.y + b.edgeMargin || y > w.y + w.height - b.edgeMargin) {
    return { ok: false, reason: 'off the map' };
  }
  if (distanceToPath(x, y) < BALANCE.world.pathWidth / 2 + radius + b.pathClearance) {
    return { ok: false, reason: 'too close to the path' };
  }
  if (Math.hypot(x - LEVEL.vault[0], y - LEVEL.vault[1]) < b.vaultClearance) {
    return { ok: false, reason: 'too close to the vault' };
  }
  // Asked before the spacing rules, because "that node is taken" explains a
  // refused miner far better than the spacing rule that would also catch it.
  let node = null;
  if (needsOre) {
    node = oreNodeAt(LEVEL.oreNodes, x, y, state.buildings);
    if (!node) return { ok: false, reason: 'must sit on an ore node' };
    if (node.taken) return { ok: false, reason: 'that node is already mined' };
  }
  // Two footprints may not overlap: the gap is measured between their edges,
  // not their centres, so a big building keeps its distance properly.
  for (const t of state.towers) {
    if (t.id === ignoreId) continue;
    if (Math.hypot(x - t.x, y - t.y) < radius + b.towerRadius + b.spacingGap) {
      return { ok: false, reason: 'too close to another tower' };
    }
  }
  for (const bl of state.buildings) {
    if (bl.id === ignoreId) continue;
    if (Math.hypot(x - bl.x, y - bl.y) < radius + BALANCE.economy.buildingRadius + b.spacingGap) {
      return { ok: false, reason: 'too close to a building' };
    }
  }
  return node ? { ok: true, snapTo: node } : { ok: true };
}

export function canPlaceTower(state, x, y, ignoreId = null) {
  return canPlace(state, x, y, { radius: BALANCE.build.towerRadius, ignoreId });
}

export function canPlaceBuilding(state, x, y, type, ignoreId = null) {
  const def = BALANCE.buildings[type];
  if (!def) return { ok: false, reason: 'unknown building' };
  return canPlace(state, x, y, {
    radius: BALANCE.economy.buildingRadius,
    ignoreId,
    needsOre: !!def.needsOre,
  });
}

// Costs rise with how many of that kind you already own.
export function towerCost(state, type) {
  const t = BALANCE.towers[type];
  const owned = state.towers.filter((tw) => tw.type === type).length;
  return Math.ceil(t.cost * Math.pow(t.costGrowth, owned));
}

export function buildingCost(state, type) {
  const def = BALANCE.buildings[type];
  const owned = state.buildings.filter((b) => b.type === type).length;
  return Math.ceil(def.cost * Math.pow(def.costGrowth, owned));
}

export function buildTower(state, x, y, type) {
  if (!BALANCE.towers[type]) return { ok: false, reason: 'unknown tower' };
  const spot = canPlaceTower(state, x, y);
  if (!spot.ok) return spot;
  const cost = towerCost(state, type);
  if (state.credits < cost) return { ok: false, reason: 'not enough credits' };
  state.credits -= cost;
  const tower = {
    id: state.nextId++, type, x, y, spent: cost,
    cooldown: 0, angle: -Math.PI / 2, recoil: 0, kills: 0, damageDone: 0, starved: false,
    beamHold: 0, beamPulse: 0, beamX: 0, beamY: 0,
  };
  state.towers.push(tower);
  return { ok: true, cost, id: tower.id, tower };
}

// `free` places one without charging, which is how the run's opening depot and
// an older save's migration depot get put down.
export function buildBuilding(state, x, y, type, { free = false } = {}) {
  const def = BALANCE.buildings[type];
  if (!def) return { ok: false, reason: 'unknown building' };
  const spot = canPlaceBuilding(state, x, y, type);
  if (!spot.ok) return spot;
  const cost = free ? 0 : buildingCost(state, type);
  if (state.credits < cost) return { ok: false, reason: 'not enough credits' };
  state.credits -= cost;
  // A miner snaps onto the node it was dropped near, so it always looks
  // planted on it rather than beside it.
  const at = spot.snapTo || { x, y };
  const building = { id: state.nextId++, type, x: at.x, y: at.y, spent: cost, rate: 1 };
  state.buildings.push(building);
  return { ok: true, cost, id: building.id, building };
}

export function sellTower(state, id) {
  const i = state.towers.findIndex((t) => t.id === id);
  if (i < 0) return { ok: false, reason: 'no such tower' };
  const refund = Math.floor(state.towers[i].spent * BALANCE.economy.sellRefund);
  state.credits += refund;
  state.towers.splice(i, 1);
  if (state.selected === id) state.selected = null;
  return { ok: true, refund };
}

export function sellBuilding(state, id) {
  const i = state.buildings.findIndex((b) => b.id === id);
  if (i < 0) return { ok: false, reason: 'no such building' };
  const refund = Math.floor(state.buildings[i].spent * BALANCE.economy.sellRefund);
  state.credits += refund;
  state.buildings.splice(i, 1);
  if (state.selectedBuilding === id) state.selectedBuilding = null;
  return { ok: true, refund };
}

// Every fresh run opens with a stocked depot by the vault, because a turret
// with no supply line does not fire and wave 1 arrives before you have built
// anything.
export function seedBase(state) {
  if (state.buildings.length) return;
  const [x, y] = BALANCE.economy.startingDepot;
  state.buildings.push({ id: state.nextId++, type: 'depot', x, y, spent: 0, rate: 1 });
}
