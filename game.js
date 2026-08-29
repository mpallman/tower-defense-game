// game.js — state, systems and the simulation loop.
//
// The simulation never reads the wall clock directly. It takes an injectable
// clock and advances in fixed steps, so a test can fast-forward thousands of
// waves without waiting for them.

import { BALANCE } from './balance.js';
import * as Save from './save.js';

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
    upgrades: { damage: 0, rate: 0, range: 0 },
    towers: [],
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
  const prestigeMult = () => 1 + state.cores * BALANCE.prestige.bonusPerCore;

  function upgradeMult(key) {
    return 1 + state.upgrades[key] * BALANCE.upgrades[key].effect;
  }

  function upgradeCost(key) {
    const u = BALANCE.upgrades[key];
    return Math.ceil(u.cost * Math.pow(u.growth, state.upgrades[key]));
  }

  function towerCost(type) {
    const t = BALANCE.towers[type];
    const owned = state.towers.filter((tw) => tw.type === type).length;
    return Math.ceil(t.cost * Math.pow(t.costGrowth, owned));
  }

  function towerStats(tower) {
    const t = BALANCE.towers[tower.type];
    return {
      damage: t.damage * upgradeMult('damage') * prestigeMult(),
      range: t.range * upgradeMult('range'),
      fireRate: t.fireRate * upgradeMult('rate'),
      splashRadius: t.splashRadius || 0,
      splashFalloff: t.splashFalloff || 0,
      projectileSpeed: t.projectileSpeed || 0,
      beam: !!t.beam,
    };
  }

  function waveHp(wave) {
    return BALANCE.waves.hpBase * Math.pow(BALANCE.waves.hpGrowth, wave - 1);
  }
  function waveSpeed(wave) {
    return Math.min(
      BALANCE.waves.speedMax,
      BALANCE.waves.speedBase * Math.pow(BALANCE.waves.speedGrowth, wave - 1),
    );
  }
  function waveBounty(wave) {
    return BALANCE.waves.bountyBase * Math.pow(BALANCE.waves.bountyGrowth, wave - 1);
  }
  function isBossWave(wave) {
    return wave % BALANCE.waves.bossEvery === 0;
  }
  // Which enemy types this wave can field, and how tough each one is. Derived
  // straight from BALANCE, so the UI can show it without rolling the dice or
  // touching the rng the real wave will use.
  function waveRoster(wave) {
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
  function waveProgress() {
    if (state.phase === 'prep') {
      return 1 - Math.max(0, Math.min(1, state.phaseTimer / BALANCE.waves.prepTime));
    }
    if (!state.waveTotal) return 0;
    const left = state.queue.length + state.enemies.length;
    return Math.max(0, Math.min(1, 1 - left / state.waveTotal));
  }

  function pendingCores() {
    const p = BALANCE.prestige;
    return Math.floor(Math.pow(Math.max(0, state.runEarned) / p.divisor, p.exponent));
  }

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
    for (const tower of state.towers) {
      const stats = towerStats(tower);
      tower.cooldown -= dt;
      if (tower.recoil > 0) tower.recoil = Math.max(0, tower.recoil - dt / BALANCE.fx.recoilSeconds);
      const target = findTarget(tower, stats);
      if (!target) continue;
      tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
      if (tower.cooldown > 0) continue;
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
  // Can a tower stand here? Returns a reason so the UI can explain a refusal.
  api.canPlaceAt = function canPlaceAt(x, y, ignoreId = null) {
    const b = BALANCE.build;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'off the map' };
    if (x < b.edgeMargin || x > BALANCE.world.width - b.edgeMargin
      || y < b.edgeMargin || y > BALANCE.world.height - b.edgeMargin) {
      return { ok: false, reason: 'off the map' };
    }
    if (distanceToPath(x, y) < BALANCE.world.pathWidth / 2 + b.towerRadius + b.pathClearance) {
      return { ok: false, reason: 'too close to the path' };
    }
    if (Math.hypot(x - LEVEL.vault[0], y - LEVEL.vault[1]) < b.vaultClearance) {
      return { ok: false, reason: 'too close to the vault' };
    }
    for (const t of state.towers) {
      if (t.id === ignoreId) continue;
      if (Math.hypot(x - t.x, y - t.y) < b.minSpacing) return { ok: false, reason: 'too close to another tower' };
    }
    return { ok: true };
  };

  api.buildTower = function buildTower(x, y, type) {
    if (!BALANCE.towers[type]) return { ok: false, reason: 'unknown tower' };
    const spot = api.canPlaceAt(x, y);
    if (!spot.ok) return spot;
    const cost = towerCost(type);
    if (state.credits < cost) return { ok: false, reason: 'not enough credits' };
    state.credits -= cost;
    const tower = {
      id: state.nextId++, type, x, y, spent: cost,
      cooldown: 0, angle: -Math.PI / 2, recoil: 0, kills: 0, damageDone: 0,
    };
    state.towers.push(tower);
    api.onEvent({ type: 'build', tower: type, cost });
    return { ok: true, cost, id: tower.id };
  };

  api.sellTower = function sellTower(id) {
    const i = state.towers.findIndex((t) => t.id === id);
    if (i < 0) return { ok: false, reason: 'no such tower' };
    const refund = Math.floor(state.towers[i].spent * BALANCE.economy.sellRefund);
    state.credits += refund;
    state.towers.splice(i, 1);
    if (state.selected === id) state.selected = null;
    return { ok: true, refund };
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

  // A tap on the play field: place an armed tower, or select/deselect one.
  api.tapAt = function tapAt(x, y) {
    if (state.buildType) {
      const res = api.buildTower(x, y, state.buildType);
      // Deliberately not selecting the new tower: that would push the tower
      // list down two rows and the next drag would grab the wrong one.
      if (res.ok) state.buildType = null;
      return { kind: 'place', ...res };
    }
    const tower = api.towerNear(x, y);
    state.selected = tower && state.selected !== tower.id ? tower.id : null;
    return { kind: tower ? 'tower' : 'none', id: state.selected };
  };

  // --- drag to place ------------------------------------------------------
  api.startDrag = function startDrag(type) {
    if (!BALANCE.towers[type]) return false;
    state.drag = { type, x: NaN, y: NaN, ok: false, reason: 'drag onto the map' };
    return true;
  };

  api.moveDrag = function moveDrag(x, y) {
    if (!state.drag) return null;
    const gy = y + BALANCE.build.dragGrabOffset;
    const spot = api.canPlaceAt(x, gy);
    const cost = towerCost(state.drag.type);
    const affordable = state.credits >= cost;
    Object.assign(state.drag, {
      x, y: gy,
      ok: spot.ok && affordable,
      reason: spot.ok ? (affordable ? '' : 'not enough credits') : spot.reason,
    });
    return state.drag;
  };

  api.dropDrag = function dropDrag() {
    const drag = state.drag;
    state.drag = null;
    if (!drag || !Number.isFinite(drag.x)) return { ok: false, reason: 'cancelled' };
    return api.buildTower(drag.x, drag.y, drag.type);
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
  };

  // --- read-only helpers for the UI --------------------------------------
  api.towerCost = towerCost;
  api.upgradeCost = upgradeCost;
  api.upgradeMult = upgradeMult;
  api.towerStats = towerStats;
  api.prestigeMult = prestigeMult;
  api.pendingCores = pendingCores;
  api.isBossWave = isBossWave;
  api.waveHp = waveHp;
  api.waveRoster = waveRoster;
  api.waveProgress = waveProgress;
  api.towerById = (id) => state.towers.find((t) => t.id === id) || null;

  return api;
}
