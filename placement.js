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
// How many free ones of this type the run still has in hand. The grant is a
// run-scoped count, not a "have you built one yet" test, so selling the free
// one gives it back and a run can never be left unable to replace it.
export function freeLeft(state, type) {
  const n = state.freeBuilds?.[type];
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

// The cost curve counts what you have *paid* for. A free build must not push
// the price of the next one up — being given something should not make the
// thing after it more expensive.
function paidCount(list, type) {
  return list.filter((it) => it.type === type && !it.free).length;
}

export function towerCost(state, type) {
  const t = BALANCE.towers[type];
  if (freeLeft(state, type) > 0) return 0;
  return Math.ceil(t.cost * Math.pow(t.costGrowth, paidCount(state.towers, type)));
}

export function buildingCost(state, type) {
  const def = BALANCE.buildings[type];
  if (freeLeft(state, type) > 0) return 0;
  return Math.ceil(def.cost * Math.pow(def.costGrowth, paidCount(state.buildings, type)));
}

// Spend a free grant, if one is in hand. Returns whether this build is free.
function takeFree(state, type) {
  if (freeLeft(state, type) <= 0) return false;
  state.freeBuilds[type] = freeLeft(state, type) - 1;
  return true;
}

// Hand a grant back when a free build is sold or otherwise removed.
function returnFree(state, item) {
  if (!item.free) return;
  if (!state.freeBuilds) state.freeBuilds = {};
  state.freeBuilds[item.type] = freeLeft(state, item.type) + 1;
}

export function buildTower(state, x, y, type) {
  if (!BALANCE.towers[type]) return { ok: false, reason: 'unknown tower' };
  const spot = canPlaceTower(state, x, y);
  if (!spot.ok) return spot;
  const cost = towerCost(state, type);
  if (state.credits < cost) return { ok: false, reason: 'not enough credits' };
  const free = takeFree(state, type);
  state.credits -= cost;
  const tower = {
    id: state.nextId++, type, x, y, spent: cost, free,
    cooldown: 0, angle: -Math.PI / 2, recoil: 0, kills: 0, damageDone: 0, starved: false,
    beamHold: 0, beamPulse: 0, beamX: 0, beamY: 0,
  };
  state.towers.push(tower);
  return { ok: true, cost, free, id: tower.id, tower };
}

// `gift` places one without charging or spending a grant. Nothing in the game
// uses it now that the opening is player-placed; it stays because a migration
// or a future reward may need to hand someone a building outright.
export function buildBuilding(state, x, y, type, { free: gift = false } = {}) {
  const def = BALANCE.buildings[type];
  if (!def) return { ok: false, reason: 'unknown building' };
  const spot = canPlaceBuilding(state, x, y, type);
  if (!spot.ok) return spot;
  const cost = gift ? 0 : buildingCost(state, type);
  if (state.credits < cost) return { ok: false, reason: 'not enough credits' };
  const free = gift || takeFree(state, type);
  state.credits -= cost;
  // A miner snaps onto the node it was dropped near, so it always looks
  // planted on it rather than beside it.
  const at = spot.snapTo || { x, y };
  const building = { id: state.nextId++, type, x: at.x, y: at.y, spent: cost, free, rate: 1 };
  state.buildings.push(building);
  return { ok: true, cost, free, id: building.id, building };
}

export function sellTower(state, id) {
  const i = state.towers.findIndex((t) => t.id === id);
  if (i < 0) return { ok: false, reason: 'no such tower' };
  const refund = Math.floor(state.towers[i].spent * BALANCE.economy.sellRefund);
  state.credits += refund;
  returnFree(state, state.towers[i]);
  state.towers.splice(i, 1);
  if (state.selected === id) state.selected = null;
  return { ok: true, refund };
}

export function sellBuilding(state, id) {
  const i = state.buildings.findIndex((b) => b.id === id);
  if (i < 0) return { ok: false, reason: 'no such building' };
  const refund = Math.floor(state.buildings[i].spent * BALANCE.economy.sellRefund);
  state.credits += refund;
  returnFree(state, state.buildings[i]);
  state.buildings.splice(i, 1);
  if (state.selectedBuilding === id) state.selectedBuilding = null;
  return { ok: true, refund };
}
