// game.js — state, systems and the simulation loop.
//
// The simulation never reads the wall clock directly. It takes an injectable
// clock and advances in fixed steps, so a test can fast-forward thousands of
// waves without waiting for them.

import { BALANCE } from './balance.js';
import * as Save from './save.js';

// ---------------------------------------------------------------- level ----
// Geometry, not balance: the fixed path and the slots towers can occupy.
export const LEVEL = {
  path: [
    [-20, 70], [300, 70], [300, 170], [60, 170], [60, 270],
    [300, 270], [300, 382], [180, 382], [180, 452],
  ],
  slots: [
    [30, 120], [150, 120], [240, 120],
    [20, 222], [150, 222], [240, 222],
    [30, 330], [110, 332], [245, 330],
    [95, 440], [268, 435],
  ],
  slotRadius: 15,
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
    taps: 0,
    muted: false,
    seed: 0x1a2b3c4d,
    // transient
    enemies: [],
    projectiles: [],
    fx: [],
    time: 0,
    nextId: 1,
    tapCooldown: 0,
    incomeRate: 0,
    incomeAccum: 0,
    incomeTimer: 0,
    selectedSlot: -1,
    buildType: null,
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
  function tapDamage() {
    const base = BALANCE.tap.flatBase + waveHp(state.wave) * BALANCE.tap.hpFraction;
    const share = 1 + state.upgrades.damage * BALANCE.upgrades.damage.effect * BALANCE.tap.damageUpgradeShare;
    return base * share * prestigeMult();
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
      spin: rng() * Math.PI * 2,
    });
  }

  function startWave() {
    state.phase = 'wave';
    state.queue = buildQueue(state.wave);
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
    state.tapCooldown = Math.max(0, state.tapCooldown - dt);

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
      e.x = p.x; e.y = p.y;
      if (e.dist >= LEVEL.pathLength) {
        const def = BALANCE.enemies[e.type];
        state.vaultHp -= def.leakDamage || BALANCE.waves.leakDamage;
        burst(e.x, e.y, '#f87171', 8);
        state.enemies.splice(i, 1);
        if (state.vaultHp <= 0) { breachVault(); return; }
      }
    }

    // towers
    for (const tower of state.towers) {
      const stats = towerStats(tower);
      tower.cooldown -= dt;
      const target = findTarget(tower, stats);
      if (!target) continue;
      tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
      if (tower.cooldown > 0) continue;
      tower.cooldown = 1 / stats.fireRate;
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
          if (tower) tower.damageDone += p.damage;
        } else if (target) {
          if (tower) tower.damageDone += p.damage;
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
    if (dt > BALANCE.offline.minSeconds) {
      // Screen was off or the tab was suspended: pay it as offline income.
      applyOffline(dt);
    } else {
      api.advanceBy(Math.min(dt, BALANCE.sim.maxCatchUpSeconds));
    }
    if (now - lastSaveWall >= BALANCE.save.autosaveInterval * 1000) {
      api.save();
      lastSaveWall = now;
    }
  };

  // --- player actions ----------------------------------------------------
  api.slotIsFree = (slot) => !state.towers.some((t) => t.slot === slot);

  api.buildTower = function buildTower(slot, type) {
    if (!BALANCE.towers[type]) return { ok: false, reason: 'unknown tower' };
    if (slot < 0 || slot >= LEVEL.slots.length) return { ok: false, reason: 'no such slot' };
    if (!api.slotIsFree(slot)) return { ok: false, reason: 'slot taken' };
    const cost = towerCost(type);
    if (state.credits < cost) return { ok: false, reason: 'not enough credits' };
    state.credits -= cost;
    const [x, y] = LEVEL.slots[slot];
    state.towers.push({
      id: state.nextId++, slot, type, x, y, spent: cost,
      cooldown: 0, angle: -Math.PI / 2, kills: 0, damageDone: 0,
    });
    api.onEvent({ type: 'build', tower: type, cost });
    return { ok: true, cost };
  };

  api.sellTower = function sellTower(slot) {
    const i = state.towers.findIndex((t) => t.slot === slot);
    if (i < 0) return { ok: false, reason: 'empty slot' };
    const refund = Math.floor(state.towers[i].spent * BALANCE.economy.sellRefund);
    state.credits += refund;
    state.towers.splice(i, 1);
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

  // A tap on the play field: hit an enemy, otherwise select a slot.
  api.tapAt = function tapAt(x, y) {
    if (state.tapCooldown <= 0) {
      let hit = null;
      let bestD = Infinity;
      for (const e of state.enemies) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < Math.max(e.radius + 12, 20) && d < bestD) { hit = e; bestD = d; }
      }
      if (hit) {
        state.tapCooldown = BALANCE.tap.cooldown;
        state.taps += 1;
        const dmg = tapDamage();
        floatText(hit.x, hit.y - 10, '-' + Math.round(dmg), '#fef08a');
        damageEnemy(hit, dmg);
        return { kind: 'enemy', damage: dmg };
      }
    }
    for (let i = 0; i < LEVEL.slots.length; i++) {
      const [sx, sy] = LEVEL.slots[i];
      if (Math.hypot(sx - x, sy - y) <= LEVEL.slotRadius + 10) {
        state.selectedSlot = state.selectedSlot === i ? -1 : i;
        return { kind: 'slot', slot: state.selectedSlot };
      }
    }
    state.selectedSlot = -1;
    return { kind: 'none' };
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
    state.selectedSlot = -1;
    state.buildType = null;
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
      towers: state.towers.map((t) => ({ slot: t.slot, type: t.type, spent: t.spent, kills: t.kills })),
      cores: state.cores,
      prestiges: state.prestiges,
      lifetimeEarned: state.lifetimeEarned,
      runEarned: state.runEarned,
      bestWave: state.bestWave,
      kills: state.kills,
      taps: state.taps,
      incomeRate: state.incomeRate,
      muted: state.muted,
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
      if (!(t.slot >= 0 && t.slot < LEVEL.slots.length)) continue;
      if (!api.slotIsFree(t.slot)) continue;
      const [x, y] = LEVEL.slots[t.slot];
      state.towers.push({
        id: state.nextId++, slot: t.slot, type: t.type, x, y,
        spent: num(t.spent, BALANCE.towers[t.type].cost),
        cooldown: 0, angle: -Math.PI / 2, kills: num(t.kills, 0), damageDone: 0,
      });
    }
    state.cores = Math.max(0, Math.floor(num(data.cores, 0)));
    state.prestiges = Math.max(0, Math.floor(num(data.prestiges, 0)));
    state.lifetimeEarned = Math.max(0, num(data.lifetimeEarned, 0));
    state.runEarned = Math.max(0, num(data.runEarned, 0));
    state.bestWave = Math.max(1, Math.floor(num(data.bestWave, state.wave)));
    state.kills = Math.max(0, Math.floor(num(data.kills, 0)));
    state.taps = Math.max(0, Math.floor(num(data.taps, 0)));
    state.incomeRate = Math.max(0, num(data.incomeRate, 0));
    state.muted = !!data.muted;
    state.seed = Math.floor(num(data.seed, state.seed));
    rng = mulberry32(state.seed);
    // A loaded run always restarts at the top of its wave.
    state.phase = 'prep';
    state.phaseTimer = BALANCE.waves.prepTime;
    state.queue = [];
    state.enemies.length = 0;
    state.projectiles.length = 0;
    state.fx.length = 0;
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
  api.tapDamage = tapDamage;
  api.isBossWave = isBossWave;
  api.waveHp = waveHp;
  api.towerAt = (slot) => state.towers.find((t) => t.slot === slot) || null;

  return api;
}
