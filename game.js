// game.js — state, systems and the simulation loop.
//
// The simulation never reads the wall clock directly. It takes an injectable
// clock and advances in fixed steps, so a test can fast-forward thousands of
// waves without waiting for them.

import { BALANCE } from './balance.js';
import * as Save from './save.js';
import {
  freshResources, stepEconomy, payForShot, towerProblem,
  suppliedAt, flowRates, oreNodeAt, RESOURCE_KEYS,
} from './economy.js';
import * as Place from './placement.js';
import * as Derive from './derive.js';

// ---------------------------------------------------------------- level ----
// Geometry, not balance: the fixed path the enemies walk.
export const LEVEL = {
  path: [
    [-20, 70], [300, 70], [300, 170], [60, 170], [60, 270],
    [300, 270], [300, 382], [180, 382], [180, 452],
  ],
};

LEVEL.segments = (() => {
  const segs = [];
  let total = 0;
  for (let i = 0; i < LEVEL.path.length - 1; i++) {
    const [x1, y1] = LEVEL.path[i];
    const [x2, y2] = LEVEL.path[i + 1];
    const length = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, length, start: total });
    total += length;
  }
  return segs;
})();
LEVEL.pathLength = LEVEL.segments.reduce((a, s) => a + s.length, 0);
LEVEL.vault = LEVEL.path[LEVEL.path.length - 1];

// Where the path sits inside the arena. The camera opens framed on this, so
// the framing follows the path rather than repeating its numbers somewhere.
// Ore nodes: fixed geometry, like the path. Every one sits well clear of the
// path so a miner standing on it is never refused for being too close.
LEVEL.oreNodes = [
  [-120, -120], [60, -145], [250, -105], [400, -160],
  [430, 40], [440, 265], [400, 520], [520, 155],
  [120, 600], [300, 625], [-120, 480], [-140, 610],
  [-130, 180], [-60, -40],
];

LEVEL.bounds = LEVEL.path.reduce((box, [x, y]) => ({
  x0: Math.min(box.x0, x), y0: Math.min(box.y0, y),
  x1: Math.max(box.x1, x), y1: Math.max(box.y1, y),
}), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
LEVEL.center = {
  x: (LEVEL.bounds.x0 + LEVEL.bounds.x1) / 2,
  y: (LEVEL.bounds.y0 + LEVEL.bounds.y1) / 2,
};

export function pointAtDistance(dist) {
  const segs = LEVEL.segments;
  const d = Math.max(0, Math.min(dist, LEVEL.pathLength));
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (d <= s.start + s.length || i === segs.length - 1) {
      const t = s.length === 0 ? 0 : (d - s.start) / s.length;
      return { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t };
    }
  }
  return { x: LEVEL.vault[0], y: LEVEL.vault[1] };
}

// Shortest distance from a point to the path centre line.
export function distanceToPath(x, y) {
  let best = Infinity;
  for (const s of LEVEL.segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / lenSq));
    const d = Math.hypot(x - (s.x1 + dx * t), y - (s.y1 + dy * t));
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------- clock ----
// The one place the real world's time enters the game.
export function createSystemClock() {
  return { now: () => Date.now() };
}

// A clock tests can drive by hand.
export function createManualClock(startMs = 0) {
  let t = startMs;
  return { now: () => t, set: (ms) => { t = ms; }, advance: (ms) => { t += ms; } };
}

// ------------------------------------------------------------------ rng ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- state ----
function freshRunState() {
  return {
    wave: 1,
    phase: 'prep',            // 'prep' | 'wave'
    phaseTimer: BALANCE.waves.prepTime,
    spawnTimer: 0,
    queue: [],                // enemy type keys left to spawn this wave
    waveTotal: 0,             // how many the current wave started with, for the progress bar
    credits: BALANCE.economy.startingCredits,
    vaultHp: BALANCE.vault.maxHp,
    runEarned: 0,
    // Keyed off BALANCE so adding an upgrade never needs a matching edit here.
    // Missing a key made every derived number NaN, which is a silent failure.
    upgrades: Object.fromEntries(Object.keys(BALANCE.upgrades).map((key) => [key, 0])),
    towers: [],
    buildings: [],
    resources: freshResources(),
  };
}

