// derive.js — the numbers the game reads off BALANCE and the current state.
//
// Pure functions of (state, ...), no side effects, no events. They are the
// same answers the simulation acts on and the panel prints, which is why they
// live in one place rather than being worked out twice.

import { BALANCE } from './balance.js';

export const prestigeMult = (state) => 1 + state.cores * BALANCE.prestige.bonusPerCore;

export function upgradeMult(state, key) {
  return 1 + state.upgrades[key] * BALANCE.upgrades[key].effect;
}

export function upgradeCost(state, key) {
  const u = BALANCE.upgrades[key];
  return Math.ceil(u.cost * Math.pow(u.growth, state.upgrades[key]));
}

// Takes anything with a `type`, so the panel can ask about a tower it has not
// built yet as easily as about one standing on the map.
export function towerStats(state, tower) {
  const t = BALANCE.towers[tower.type];
  return {
    damage: t.damage * upgradeMult(state, 'damage') * prestigeMult(state),
    range: t.range * upgradeMult(state, 'range'),
    fireRate: t.fireRate * upgradeMult(state, 'rate'),
    splashRadius: t.splashRadius || 0,
    splashFalloff: t.splashFalloff || 0,
    projectileSpeed: t.projectileSpeed || 0,
    beam: !!t.beam,
  };
}

// How fast every building runs: the run-scoped upgrade and the permanent
// prestige bonus, exactly as towers scale with damage and prestige. Applied to
// what a building eats as well as what it makes, so the ore-to-ammo ratio a
// factory needs is the same at every level and stays tunable in one place.
export function outputMult(state) {
  return upgradeMult(state, 'output') * prestigeMult(state);
}

export function waveHp(wave) {
  return BALANCE.waves.hpBase * Math.pow(BALANCE.waves.hpGrowth, wave - 1);
}

export function waveSpeed(wave) {
  return Math.min(
    BALANCE.waves.speedMax,
    BALANCE.waves.speedBase * Math.pow(BALANCE.waves.speedGrowth, wave - 1),
  );
}

export function waveBounty(wave) {
  return BALANCE.waves.bountyBase * Math.pow(BALANCE.waves.bountyGrowth, wave - 1);
}

export function isBossWave(wave) {
  return wave % BALANCE.waves.bossEvery === 0;
}

// Which enemy types this wave can field, and how tough each one is. Derived
// straight from BALANCE, so the UI can show it without rolling the dice or
// touching the rng the real wave will use.
export function waveRoster(wave) {
  const hp = waveHp(wave);
  const pool = Object.entries(BALANCE.enemies).filter(([, e]) => e.weight > 0 && wave >= e.minWave);
  const total = pool.reduce((sum, [, e]) => sum + e.weight, 0) || 1;
  const list = pool.map(([key, def]) => ({ key, def, share: def.weight / total, hp: hp * def.hp }));
  if (isBossWave(wave)) {
    const def = BALANCE.enemies.boss;
    list.push({ key: 'boss', def, share: 0, hp: hp * def.hp });
  }
  return list;
}

// 0..1 through the current phase: the prep countdown, then the wave itself.
export function waveProgress(state) {
  if (state.phase === 'prep') {
    return 1 - Math.max(0, Math.min(1, state.phaseTimer / BALANCE.waves.prepTime));
  }
  if (!state.waveTotal) return 0;
  const left = state.queue.length + state.enemies.length;
  return Math.max(0, Math.min(1, 1 - left / state.waveTotal));
}

export function pendingCores(state) {
  const p = BALANCE.prestige;
  return Math.floor(Math.pow(Math.max(0, state.runEarned) / p.divisor, p.exponent));
}