function freshState() {
  return {
    ...freshRunState(),
    // meta, survives prestige
    cores: 0,
    prestiges: 0,
    lifetimeEarned: 0,
    bestWave: 1,
    kills: 0,
    muted: false,
    musicOff: false,
    speed: BALANCE.controls.speeds[0],
    paused: false,     // deliberately not saved: a game that opens frozen is a bug report
    seed: 0x1a2b3c4d,
    // transient
    enemies: [],
    projectiles: [],
    fx: [],
    time: 0,
    nextId: 1,
    incomeRate: 0,
    incomeAccum: 0,
    incomeTimer: 0,
    selected: null,    // id of the tower whose range and stats are shown
    selectedBuilding: null, // id of the building whose supply radius is shown
    buildType: null,   // tower type armed for tap-to-place
    drag: null,        // { type, x, y, ok, reason } while dragging a new tower
    banner: null,
    offlineReport: null,
  };
}

// ----------------------------------------------------------------- game ----
export function createGame(options = {}) {
  const clock = options.clock || createSystemClock();
  const state = freshState();
  let rng = mulberry32(state.seed);
  let lastTickWall = null;
  let lastSaveWall = null;

  const api = {
    state,
    clock,
    cosmetics: true,       // turned off while fast-forwarding
    onEvent: options.onEvent || (() => {}),
  };

  // --- derived numbers ---------------------------------------------------
  // The maths lives in derive.js; these bind it to this game's state.
  const prestigeMult = () => Derive.prestigeMult(state);
  const upgradeMult = (key) => Derive.upgradeMult(state, key);
  const upgradeCost = (key) => Derive.upgradeCost(state, key);
  const towerCost = (type) => Place.towerCost(state, type);
  const towerStats = (tower) => Derive.towerStats(state, tower);
  const waveHp = Derive.waveHp;
  const waveSpeed = Derive.waveSpeed;
  const waveBounty = Derive.waveBounty;
  const isBossWave = Derive.isBossWave;
  const waveRoster = Derive.waveRoster;
  const waveProgress = () => Derive.waveProgress(state);
  const pendingCores = () => Derive.pendingCores(state);

  // --- fx ----------------------------------------------------------------
  function floatText(x, y, text, color) {
    if (!api.cosmetics) return;
    state.fx.push({ kind: 'text', x, y, text, color, life: BALANCE.fx.floatLife, max: BALANCE.fx.floatLife });
  }
  function burst(x, y, color, count) {
    if (!api.cosmetics) return;
    if (state.fx.length > BALANCE.fx.maxParticles) return;
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const sp = 30 + rng() * 70;
      state.fx.push({
        kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        color, life: BALANCE.fx.particleLife, max: BALANCE.fx.particleLife,
      });
    }
  }
  function hitRing(x, y, color, size) {
    if (!api.cosmetics) return;
    state.fx.push({ kind: 'ring', x, y, color, size, life: BALANCE.fx.hitRingSeconds, max: BALANCE.fx.hitRingSeconds });
  }
  function beamFx(x1, y1, x2, y2, color) {
    if (!api.cosmetics) return;
    state.fx.push({ kind: 'beam', x1, y1, x2, y2, color, life: 0.08, max: 0.08 });
  }

  // --- waves -------------------------------------------------------------
  function buildQueue(wave) {
    const w = BALANCE.waves;
    const normal = Math.min(w.maxCount, Math.floor(w.baseCount + (wave - 1) * w.countPerWave));
    const boss = isBossWave(wave);
    const count = boss ? Math.max(1, Math.floor(normal * w.bossEscortRatio)) : normal;

    const pool = Object.entries(BALANCE.enemies)
      .filter(([, e]) => e.weight > 0 && wave >= e.minWave);
    const totalWeight = pool.reduce((a, [, e]) => a + e.weight, 0);

    const queue = [];
    for (let i = 0; i < count; i++) {
      let roll = rng() * totalWeight;
      let picked = pool[0][0];
      for (const [key, e] of pool) {
        roll -= e.weight;
        if (roll <= 0) { picked = key; break; }
      }
      queue.push(picked);
    }
    if (boss) queue.push('boss');
    return queue;
  }

  function spawnEnemy(typeKey) {
    const def = BALANCE.enemies[typeKey];
    const hp = waveHp(state.wave) * def.hp;
    state.enemies.push({
      id: state.nextId++,
      type: typeKey,
      hp,
      maxHp: hp,
      speed: waveSpeed(state.wave) * def.speed,
      bounty: waveBounty(state.wave) * def.bounty,
      radius: def.radius,
      dist: 0,
      x: LEVEL.path[0][0],
      y: LEVEL.path[0][1],
      flash: 0,
      angle: 0,
      spin: rng() * Math.PI * 2,
    });
  }

  function startWave() {
    state.phase = 'wave';
    state.queue = buildQueue(state.wave);
    state.waveTotal = state.queue.length;
    state.spawnTimer = 0;
    api.onEvent({ type: 'waveStart', wave: state.wave, boss: isBossWave(state.wave) });
    if (api.cosmetics) {
      state.banner = { text: (isBossWave(state.wave) ? 'BOSS WAVE ' : 'WAVE ') + state.wave, life: 1.6, max: 1.6 };
    }
  }

  function finishWave() {
    state.bestWave = Math.max(state.bestWave, state.wave);
    state.vaultHp = Math.min(BALANCE.vault.maxHp, state.vaultHp + BALANCE.vault.regenPerWave);
    state.wave += 1;
    state.phase = 'prep';
    state.phaseTimer = BALANCE.waves.prepTime;
    api.onEvent({ type: 'waveClear', wave: state.wave - 1 });
  }

  function breachVault() {
    state.enemies.length = 0;
    state.projectiles.length = 0;
    state.wave = 1;
    state.phase = 'prep';
    state.phaseTimer = BALANCE.waves.prepTime;
    state.waveTotal = 0;
    state.vaultHp = BALANCE.vault.maxHp;
    if (api.cosmetics) state.banner = { text: 'VAULT BREACHED', life: 2.2, max: 2.2 };
    api.onEvent({ type: 'breach' });
  }

  // --- combat ------------------------------------------------------------
  function earn(amount) {
    state.credits += amount;
    state.runEarned += amount;
    state.lifetimeEarned += amount;
    state.incomeAccum += amount;
  }

  function killEnemy(enemy, index) {
    const reward = enemy.bounty * prestigeMult();
    earn(reward);
    state.kills += 1;
    burst(enemy.x, enemy.y, BALANCE.enemies[enemy.type].color, enemy.type === 'boss' ? 18 : 6);
    if (api.cosmetics) api.onEvent({ type: 'kill', boss: enemy.type === 'boss' });
    floatText(enemy.x, enemy.y, '+' + Math.round(reward), '#7dd3fc');
    state.enemies.splice(index, 1);
  }

  function damageEnemy(enemy, amount) {
    enemy.hp -= amount;
    enemy.flash = 0.08;
    if (enemy.hp <= 0) {
      const i = state.enemies.indexOf(enemy);
      if (i >= 0) killEnemy(enemy, i);
      return true;
    }
    return false;
  }

  function splashDamage(x, y, radius, damage, falloff) {
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > radius) continue;
      const scale = 1 - falloff * (d / radius);
      damageEnemy(e, damage * scale);
    }
  }

  function findTarget(tower, stats) {
    // Furthest-along enemy inside range: the biggest threat to the vault.
    let best = null;
    for (const e of state.enemies) {
      if (Math.hypot(e.x - tower.x, e.y - tower.y) > stats.range) continue;
      if (!best || e.dist > best.dist) best = e;
    }
    return best;
  }

  // --- simulation --------------------------------------------------------
  function stepSim(dt) {
    state.time += dt;

    // waves
    if (state.phase === 'prep') {
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) startWave();
    } else {
      if (state.queue.length > 0) {
        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) {
          spawnEnemy(state.queue.shift());
          state.spawnTimer += BALANCE.waves.spawnInterval;
        }
      } else if (state.enemies.length === 0) {
        finishWave();
      }
    }

    // enemies
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      e.dist += e.speed * dt;
      e.flash = Math.max(0, e.flash - dt);
      e.spin += dt * 1.2;
      const p = pointAtDistance(e.dist);
      // Heading comes free from the movement we just did: no extra path lookup.
      if (Math.abs(p.x - e.x) > 1e-4 || Math.abs(p.y - e.y) > 1e-4) {
        e.angle = Math.atan2(p.y - e.y, p.x - e.x);
      }
      e.x = p.x; e.y = p.y;
      if (e.dist >= LEVEL.pathLength) {
        const def = BALANCE.enemies[e.type];
        state.vaultHp -= def.leakDamage || BALANCE.waves.leakDamage;
        burst(e.x, e.y, '#f87171', 8);
        if (api.cosmetics) api.onEvent({ type: 'leak' });
        state.enemies.splice(i, 1);
        if (state.vaultHp <= 0) { breachVault(); return; }
      }
    }

    // towers
    stepEconomy(state, dt);

    for (const tower of state.towers) {
      const stats = towerStats(tower);
      tower.cooldown -= dt;
      if (tower.recoil > 0) tower.recoil = Math.max(0, tower.recoil - dt / BALANCE.fx.recoilSeconds);
      // Judged every step, not only when there is something to shoot at: a
      // tower with no supply line has to show it while you are still building.
      tower.starved = !!towerProblem(state, tower);
      const target = findTarget(tower, stats);
      if (!target) continue;
      tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
      if (tower.cooldown > 0) continue;
      // Supply is checked before the cooldown is spent, so a starved tower is
      // ready to fire the instant its line comes back rather than waiting out
      // a cooldown it never got to use.
      if (tower.starved || !payForShot(state, tower)) {
        tower.starved = true;
        continue;
      }
      tower.cooldown = 1 / stats.fireRate;
      tower.recoil = 1;
      if (api.cosmetics) api.onEvent({ type: 'shot', tower: tower.type });
      if (stats.beam) {
        beamFx(tower.x, tower.y, target.x, target.y, BALANCE.towers[tower.type].color);
        tower.damageDone += stats.damage;
        if (damageEnemy(target, stats.damage)) tower.kills += 1;
      } else {
        state.projectiles.push({
          id: state.nextId++,
          x: tower.x, y: tower.y,
          targetId: target.id,
          tx: target.x, ty: target.y,
          speed: stats.projectileSpeed,
          damage: stats.damage,
          splashRadius: stats.splashRadius,
          splashFalloff: stats.splashFalloff,
          towerId: tower.id,
          color: BALANCE.towers[tower.type].color,
        });
      }
    }

    // projectiles
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      const target = state.enemies.find((e) => e.id === p.targetId);
      if (target) { p.tx = target.x; p.ty = target.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const move = p.speed * dt;
      if (d <= move || d < 1) {
        p.x = p.tx; p.y = p.ty;
        const tower = state.towers.find((t) => t.id === p.towerId);
        if (p.splashRadius > 0) {
          splashDamage(p.x, p.y, p.splashRadius, p.damage, p.splashFalloff);
          burst(p.x, p.y, p.color, 8);
          hitRing(p.x, p.y, p.color, p.splashRadius);
          if (tower) tower.damageDone += p.damage;
        } else if (target) {
          if (tower) tower.damageDone += p.damage;
          hitRing(p.x, p.y, p.color, 7);
          if (damageEnemy(target, p.damage) && tower) tower.kills += 1;
        }
        state.projectiles.splice(i, 1);
      } else {
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
      }
    }

    // fx
    for (let i = state.fx.length - 1; i >= 0; i--) {
      const f = state.fx[i];
      f.life -= dt;
      if (f.kind === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 60 * dt; }
      if (f.kind === 'text') f.y -= 22 * dt;
      if (f.life <= 0) state.fx.splice(i, 1);
    }
    if (state.banner) {
      state.banner.life -= dt;
      if (state.banner.life <= 0) state.banner = null;
    }

    // income rate, used for offline earnings
    state.incomeTimer += dt;
    if (state.incomeTimer >= BALANCE.offline.rateWindow) {
      const sample = state.incomeAccum / state.incomeTimer;
      state.incomeRate += (sample - state.incomeRate) * BALANCE.offline.rateSmoothing;
      state.incomeAccum = 0;
      state.incomeTimer = 0;
    }
  }

  // Advance the simulation by `seconds` of game time in fixed steps.
  api.advanceBy = function advanceBy(seconds) {
    const step = BALANCE.sim.step;
    let remaining = seconds;
    let guard = 0;
    while (remaining > 1e-9) {
      const dt = Math.min(step, remaining);
      stepSim(dt);
      remaining -= dt;
      if (++guard > 20_000_000) break; // never lock the tab
    }
  };

  // Fast-forward without cosmetic entities. Used by tests and offline catch-up.
  api.fastForward = function fastForward(seconds) {
    const wasCosmetic = api.cosmetics;
    api.cosmetics = false;
    state.fx.length = 0;
    api.advanceBy(seconds);
    api.cosmetics = wasCosmetic;
  };

  // One real-time frame. Reads the injected clock, never Date.now directly.
  api.tickRealtime = function tickRealtime() {
    const now = clock.now();
    if (lastTickWall === null) { lastTickWall = now; lastSaveWall = now; return; }
    let dt = (now - lastTickWall) / 1000;
    lastTickWall = now;
    if (dt < 0) dt = 0;
    if (state.paused) {
      // Time keeps passing, the world does not. Nothing to catch up on later.
    } else if (dt > BALANCE.offline.minSeconds) {
      // Screen was off or the tab was suspended: pay it as offline income.
      // Real seconds, never multiplied by the speed setting.
      applyOffline(dt);
    } else {
      api.advanceBy(Math.min(dt, BALANCE.sim.maxCatchUpSeconds) * state.speed);
    }
    if (now - lastSaveWall >= BALANCE.save.autosaveInterval * 1000) {
      api.save();
      lastSaveWall = now;
    }
  };

  // --- player actions ----------------------------------------------------
  // The rules live in placement.js; these keep the api shape and fire events.
  api.canPlaceAt = (x, y, ignoreId = null) => Place.canPlaceTower(state, x, y, ignoreId);
  api.canPlaceBuildingAt = (x, y, type, ignoreId = null) => Place.canPlaceBuilding(state, x, y, type, ignoreId);
  api.sellTower = (id) => Place.sellTower(state, id);
  api.sellBuilding = (id) => Place.sellBuilding(state, id);
  const seedBase = () => Place.seedBase(state);
  api.seedBase = seedBase;
  const buildingCost = (type) => Place.buildingCost(state, type);

  api.buildTower = function buildTower(x, y, type) {
    const res = Place.buildTower(state, x, y, type);
    if (res.ok) api.onEvent({ type: 'build', tower: type, cost: res.cost });
    return res;
  };

  api.buildBuilding = function buildBuilding(x, y, type, options) {
    const res = Place.buildBuilding(state, x, y, type, options);
    if (res.ok) api.onEvent({ type: 'build', building: type, cost: res.cost });
    return res;
  };

  api.buyUpgrade = function buyUpgrade(key) {
    if (!BALANCE.upgrades[key]) return { ok: false, reason: 'unknown upgrade' };
    const cost = upgradeCost(key);
    if (state.credits < cost) return { ok: false, reason: 'not enough credits' };
    state.credits -= cost;
    state.upgrades[key] += 1;
    return { ok: true, cost, level: state.upgrades[key] };
  };

  api.towerNear = function towerNear(x, y) {
    let best = null;
    let bestD = BALANCE.build.towerRadius + 10;
    for (const t of state.towers) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d <= bestD) { best = t; bestD = d; }
    }
    return best;
  };

  api.buildingNear = function buildingNear(x, y) {
    let best = null;
    let bestD = BALANCE.economy.buildingRadius + 10;
    for (const b of state.buildings) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d <= bestD) { best = b; bestD = d; }
    }
    return best;
  };

  // A tap on the play field: place an armed tower, or select/deselect one.
  api.tapAt = function tapAt(x, y) {
    if (state.buildType) {
      // Armed things are tagged "building:<key>" or plain "<towerKey>", so one
      // field carries both and only this branch has to know the difference.
      const isBuilding = state.buildType.startsWith('building:');
      const res = isBuilding
        ? api.buildBuilding(x, y, state.buildType.slice(9))
        : api.buildTower(x, y, state.buildType);
      // Deliberately not selecting the new tower: that would push the tower
      // list down two rows and the next drag would grab the wrong one.
      if (res.ok) state.buildType = null;
      return { kind: 'place', ...res };
    }
    const tower = api.towerNear(x, y);
    if (tower) {
      state.selectedBuilding = null;
      state.selected = state.selected !== tower.id ? tower.id : null;
      return { kind: 'tower', id: state.selected };
    }
    const building = api.buildingNear(x, y);
    if (building) {
      state.selected = null;
      state.selectedBuilding = state.selectedBuilding !== building.id ? building.id : null;
      return { kind: 'building', id: state.selectedBuilding };
    }
    state.selected = null;
    state.selectedBuilding = null;
    return { kind: 'none', id: null };
  };

  // --- drag to place ------------------------------------------------------
  api.startDrag = function startDrag(type, kind = 'tower') {
    const known = kind === 'building' ? BALANCE.buildings[type] : BALANCE.towers[type];
    if (!known) return false;
    state.drag = { type, kind, x: NaN, y: NaN, ok: false, reason: 'drag onto the map' };
    return true;
  };

  // Takes the ghost's own position. The lift above the finger is applied by the
  // input layer, in screen pixels, because a world-space lift would shrink to
  // nothing under the thumb as you zoom out.
  api.moveDrag = function moveDrag(x, gy) {
    if (!state.drag) return null;
    const building = state.drag.kind === 'building';
    const spot = building
      ? api.canPlaceBuildingAt(x, gy, state.drag.type)
      : api.canPlaceAt(x, gy);
    const cost = building ? buildingCost(state.drag.type) : towerCost(state.drag.type);
    const affordable = state.credits >= cost;
    Object.assign(state.drag, {
      x, y: gy,
      // A miner shows itself planted on the node it would snap to.
      snapX: spot.snapTo ? spot.snapTo.x : x,
      snapY: spot.snapTo ? spot.snapTo.y : gy,
      ok: spot.ok && affordable,
      reason: spot.ok ? (affordable ? '' : 'not enough credits') : spot.reason,
    });
    return state.drag;
  };

  api.dropDrag = function dropDrag() {
    const drag = state.drag;
    state.drag = null;
    if (!drag || !Number.isFinite(drag.x)) return { ok: false, reason: 'cancelled' };
    return drag.kind === 'building'
      ? api.buildBuilding(drag.x, drag.y, drag.type)
      : api.buildTower(drag.x, drag.y, drag.type);
  };

  api.cancelDrag = function cancelDrag() { state.drag = null; };

  // --- pace ---------------------------------------------------------------
  api.setPaused = function setPaused(value) {
    state.paused = !!value;
    return state.paused;
  };
  api.togglePause = () => api.setPaused(!state.paused);

  api.setSpeed = function setSpeed(value) {
    const speeds = BALANCE.controls.speeds;
    state.speed = speeds.includes(value) ? value : speeds[0];
    return state.speed;
  };

  api.cycleSpeed = function cycleSpeed() {
    const speeds = BALANCE.controls.speeds;
    const next = speeds[(speeds.indexOf(state.speed) + 1) % speeds.length];
    return api.setSpeed(next);
  };

  api.prestige = function prestige() {
    const cores = pendingCores();
    if (cores < BALANCE.prestige.minCoresToPrestige) return { ok: false, reason: 'not enough lifetime earnings' };
    state.cores += cores;
    state.prestiges += 1;
    Object.assign(state, freshRunState());
    state.enemies.length = 0;
    state.projectiles.length = 0;
    state.fx.length = 0;
    state.selected = null;
    state.buildType = null;
    state.drag = null;
    state.incomeRate = 0;
    state.incomeAccum = 0;
    state.incomeTimer = 0;
    state.selectedBuilding = null;
    seedBase();
    api.onEvent({ type: 'prestige', cores });
    return { ok: true, cores };
  };

  // --- persistence -------------------------------------------------------
  function snapshot() {
    return {
      wave: state.wave,
      credits: state.credits,
      vaultHp: state.vaultHp,
      upgrades: { ...state.upgrades },
      towers: state.towers.map((t) => ({ x: t.x, y: t.y, type: t.type, spent: t.spent, kills: t.kills })),
      buildings: state.buildings.map((b) => ({ x: b.x, y: b.y, type: b.type, spent: b.spent })),
      resources: { ...state.resources },
      cores: state.cores,
      prestiges: state.prestiges,
      lifetimeEarned: state.lifetimeEarned,
      runEarned: state.runEarned,
      bestWave: state.bestWave,
      kills: state.kills,
      incomeRate: state.incomeRate,
      muted: state.muted,
      musicOff: state.musicOff,
      speed: state.speed,
      seed: state.seed,
    };
  }
  api.snapshot = snapshot;

  function restore(data) {
    const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);
    state.wave = Math.max(1, Math.floor(num(data.wave, 1)));
    state.credits = Math.max(0, num(data.credits, BALANCE.economy.startingCredits));
    state.vaultHp = Math.min(BALANCE.vault.maxHp, Math.max(1, num(data.vaultHp, BALANCE.vault.maxHp)));
    for (const key of Object.keys(BALANCE.upgrades)) {
      state.upgrades[key] = Math.max(0, Math.floor(num(data.upgrades?.[key], 0)));
    }
    state.towers = [];
    for (const t of Array.isArray(data.towers) ? data.towers : []) {
      if (!BALANCE.towers[t.type]) continue;
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
      // Deliberately not re-validating placement: if a later balance change
      // makes an old position illegal, keeping the tower beats deleting it.
      state.towers.push({
        id: state.nextId++, type: t.type, x: t.x, y: t.y,
        spent: num(t.spent, BALANCE.towers[t.type].cost),
        cooldown: 0, angle: -Math.PI / 2, recoil: 0, kills: num(t.kills, 0), damageDone: 0,
      });
    }
    state.buildings = [];
    for (const b of Array.isArray(data.buildings) ? data.buildings : []) {
      if (!BALANCE.buildings[b.type]) continue;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      // As with towers: never re-validate a restored position. A later rule
      // change must not delete what someone built.
      state.buildings.push({
        id: state.nextId++, type: b.type, x: b.x, y: b.y,
        spent: num(b.spent, BALANCE.buildings[b.type].cost), rate: 1,
      });
    }
    state.resources = freshResources();
    for (const key of RESOURCE_KEYS) {
      state.resources[key] = Math.max(0, Math.min(BALANCE.resources[key].cap,
        num(data.resources?.[key], state.resources[key])));
    }
    state.cores = Math.max(0, Math.floor(num(data.cores, 0)));
    state.prestiges = Math.max(0, Math.floor(num(data.prestiges, 0)));
    state.lifetimeEarned = Math.max(0, num(data.lifetimeEarned, 0));
    state.runEarned = Math.max(0, num(data.runEarned, 0));
    state.bestWave = Math.max(1, Math.floor(num(data.bestWave, state.wave)));
    state.kills = Math.max(0, Math.floor(num(data.kills, 0)));
    state.incomeRate = Math.max(0, num(data.incomeRate, 0));
    state.muted = !!data.muted;
    state.musicOff = !!data.musicOff;
    api.setSpeed(num(data.speed, BALANCE.controls.speeds[0]));
    state.paused = false;
    state.seed = Math.floor(num(data.seed, state.seed));
    rng = mulberry32(state.seed);
    // A loaded run always restarts at the top of its wave.
    state.phase = 'prep';
    state.phaseTimer = BALANCE.waves.prepTime;
    state.queue = [];
    state.waveTotal = 0;
    state.enemies.length = 0;
    state.projectiles.length = 0;
    state.fx.length = 0;
    state.selected = null;
    state.selectedBuilding = null;
    state.buildType = null;
    state.drag = null;
  }
  api.restore = restore;

  function applyOffline(seconds) {
    const o = BALANCE.offline;
    const capped = Math.min(seconds, o.capHours * 3600);
    if (capped < o.minSeconds || state.incomeRate <= 0) return null;
    const gain = state.incomeRate * capped * o.efficiency;
    if (gain <= 0) return null;
    earn(gain);
    const report = { seconds: capped, credits: gain, capped: seconds > o.capHours * 3600 };
    state.offlineReport = report;
    api.onEvent({ type: 'offline', ...report });
    return report;
  }
  api.applyOffline = applyOffline;

  api.save = function save() {
    return Save.saveGame(snapshot(), clock.now());
  };

  // Load the stored save and pay out offline income. Returns a load report.
  api.load = function load() {
    const loaded = Save.loadGame();
    if (!loaded) return { loaded: false };
    restore(loaded.data);
    // A save written before supply lines existed restores with no buildings at
    // all. Rather than leaving every tower silent, it gets the opening depot.
    seedBase();
    let offline = null;
    if (loaded.savedAt) {
      offline = applyOffline(Math.max(0, (clock.now() - loaded.savedAt) / 1000));
    }
    return { loaded: true, offline, migratedFrom: loaded.migratedFrom };
  };

  api.hardReset = function hardReset() {
    Save.clearSave();
    Object.assign(state, freshState());
    rng = mulberry32(state.seed);
    lastTickWall = null;
    seedBase();
  };

  // --- read-only helpers for the UI --------------------------------------
  api.towerCost = towerCost;
  api.upgradeCost = upgradeCost;
  api.upgradeMult = upgradeMult;
  api.towerStats = towerStats;
  api.prestigeMult = prestigeMult;
  api.pendingCores = pendingCores;
  api.isBossWave = isBossWave;
  // A brand new game never goes through load(), so it seeds here.
  seedBase();

  api.waveHp = waveHp;
  api.waveRoster = waveRoster;
  api.waveProgress = waveProgress;
  api.towerById = (id) => state.towers.find((t) => t.id === id) || null;
  api.buildingById = (id) => state.buildings.find((b) => b.id === id) || null;
  api.buildingCost = buildingCost;
  api.flowRates = () => flowRates(state);
  api.towerProblem = (tower) => towerProblem(state, tower);
  api.suppliedAt = (x, y) => suppliedAt(state, x, y);
  api.oreNodeAt = (x, y) => oreNodeAt(LEVEL.oreNodes, x, y, state.buildings);

  return api;
}
